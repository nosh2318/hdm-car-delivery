// ============================================================
// payment-reconcile-monitor : 消し込みの安全網（webhook落ち対策・誤催促の最後の砦）
// 2026-09-16 / 全店全種別の"未払い(square_order_id有)"をSquareで照合し、
//   既にSquareで払われているのにDB未払いのもの(=webhook見逃し)を検出→DB paid化+Slack通知。
//   webhookが主（払った瞬間）、これは保険（毎時）。差分0なら静か＝webhook正常の証明も兼ねる。
// ============================================================
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SQ = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const SLACK_CH = Deno.env.get("SLACK_DEV_CHANNEL") || "C07B5G3PV7C"; // #handyman_development
const BT_URL = Deno.env.get("BT_URL") || "";
const BT_KEY = Deno.env.get("BT_SERVICE_KEY") || "";

async function sbGet(u: string, k: string, q: string): Promise<any[]> {
  const r = await fetch(`${u}/rest/v1/${q}`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
  if (!r.ok) { console.error("GET", q, await r.text()); return []; }
  return await r.json();
}
async function sbPatch(u: string, k: string, q: string, data: unknown) {
  const r = await fetch(`${u}/rest/v1/${q}`, { method: "PATCH", headers: { apikey: k, Authorization: `Bearer ${k}`, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(data) });
  if (!r.ok) console.error("PATCH", q, await r.text());
}
async function squarePaid(orderId: string): Promise<boolean> {
  if (!SQ || !orderId) return false;
  try {
    const r = await fetch(`https://connect.squareup.com/v2/orders/${orderId}`, { headers: { Authorization: `Bearer ${SQ}`, "Square-Version": "2024-01-18" } });
    if (!r.ok) return false;
    const o = (await r.json())?.order || {};
    return o.state === "COMPLETED" || (Array.isArray(o.tenders) && o.tenders.length > 0); // tender有り=支払い済み(OPEN残りも救済)
  } catch { return false; }
}
async function notifySlack(text: string) {
  if (!SLACK_TOKEN || !SLACK_CH) return;
  try { await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { "content-type": "application/json; charset=utf-8", Authorization: `Bearer ${SLACK_TOKEN}` }, body: JSON.stringify({ channel: SLACK_CH, text }) }); } catch (_) {}
}

Deno.serve(async (req) => {
  const p = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET && !p.test) return new Response("forbidden", { status: 403 });
  const dry = !!p.dry;
  const fixed: string[] = [];
  let checked = 0;

  // 対象: MAIN(jalan_payments/nha_jalan_payments=status系, nha_accounting/spk_accounting=paid系) + BT(bt_jalan_payments/bt_accounting)
  const targets = [
    { db: "main", tbl: "jalan_payments", kind: "status", filt: "status=in.(link_created,email_sent)&square_order_id=not.is.null", key: "reservation_id" },
    { db: "main", tbl: "nha_jalan_payments", kind: "status", filt: "status=in.(link_created,email_sent)&square_order_id=not.is.null", key: "reservation_id" },
    { db: "main", tbl: "nha_accounting", kind: "paid", filt: "paid=eq.false&square_order_id=not.is.null&type=in.(advance,extra_sales)", key: "id" },
    { db: "main", tbl: "spk_accounting", kind: "paid", filt: "paid=eq.false&square_order_id=not.is.null&type=in.(advance,extra_sales)", key: "id" },
    { db: "bt", tbl: "bt_jalan_payments", kind: "status", filt: "status=in.(link_created,email_sent)&square_order_id=not.is.null", key: "reservation_id" },
    { db: "bt", tbl: "bt_accounting", kind: "paid", filt: "paid=eq.false&square_order_id=not.is.null&type=in.(advance,extra_sales)", key: "id" },
  ];
  for (const t of targets) {
    const u = t.db === "bt" ? BT_URL : SB_URL, k = t.db === "bt" ? BT_KEY : SB_KEY;
    if (!u || !k) continue;
    const rows = await sbGet(u, k, `${t.tbl}?${t.filt}&select=${t.key},square_order_id&limit=500`);
    for (const r of rows) {
      checked++;
      if (!(await squarePaid(r.square_order_id))) continue;
      // Squareで払われているのにDB未払い＝webhook見逃し → 是正
      const patch = t.kind === "paid" ? { paid: true } : { status: "paid", paid_at: new Date().toISOString() };
      if (!dry) await sbPatch(u, k, `${t.tbl}?${t.key}=eq.${encodeURIComponent(r[t.key])}`, patch);
      fixed.push(`${t.tbl}:${r[t.key]}`);
    }
  }
  if (fixed.length > 0 && !dry) {
    await notifySlack(`⚠️ *決済 消し込み漏れを是正（webhook見逃し検知）* ${fixed.length}件\n${fixed.slice(0, 20).join("\n")}\n→ DBをpaid化しました（誤催促を防止）。webhookの疎通を確認してください。`);
  }
  console.log(`[reconcile] checked=${checked} fixed=${fixed.length}`);
  return new Response(JSON.stringify({ ok: true, checked, fixed: fixed.length, detail: fixed }), { headers: { "content-type": "application/json" } });
});
