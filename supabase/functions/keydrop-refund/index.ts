// ============================================================
// keydrop-refund : SPK運営がキャンセル依頼を「確定」する（★返金は手動・ここでは記録のみ）
// 2026-06-10 / omni  (Phase B 続き)
//
// 方針（オーナー確定 2026-06-10）：自動返金はしない。
//   ・実際の返金は スタッフが Square Dashboard で手動実行する。
//   ・SPK画面に「返金に必要な情報（返金額・キャンセル料・Square決済ID等）」を表示し、
//     スタッフが手動返金 → この関数で「キャンセル確定＋記録」だけ行う（Squareは叩かない）。
//   ・authenticated（SPKログイン）以外は拒否（anon/未ログインは403）。
//   ・冪等：既に refunded なら二重処理しない。
//
// ポリシー（hdm-car-delivery getCancelFee と一致・表示と記録の根拠）:
//   出発まで ≥7日=無料(0%) / 6〜3日=20% / 2〜1日=30% / 当日以降=50%
//   キャンセル料 = ceil(基本料金 × 率)、返金 = 入金額 − キャンセル料（0未満は0）
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED = ["https://nosh2318.github.io"];
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
async function sbPatch(t: string, q: string, d: unknown): Promise<boolean> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(d) });
  if (!r.ok) { console.error(`PATCH ${t}: ${await r.text()}`); return false; }
  const j = await r.json(); return Array.isArray(j) && j.length > 0;
}
async function sbDelete(t: string, q: string) {
  await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "DELETE", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
}
async function notifySlack(text: string) {
  const token = Deno.env.get("SLACK_BOT_TOKEN"); const channel = Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36";
  if (!token) return;
  try { await fetch("https://slack.com/api/chat.postMessage", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text }) }); } catch (e) { console.error("[slack]", e); }
}

// JWTのrole claimを読む（gatewayが署名検証済み。ここでは認可のためroleだけ見る）
function jwtRole(auth: string | null): string {
  try {
    const tok = (auth || "").replace(/^Bearer\s+/i, "");
    const p = tok.split(".")[1]; if (!p) return "";
    const pad = p.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)));
    return payload.role || "";
  } catch { return ""; }
}

// ポリシー：出発までの日数からキャンセル率(%)を返す（hdm getCancelFee と一致）
function policyRate(lendDate: string): number {
  const lend = new Date(lendDate + "T00:00:00+09:00").getTime();
  const now = Date.now();
  const days = Math.ceil((lend - now) / 86400000);
  if (days >= 7) return 0;
  if (days >= 3) return 20;
  if (days >= 1) return 30;
  return 50;
}

Deno.serve(async (req) => {
  _o = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(_o) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // 認可：authenticated（SPKログイン）のみ。anon/未ログインは拒否。
  if (jwtRole(req.headers.get("authorization")) !== "authenticated") {
    return json({ error: "権限がありません（SPKにログインして操作してください）" }, 403);
  }

  let p: any; try { p = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const resId = String(p.reservationId || p.resId || "").trim();
  if (!resId) return json({ error: "予約番号が必要です" }, 400);

  // 予約（KEYDROPのみ）
  const rv = (await sbGet("reservations", `id=eq.${encodeURIComponent(resId)}&select=id,ota,status,lend_date,price,name,vehicle,mail`))[0];
  if (!rv || rv.ota !== "KEYDROP") return json({ error: "対象のKEYDROP予約が見つかりません" }, 404);
  const st = String(rv.status || "");
  if (st === "cancelled" || st === "キャンセル" || st === "cancel") return json({ ok: true, alreadyCancelled: true });

  // 決済台帳
  const pay = (await sbGet("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}&select=status,amount,square_payment_id`))[0];
  if (!pay) return json({ error: "決済記録がありません（未決済の可能性）" }, 409);
  if (pay.status === "refunded") return json({ ok: true, alreadyRefunded: true });
  if (pay.status !== "paid") return json({ error: `入金が確認できません（status=${pay.status}）` }, 409);

  // サーバ側でポリシー再計算
  const base = Number(rv.price || 0);
  const paid = Number(pay.amount || base);
  const rate = policyRate(rv.lend_date);
  const fee = Math.ceil(base * rate / 100);
  let refund = paid - fee;
  if (refund < 0) refund = 0;
  if (refund > paid) refund = paid;

  // ★Squareは叩かない（返金はスタッフがSquare Dashboardで手動実施済みの前提）。
  //  この関数は「キャンセル確定＋記録」だけを行う。
  //  任意：スタッフが実際に返金した額を refundActual で渡せばそれを記録（無ければポリシー値を記録）。
  const refundActual = (p.refundAmount !== undefined && p.refundAmount !== null && !isNaN(Number(p.refundAmount)))
    ? Math.max(0, Math.round(Number(p.refundAmount))) : refund;

  // DB確定：台帳refunded・予約キャンセル・配車解放
  const nowIso = new Date().toISOString();
  await sbPatch("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}`,
    { status: "refunded", refund_amount: refundActual, cancel_fee: fee, cancel_rate: rate, refunded_at: nowIso });
  await sbPatch("reservations", `id=eq.${encodeURIComponent(resId)}`, { status: "キャンセル" });
  await sbDelete("fleet", `reservation_id=eq.${encodeURIComponent(resId)}`);

  await notifySlack([
    `✅ *KEYDROP キャンセル確定*（返金はスタッフが手動実施）`,
    `予約番号: ${resId} / ${rv.name || ""}様（${rv.vehicle || ""}クラス）`,
    `入金 ¥${paid.toLocaleString()} − キャンセル料 ¥${fee.toLocaleString()}(${rate}%) = 返金目安 ¥${refund.toLocaleString()}`,
    `記録した返金額: *¥${refundActual.toLocaleString()}*`,
  ].join("\n"));

  console.log(`[cancel-confirm] ${resId} paid=${paid} fee=${fee}(${rate}%) refund_rec=${refundActual}`);
  return json({ ok: true, rate, fee, refundSuggested: refund, refundRecorded: refundActual, paid });
});
