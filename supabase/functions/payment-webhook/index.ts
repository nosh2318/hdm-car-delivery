// ============================================================
// payment-webhook : Square 入金 webhook → KEYDROP予約を confirmed 化
// 2026-06-10 / omni  (Phase B)
//
// セキュリティ（SECURITY_AUDIT 残②の実装）:
//   ・HMAC-SHA256 署名検証（x-square-hmacsha256-signature）。不一致は401で破棄。
//     署名 = base64( HMAC-SHA256( key=SIGNATURE_KEY, msg = NOTIFICATION_URL + rawBody ) )
//   ・冪等性：keydrop_payments.status='paid' は再処理しない（同イベント多重配信に耐える）。
//
// 処理:
//   payment.created / payment.updated を受信 → payment.status==='COMPLETED' のとき
//   → payment.order_id から keydrop_payments を引き reservation_id を解決
//   → reservations.status = 'confirmed'（TTL対象外化）
//   → keydrop_payments.status='paid' / paid_at / square_payment_id
//   → Slack 通知（任意 env）
//
// ★会計起票しない：売上の正本は reservations.price。spk_accounting へ入れると二重計上。
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIG_KEY = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") || "";
// Square ダッシュボードに登録する webhook エンドポイントURL（署名計算に厳密一致が必要）
const NOTIFICATION_URL = Deno.env.get("SQUARE_WEBHOOK_URL") ||
  `${SB_URL}/functions/v1/payment-webhook`;
const SQUARE_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const SQUARE_API = "https://connect.squareup.com";
const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const SLACK_CHANNEL = Deno.env.get("SLACK_KEYDROP_CHANNEL") || "";

// --- PostgREST helpers (service_role) ---
async function sbGet(table: string, query: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) { console.error(`GET ${table}: ${await r.text()}`); return []; }
  return await r.json();
}
async function sbPost(table: string, data: unknown): Promise<void> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(data),
  });
  if (!r.ok) console.error(`POST ${table}: ${await r.text()}`);
}
async function sbPatch(table: string, query: string, data: unknown): Promise<any[] | null> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) { console.error(`PATCH ${table}: ${await r.text()}`); return null; }
  return await r.json();
}

// --- HMAC-SHA256 署名検証 ---
async function verifySignature(rawBody: string, headerSig: string): Promise<boolean> {
  if (!SIG_KEY) { console.error("[webhook] SIGNATURE_KEY 未設定＝検証不可で拒否"); return false; }
  if (!headerSig) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SIG_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(NOTIFICATION_URL + rawBody),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // 長さ一致＋定数時間比較
  if (expected.length !== headerSig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ headerSig.charCodeAt(i);
  return diff === 0;
}

async function notifySlack(text: string) {
  if (!SLACK_TOKEN || !SLACK_CHANNEL) return;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", Authorization: `Bearer ${SLACK_TOKEN}` },
      body: JSON.stringify({ channel: SLACK_CHANNEL, text }),
    });
  } catch (e) { console.error("[slack]", e); }
}

// payment.order_id から reference_id(=reservationId) を補助解決（台帳に無い場合の保険）
async function orderReference(orderId: string): Promise<string | null> {
  if (!SQUARE_TOKEN || !orderId) return null;
  try {
    const r = await fetch(`${SQUARE_API}/v2/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, "Square-Version": "2024-06-04" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.order?.reference_id || null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const rawBody = await req.text();
  const sig = req.headers.get("x-square-hmacsha256-signature") || "";
  if (!(await verifySignature(rawBody, sig))) {
    console.error("[webhook] 署名検証失敗 → 破棄");
    return new Response("invalid signature", { status: 401 });
  }

  let ev: any;
  try { ev = JSON.parse(rawBody); } catch { return new Response("bad json", { status: 400 }); }

  const type = ev?.type || "";
  const payment = ev?.data?.object?.payment;
  // 入金完了イベントのみ処理
  if (!(type === "payment.created" || type === "payment.updated") || !payment) {
    return new Response("ignored", { status: 200 }); // 200で返してSquareの再送を止める
  }
  if (payment.status !== "COMPLETED") {
    return new Response("not completed", { status: 200 });
  }

  const orderId = payment.order_id || "";
  const paymentId = payment.id || "";

  // 予約を特定：まず台帳(square_order_id) → 無ければ order.reference_id
  let rows = orderId
    ? await sbGet("keydrop_payments", `square_order_id=eq.${encodeURIComponent(orderId)}&select=*`)
    : [];
  let resvId = rows[0]?.reservation_id || null;
  if (!resvId) {
    const ref = await orderReference(orderId);
    if (ref) {
      resvId = ref;
      rows = await sbGet("keydrop_payments", `reservation_id=eq.${encodeURIComponent(ref)}&select=*`);
    }
  }
  if (!resvId) {
    console.error(`[webhook] 予約特定できず order=${orderId} payment=${paymentId}`);
    return new Response("reservation not found", { status: 200 });
  }

  // 冪等性：既に paid なら何もしない
  if (rows[0]?.status === "paid") {
    return new Response("already paid", { status: 200 });
  }

  const nowIso = new Date().toISOString();
  // 予約を confirmed に（pending_payment のものだけ。既にconfirmedは冪等・cancelledは別途警告）
  const confirmed = await sbPatch("reservations",
    `id=eq.${encodeURIComponent(resvId)}&status=eq.pending_payment`,
    { status: "confirmed" });
  // ⚠️ レース検知：決済成立したのに pending_payment が無い＝TTLで枠が解放済み or 既にconfirmed
  if (!confirmed || confirmed.length === 0) {
    const cur = await sbGet("reservations", `id=eq.${encodeURIComponent(resvId)}&select=status`);
    const st = cur[0]?.status || "(不明)";
    if (st !== "confirmed") {
      // 入金あるのに枠が無い＝手動対応必須（再配車 or 返金）
      const amt = payment.amount_money?.amount ? `¥${Number(payment.amount_money.amount).toLocaleString()}` : "";
      console.error(`[webhook] RACE 決済成立だが status=${st} ${resvId}`);
      await notifySlack(`🔴🔴🔴 *要対応* 🔴🔴🔴\nKEYDROP ${resvId} の入金(${amt})を確認しましたが、予約枠が *${st}* です（TTL解放/取消の可能性）。\n➡️ *再配車 または 返金の手動対応が必要です*`);
    }
  }
  // 台帳更新（行が無ければ作る）
  const patched = await sbPatch("keydrop_payments",
    `reservation_id=eq.${encodeURIComponent(resvId)}`,
    { status: "paid", paid_at: nowIso, square_payment_id: paymentId, square_order_id: orderId });
  if (!patched || patched.length === 0) {
    // 台帳に行が無い（直接決済等）→ INSERT
    await fetch(`${SB_URL}/rest/v1/keydrop_payments`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ reservation_id: resvId, square_order_id: orderId, square_payment_id: paymentId, amount: (payment.amount_money?.amount || 0) / 1, status: "paid", paid_at: nowIso }),
    });
  }

  const amt = payment.amount_money?.amount ? `¥${Number(payment.amount_money.amount).toLocaleString()}` : "";
  console.log(`[webhook] PAID ${resvId} ${amt} order=${orderId}`);

  // 予約詳細を取得（Slack通知＋完了メールの両方で使う）
  let rv: any = null;
  try {
    rv = (await sbGet("reservations",
      `id=eq.${encodeURIComponent(resvId)}&select=id,name,mail,vehicle,lend_date,return_date,lend_time,del_time,return_time,col_time,del_place,col_place,price,people,insurance`))[0];
  } catch (e) { console.error("[webhook] fetch reservation:", e); }

  // --- 🆕 新規予約（入金確定）を運営Slackへ（車両・日時・場所つき）---
  if (rv) {
    const lt = rv.lend_time || rv.del_time || "";
    const rt = rv.return_time || rv.col_time || "";
    await notifySlack([
      `🆕 *KEYDROP 新規予約*（入金確認・確定）`,
      `予約番号: ${resvId} / ${rv.name || ""}様`,
      `車両: ${rv.vehicle || ""}クラス`,
      `お届け: ${rv.lend_date || ""} ${lt}　${rv.del_place || ""}`,
      `回収: ${rv.return_date || ""} ${rt}　${rv.col_place || rv.del_place || ""}`,
      `金額: ${amt || ("¥" + Number(rv.price || 0).toLocaleString())}`,
    ].join("\n"));
  } else {
    await notifySlack(`🆕 *KEYDROP 新規予約*（入金確認・確定） ${resvId} ${amt}`);
  }

  // --- 予約完了メールをキューに投入（GAS送信ワーカーが reserve@ から顧客へ送信）---
  try {
    if (rv && rv.mail) {
      await sbPost("keydrop_notifications", {
        type: "confirm",
        reservation_id: resvId,
        to_email: rv.mail,
        payload: {
          name: rv.name || "",
          vehicleClass: rv.vehicle || "",
          lend_date: rv.lend_date || "", lend_time: rv.lend_time || rv.del_time || "",
          return_date: rv.return_date || "", return_time: rv.return_time || rv.col_time || "",
          del_place: rv.del_place || "", col_place: rv.col_place || "",
          price: rv.price || 0, people: rv.people || 1, insurance: rv.insurance || "なし",
          paid_amount: payment.amount_money?.amount || rv.price || 0,
        },
      });
    } else {
      console.error(`[webhook] confirm mail skip: no mail for ${resvId}`);
    }
  } catch (e) { console.error("[webhook] enqueue confirm mail:", e); }

  return new Response("ok", { status: 200 });
});
