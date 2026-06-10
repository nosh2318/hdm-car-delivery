// ============================================================
// create-booking : 顧客申込 → 札幌SPK adminと同一DBへ「SPKと同じ形」で予約成立
// 2026-06-09 / omni
//
// 役割（コア連動 customer→admin）:
//   1. 入力検証（期間/クラス/人数≤8/連絡先）
//   2. サーバ側で在庫再確認（GAS autoAssignVehicle_ を完全移植）
//   3. 採番 KD-YYMM-xxxx
//   4. reservations へ INSERT（ota='KEYDROP' / status='pending_payment'）
//   5. fleet へ車両自動割当（取れなければ未配車で受理→admin調整）
//   → この瞬間、札幌の配車表/OPシート/タスク/会計に出る（tasksはAPPが動的生成）
//
// 認証: service_role は Edge Function 内のみ（クライアントへ出さない）。
//   anon直INSERT/PATCHを廃し、書込はこのFn経由に一本化する。
//
// ※ 決済(Square Payment Link発行)は Phase B で本Fn末尾に追加予定。
//   今は status='pending_payment' で確定前の枠を作る（決済webhookで confirmed 化）。
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// --- Square (Phase B) ---
const SQUARE_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const SQUARE_LOCATION = Deno.env.get("SQUARE_LOCATION_ID") || "L8N7J9RKPN3WH";
const SQUARE_API = "https://connect.squareup.com";
// 決済完了後に戻る先（独自ドメイン取得時に env で差し替え）
const KEYDROP_RETURN_URL = Deno.env.get("KEYDROP_RETURN_URL") ||
  "https://nosh2318.github.io/hdm-car-delivery/";

// 許可オリジン（KEYDROP公開元）。独自ドメイン取得時に追記。
const ALLOWED = [
  "https://nosh2318.github.io",
  // "https://keydrop.example.com",
];
function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization",
    "Vary": "Origin",
  };
}
let _origin: string | null = null;
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(_origin), "content-type": "application/json" },
  });
}

// --- PostgREST helpers (service_role) ---
async function sbGet(table: string, query: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) { console.error(`GET ${table}: ${await r.text()}`); return []; }
  return await r.json();
}
async function sbPost(table: string, data: unknown): Promise<any[] | null> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) { console.error(`POST ${table}: ${await r.text()}`); return null; }
  return await r.json();
}
async function sbRpc(fn: string, args: unknown): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) { console.error(`RPC ${fn}: ${await r.text()}`); return null; }
  return await r.json();
}

// --- 車種名マッチング（HP車種指定配車用・GAS isModelMatch_ 移植） ---
function isModelMatch(vehicleName: string, preferred: string): boolean {
  if (!vehicleName || !preferred) return false;
  const vName = vehicleName.replace(/[①②③④⑤⑥⑦⑧⑨⑩\d]+$/, "").trim();
  if (vName === preferred) return true;
  const norm = (s: string) => String(s).toUpperCase().replace(/[\s\-ー－・]/g, "");
  return norm(vName) === norm(preferred);
}

// --- 期間内の年月リスト (YYYY-MM)・GAS listYearMonths_ 移植 ---
function listYearMonths(lend: string, ret: string): string[] {
  if (!lend || !ret) return [];
  const s = new Date(lend + "T00:00:00Z"), e = new Date(ret + "T00:00:00Z");
  if (isNaN(+s) || isNaN(+e)) return [];
  const out: string[] = [];
  let cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  let guard = 24;
  while (cur <= e && guard-- > 0) {
    out.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

// --- 空き車両を1台割り当て（GAS autoAssignVehicle_ 完全移植）---
//   戻り値: 割当できた車両 or null（null=未配車で受理しadmin調整）
async function assignVehicle(vehicleClass: string, model: string, lend: string, ret: string): Promise<any | null> {
  if (!vehicleClass) return null;
  let vehicles = await sbGet(
    "vehicles",
    `type=eq.${encodeURIComponent(vehicleClass)}&insurance_veh=eq.false&active=eq.true&select=code,name,plate_no,seats`,
  );
  if (vehicles.length === 0) return null;

  // 車種指定フィルタ
  if (model) {
    const f = vehicles.filter((v) => isModelMatch(v.name, model));
    if (f.length === 0) return null;
    vehicles = f;
  }

  // 月別除外（配車表の active=false）
  const yms = listYearMonths(lend, ret);
  if (yms.length > 0) {
    const inactive: Record<string, boolean> = {};
    for (const ym of yms) {
      const rows = await sbGet("vehicle_monthly_kpi", `year_month=eq.${encodeURIComponent(ym)}&active=eq.false&select=vehicle_code`);
      for (const r of rows) inactive[r.vehicle_code] = true;
    }
    vehicles = vehicles.filter((v) => !inactive[v.code]);
    if (vehicles.length === 0) return null;
  }

  // fleet重複（cancelled除外）＋ maintenance重複
  const busy: Record<string, boolean> = {};
  const allFleet = await sbGet("fleet", "select=vehicle_code,reservation_id,reservations(lend_date,return_date,status)");
  for (const f of allFleet) {
    const r = f.reservations;
    if (!r) continue;
    const st = r.status || "";
    if (st === "cancelled" || st === "キャンセル" || st === "cancel") continue;
    if (r.lend_date <= ret && r.return_date >= lend) busy[f.vehicle_code] = true;
  }
  const maint = await sbGet("maintenance", `start_date=lte.${encodeURIComponent(ret)}&end_date=gte.${encodeURIComponent(lend)}&select=vehicle_code`);
  for (const m of maint) busy[m.vehicle_code] = true;

  for (const v of vehicles) {
    if (!busy[v.code]) return v; // 最初の空き
  }
  return null;
}

// --- 採番 KD-YYMM-xxxx（当月KEYDROP予約の最大連番+1）---
async function nextId(lend: string): Promise<string> {
  const d = new Date(lend + "T00:00:00Z");
  const yymm = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const prefix = `KD-${yymm}-`;
  const rows = await sbGet("reservations", `id=like.${encodeURIComponent(prefix + "*")}&select=id`);
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.id).slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// --- Square Payment Link 発行（reference_id=予約番号 / 金額=サーバ確定値）---
//   戻り値: { url, orderId, linkId } または null（Square未設定・失敗時）
async function createSquareLink(reservationId: string, amountJpy: number, cls: string): Promise<{ url: string; orderId: string; linkId: string } | null> {
  if (!SQUARE_TOKEN) { console.warn("[square] SQUARE_ACCESS_TOKEN 未設定→決済リンクなしで受理"); return null; }
  if (!amountJpy || amountJpy <= 0) { console.warn("[square] 金額0→リンク発行スキップ"); return null; }
  try {
    const r = await fetch(`${SQUARE_API}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, "content-type": "application/json", "Square-Version": "2024-06-04" },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        order: {
          location_id: SQUARE_LOCATION,
          reference_id: reservationId, // ← webhookが予約を特定するキー
          line_items: [{
            name: `KEYDROP レンタカー ${cls}クラス（${reservationId}）`,
            quantity: "1",
            base_price_money: { amount: Math.round(amountJpy), currency: "JPY" },
          }],
        },
        checkout_options: {
          redirect_url: `${KEYDROP_RETURN_URL}?paid=${encodeURIComponent(reservationId)}`,
          ask_for_shipping_address: false,
        },
        payment_note: `KEYDROP ${reservationId}`,
      }),
    });
    if (!r.ok) { console.error(`[square] link error: ${await r.text()}`); return null; }
    const j = await r.json();
    const pl = j?.payment_link;
    if (!pl?.url) return null;
    return { url: pl.url, orderId: pl.order_id || "", linkId: pl.id || "" };
  } catch (e) { console.error("[square]", e); return null; }
}

Deno.serve(async (req) => {
  _origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(_origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let p: any;
  try { p = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  // --- スパム対策：レート制限のみ（ハニーポットはブラウザ自動入力で実客を誤爆するため撤去）---
  const _ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  try {
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent = await sbGet("keydrop_rate", `ip=eq.${encodeURIComponent(_ip)}&path=eq.book&created_at=gte.${encodeURIComponent(since)}&select=id`);
    if (recent.length >= 8) return json({ error: "短時間に予約が集中しています。しばらくしてから再度お試しください" }, 429);
    await sbPost("keydrop_rate", { ip: _ip, path: "book" });
  } catch (e) { console.error("[rate]", e); /* 判定失敗時は可用性優先で通す */ }

  // --- 入力検証 ---
  const cls = String(p.vehicleClass || p.vehicle || "").trim();
  const lend = String(p.lend_date || "").trim();
  const ret = String(p.return_date || "").trim();
  const name = String(p.name || "").trim();
  const mail = String(p.mail || "").trim();
  const tel = String(p.tel || "").trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;

  if (!cls) return json({ error: "クラス未指定" }, 400);
  if (!dateRe.test(lend) || !dateRe.test(ret)) return json({ error: "日付形式エラー" }, 400);
  if (ret < lend) return json({ error: "返却日が貸出日より前です" }, 400);
  if (!name) return json({ error: "氏名必須" }, 400);
  if (!mail || mail.indexOf("@") < 0) return json({ error: "メール形式エラー" }, 400);
  if (!tel) return json({ error: "電話番号必須" }, 400);

  let people = parseInt(String(p.people ?? 1), 10);
  if (isNaN(people) || people < 1) people = 1;
  if (people > 8) people = 8; // 最大8人クランプ（絶対ルール）

  // --- 価格確定 ---
  const base = Number(p.base_price || 0);
  const opt = Number(p.option_price || 0);
  const disc = Number(p.discount || 0);
  const price = (base > 0 || opt > 0) ? (base + opt - disc) : Number(p.price || 0);

  // --- アトミック予約（005 keydrop_book：在庫確認→採番→reservations/fleet INSERT を
  //     1トランザクション＋グローバルadvisory lockで直列化＝ダブルブッキング/採番衝突を構造的に防止）---
  const rpcParam = {
    vehicleClass: cls,
    vehicleModel: String(p.vehicleModel || ""),
    lend_date: lend,
    return_date: ret,
    name, mail, tel, people,
    base_price: base, option_price: opt, discount: disc, price,
    insurance: String(p.insurance || "なし"),
    del_place: String(p.del_place || ""),
    col_place: String(p.col_place || ""),
    visit_type: p.visit_type ? String(p.visit_type) : "DEL",
    return_type: p.return_type ? String(p.return_type) : "COL",
    requireStock: p.requireStock === true,
  };
  const rpc = await sbRpc("keydrop_book", { p: rpcParam });
  if (!rpc) return json({ error: "予約登録に失敗しました" }, 500);
  if (rpc.error) return json({ error: rpc.error, soldOut: rpc.soldOut === true }, rpc.soldOut ? 409 : 400);

  console.log(`[create-booking] ${rpc.reservationId} ${cls} ${lend}~${ret} → ${rpc.assigned}`);

  // --- Phase B: Square 決済リンク発行（金額はRPCのサーバ確定値 rpc.price を使用）---
  const payAmount = Number(rpc.price || price || 0);
  const link = await createSquareLink(rpc.reservationId, payAmount, cls);
  if (link) {
    // 決済台帳に pending で記録（webhookが order_id で突合→冪等化）
    await sbPost("keydrop_payments", {
      reservation_id: rpc.reservationId,
      square_order_id: link.orderId,
      square_payment_link_id: link.linkId,
      payment_url: link.url,
      amount: payAmount,
      status: "pending",
    });
  }

  return json({
    ok: true,
    reservationId: rpc.reservationId,
    assigned: rpc.assigned,
    status: rpc.status || "pending_payment",
    amount: payAmount,
    payUrl: link?.url || null, // null時はSquare未設定 or 発行失敗→クライアントはLINE/手動案内へ
  });
});
