// ============================================================
// keydrop-pay : 埋め込み型カード決済（Square Web Payments SDK のトークンを受けて即時課金）
// 2026-06-10 / omni
//
// フロー（一般的なEC型・サイト内完結）:
//   client: カードフォーム(Square SDK)→tokenize→token
//   → ここで keydrop_book_v2(正確な総額で予約作成 pending) → Square Payments API で token を即時課金
//   → 成功: status=confirmed・台帳paid・完了メール投入・Slack新規予約 → {ok}
//   → 失敗: 予約をキャンセル(配車解放)して {error}（在庫を残さない）
//
// 金額はサーバ(keydrop_book_v2)が確定＝クライアント値は信用しない（価格偽装防止）。
// verify_jwt ON（anonキーで通る）。
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SQUARE_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const SQUARE_LOCATION = Deno.env.get("SQUARE_LOCATION_ID") || "L8N7J9RKPN3WH";
const SQUARE_API = "https://connect.squareup.com";

const ALLOWED = ["https://nosh2318.github.io", "https://keydrop.jp"];
function cors(o: string | null) {
  const allow = o && ALLOWED.includes(o) ? o : ALLOWED[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Vary": "Origin" };
}
let _o: string | null = null;
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors(_o), "content-type": "application/json" } }); }

async function sbGet(t: string, q: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) { console.error(`GET ${t}: ${await r.text()}`); return []; }
  return await r.json();
}
async function sbPost(t: string, d: unknown): Promise<void> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}`, { method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(d) });
  if (!r.ok) console.error(`POST ${t}: ${await r.text()}`);
}
async function sbPatch(t: string, q: string, d: unknown): Promise<void> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(d) });
  if (!r.ok) console.error(`PATCH ${t}: ${await r.text()}`);
}
async function sbDelete(t: string, q: string) {
  await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "DELETE", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
}
async function sbRpc(fn: string, args: unknown): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args) });
  if (!r.ok) { console.error(`RPC ${fn}: ${await r.text()}`); return null; }
  return await r.json();
}
async function notifySlack(text: string) {
  const token = Deno.env.get("SLACK_BOT_TOKEN"); const channel = Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36";
  if (!token) return;
  try { await fetch("https://slack.com/api/chat.postMessage", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text }) }); } catch (e) { console.error("[slack]", e); }
}

Deno.serve(async (req) => {
  _o = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(_o) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let p: any; try { p = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  // レート制限（IP×時間窓）
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  try {
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent = await sbGet("keydrop_rate", `ip=eq.${encodeURIComponent(ip)}&path=eq.pay&created_at=gte.${encodeURIComponent(since)}&select=id`);
    if (recent.length >= 12) return json({ error: "短時間に決済が集中しています。しばらくしてからお試しください" }, 429);
    await sbPost("keydrop_rate", { ip, path: "pay" });
  } catch (_e) { /* 可用性優先 */ }

  // 入力検証
  const token = String(p.token || p.sourceId || "").trim();
  const cls = String(p.vehicleClass || "").trim();
  const lend = String(p.lend_date || "").trim();
  const ret = String(p.return_date || "").trim();
  const name = String(p.name || "").trim();
  const mail = String(p.mail || "").trim();
  const tel = String(p.tel || "").trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!token) return json({ error: "カード情報が取得できませんでした" }, 400);
  if (!cls) return json({ error: "クラス未指定" }, 400);
  if (!dateRe.test(lend) || !dateRe.test(ret) || ret < lend) return json({ error: "日付エラー" }, 400);
  if (!name || !mail || mail.indexOf("@") < 0 || !tel) return json({ error: "予約者情報が不足しています" }, 400);
  if (!SQUARE_TOKEN) return json({ error: "決済が一時的に利用できません" }, 503);

  let people = parseInt(String(p.people ?? 1), 10); if (isNaN(people) || people < 1) people = 1; if (people > 8) people = 8;

  // 予約作成＋総額確定（サーバ計算）
  const rpc = await sbRpc("keydrop_book_v2", { p: {
    vehicleClass: cls, vehicleModel: String(p.vehicleModel || ""),
    lend_date: lend, return_date: ret, lend_time: String(p.lend_time || ""), return_time: String(p.return_time || ""),
    name, mail, tel, people,
    insuranceType: String(p.insuranceType || "none"),
    childSeat: parseInt(String(p.childSeat ?? 0), 10) || 0,
    juniorSeat: parseInt(String(p.juniorSeat ?? 0), 10) || 0,
    del_place: String(p.del_place || ""), col_place: String(p.col_place || ""),
    visit_type: p.visit_type ? String(p.visit_type) : "DEL", return_type: p.return_type ? String(p.return_type) : "COL",
    requireStock: p.requireStock === true,
  } });
  if (!rpc) return json({ error: "予約処理に失敗しました" }, 500);
  if (rpc.error) return json({ error: rpc.error, soldOut: rpc.soldOut === true }, rpc.soldOut ? 409 : 400);

  const resId = rpc.reservationId;
  const amount = Math.round(Number(rpc.total || 0));
  if (amount <= 0) { await cancelPending(resId); return json({ error: "金額計算エラー" }, 400); }

  // Square Payments API で即時課金
  try {
    const r = await fetch(`${SQUARE_API}/v2/payments`, { method: "POST",
      headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, "content-type": "application/json", "Square-Version": "2024-06-04" },
      body: JSON.stringify({
        idempotency_key: `kdpay-${resId}`,
        source_id: token,
        location_id: SQUARE_LOCATION,
        amount_money: { amount: amount, currency: "JPY" },
        reference_id: resId,
        note: `KEYDROP ${resId}`,
      }) });
    const j = await r.json();
    const st = j?.payment?.status;
    if (!r.ok || (st !== "COMPLETED" && st !== "APPROVED")) {
      console.error(`[pay] failed ${resId}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
      await cancelPending(resId);
      const detail = (j.errors && j.errors[0] && (j.errors[0].detail || j.errors[0].code)) || "カードが承認されませんでした";
      return json({ error: "決済に失敗しました：" + detail }, 402);
    }
    const payId = j.payment.id;
    // 確定
    await sbPatch("reservations", `id=eq.${encodeURIComponent(resId)}&status=eq.pending_payment`, { status: "confirmed" });
    await sbPost("keydrop_payments", { reservation_id: resId, square_payment_id: payId, amount, status: "paid", paid_at: new Date().toISOString() });
    // 完了メール投入＋Slack（予約詳細取得）
    const rv = (await sbGet("reservations", `id=eq.${encodeURIComponent(resId)}&select=name,mail,vehicle,lend_date,return_date,lend_time,return_time,del_place,col_place,price,people,insurance`))[0];
    if (rv && rv.mail) {
      await sbPost("keydrop_notifications", { type: "confirm", reservation_id: resId, to_email: rv.mail, payload: {
        name: rv.name || "", vehicleClass: rv.vehicle || "", lend_date: rv.lend_date || "", lend_time: rv.lend_time || "",
        return_date: rv.return_date || "", return_time: rv.return_time || "", del_place: rv.del_place || "", col_place: rv.col_place || "",
        price: rv.price || amount, people: rv.people || 1, insurance: rv.insurance || "なし" } });
    }
    await notifySlack([`🆕 *KEYDROP 新規予約*（カード決済・確定）`,
      `予約番号: ${resId} / ${rv?.name || ""}様`, `車両: ${rv?.vehicle || ""}クラス`,
      `お届け: ${rv?.lend_date || ""} ${rv?.lend_time || ""}　${rv?.del_place || ""}`,
      `回収: ${rv?.return_date || ""} ${rv?.return_time || ""}　${rv?.col_place || ""}`,
      `金額: ¥${amount.toLocaleString()}`].join("\n"));
    console.log(`[pay] PAID ${resId} ¥${amount} payment=${payId}`);
    return json({ ok: true, reservationId: resId, amount });
  } catch (e) {
    console.error("[pay]", e); await cancelPending(resId);
    return json({ error: "決済処理で問題が発生しました。時間をおいてお試しください" }, 500);
  }

  async function cancelPending(id: string) {
    try {
      await sbDelete("fleet", `reservation_id=eq.${encodeURIComponent(id)}`);
      await sbPatch("reservations", `id=eq.${encodeURIComponent(id)}&status=eq.pending_payment`, { status: "cancelled" });
    } catch (_e) { /* TTLが後始末 */ }
  }
});
