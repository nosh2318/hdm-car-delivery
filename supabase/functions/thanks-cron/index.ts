// Supabase Edge Function: thanks-cron (店舗対応: spk / nha)
// 返却翌日、前日に返却した予約へ御礼を自動送信（line-push経由・重複なし）
// pg_cron が x-cron-secret + body{store} で日次起動。thanks_enabled(or test_mode)がONの時のみ動作。
// deploy: functions deploy thanks-cron --no-verify-jwt （secrets: FUNC_SECRET, CRON_SECRET）

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbGet(p: string) { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); return r.ok ? await r.json() : []; }
function json(o: unknown) { return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } }); }
const enc = encodeURIComponent;

const STORES: Record<string, any> = {
  spk: { resv: "reservations", retCol: "return_date", links: "spk_line_links", sends: "spk_line_sends", cfg: "spk_line_config", label: "札幌" },
  nha: { resv: "nha_reservations", retCol: "end_date", links: "nha_line_links", sends: "nha_line_sends", cfg: "nha_line_config", label: "那覇" },
};

function buildMsg(label: string, name: string) {
  const cn = name ? name + "様" : "お客様";
  return "【HANDYMANより御礼】\n" + cn + "\n\n先日はHANDYMAN" + label + "店をご利用いただき、誠にありがとうございました。\nその後、お変わりなくお過ごしでしょうか。\n\n数あるレンタカー店の中から当店をお選びいただけましたこと、スタッフ一同、心より感謝申し上げております。\nお車での道中やご旅行が、お客様にとって素敵なお時間となっておりましたら幸いです。\n\nこれからもお客様に安心・快適にお過ごしいただけますよう、真心を込めてお手伝いしてまいります。\nまたお近くにお越しの際は、ぜひHANDYMANをご用命くださいませ。\n\nこの度は本当にありがとうございました。\nお客様の次のお出かけを、心よりお待ち申し上げております。";
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("unauthorized", { status: 401 });
  let store = "spk";
  try { const b = await req.json(); if (b && b.store === "nha") store = "nha"; } catch { /* default */ }
  const S = STORES[store];

  const cfg = (await sbGet(`${S.cfg}?id=eq.1&select=*`))[0] || {};
  if (cfg.thanks_enabled !== true && cfg.test_mode !== true) return json({ ok: true, store, skipped: "disabled" });

  const nowJST = new Date(Date.now() + 9 * 3600 * 1000);
  const yesterday = new Date(nowJST.getTime() - 86400000).toISOString().slice(0, 10);

  // 昨日 返却の予約（キャンセル除外）
  const resvs = await sbGet(`${S.resv}?${enc(S.retCol)}=eq.${yesterday}&select=id,status`);
  const active = (resvs as any[]).filter((r) => { const s = String(r.status || "").toLowerCase(); return !s.includes("cancel") && !String(r.status || "").includes("キャンセル"); });
  if (!active.length) return json({ ok: true, store, returned: 0 });
  const ids = active.map((r) => r.id);

  // LINE登録客のみ
  const links = await sbGet(`${S.links}?resv_no=in.(${ids.map(enc).join(",")})&select=resv_no,cust_name`);
  if (!links.length) return json({ ok: true, store, returned: active.length, registered: 0 });

  // 既に御礼送信済みは除外
  const linkIds = (links as any[]).map((l) => l.resv_no);
  const sent = await sbGet(`${S.sends}?action=eq.thanks&status=eq.sent&resv_no=in.(${linkIds.map(enc).join(",")})&select=resv_no`);
  const sentSet = new Set((sent as any[]).map((s) => s.resv_no));

  const results: any[] = [];
  for (const l of links as any[]) {
    if (sentSet.has(l.resv_no)) continue;
    const msg = buildMsg(S.label, l.cust_name || "");
    const r = await fetch(`${SB_URL}/functions/v1/line-push`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: FUNC_SECRET, store, resv_no: l.resv_no, action: "thanks", message: msg }),
    });
    const jr = await r.json().catch(() => ({}));
    results.push({ resv: l.resv_no, ...jr });
  }
  return json({ ok: true, store, returned: active.length, processed: results.length, results });
});
