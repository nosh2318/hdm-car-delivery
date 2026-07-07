// Supabase Edge Function: damage-check-cron (店舗対応: spk / nha)
// 出発の一定時間前に、割当車両の傷チェックURLを対象顧客へ自動送信（line-push経由）
//   SPK: type=DEL / lead=30分 / tasks / reservations.lend_date
//   NHA: 内容 in (PUB,DEL,来店) / lead=60分 / nha_tasks / nha_reservations.start_date
// pg_cron が x-cron-secret + body{store} で5分毎に起動。KEYDROPは別LINE=除外。
// deploy: functions deploy damage-check-cron --no-verify-jwt  (secrets: FUNC_SECRET, CRON_SECRET)

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const DMG_BASE = "https://nosh2318.github.io/handyman-damage/v.html";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbGet(p: string) { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); return r.ok ? await r.json() : []; }
function json(o: unknown) { return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } }); }
const enc = encodeURIComponent;

const STORES: Record<string, any> = {
  spk: { tasks: "tasks", typeCol: "type", typeVals: ["DEL"], timeCol: "time", resvCol: "reservation_id", otaCol: "ota", assigneeCol: "assignee", cfg: "spk_line_config", sends: "spk_line_sends", doneCol: "done", defLead: 30 },
  nha: { tasks: "nha_tasks", typeCol: "内容", typeVals: ["PUB", "DEL", "来店"], timeCol: "時間", resvCol: "予約番号", otaCol: "OTA", assigneeCol: "担当", cfg: "nha_line_config", sends: "nha_line_sends", doneCol: null, defLead: 60 },
};
// 無人貸出・乗り捨ては傷チェック自動送信の対象外（担当欄でスタッフが手動運用）。将来 全体で自動ONになっても、この2種は除外を維持する。
const UNATTENDED_RE = /無人|乗り?捨/;

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("unauthorized", { status: 401 });
  let store = "spk";
  try { const b = await req.json(); if (b && b.store === "nha") store = "nha"; } catch { /* default spk */ }
  const S = STORES[store];

  const cfg = (await sbGet(`${S.cfg}?id=eq.1&select=*`))[0] || {};
  if (cfg.damage_enabled !== true && cfg.test_mode !== true) return json({ ok: true, store, skipped: "disabled" });
  const lead = cfg.lead_min || S.defLead;

  const nowJST = new Date(Date.now() + 9 * 3600 * 1000);
  const today = nowJST.toISOString().slice(0, 10);
  const nowMin = nowJST.getUTCHours() * 60 + nowJST.getUTCMinutes();

  // タスク取得（列名は日本語含むのでencode）
  let q = `${S.tasks}?date=eq.${today}&${enc(S.typeCol)}=in.(${S.typeVals.map(enc).join(",")})&${enc(S.resvCol)}=not.is.null&select=${enc(S.resvCol)},${enc(S.timeCol)},assigned_vehicle,${enc(S.otaCol)},${enc(S.assigneeCol)}`;
  if (S.doneCol) q += `&${enc(S.doneCol)}=eq.false`;
  const tasks = await sbGet(q);
  const cands = (tasks as any[]).map((t) => ({ resv: t[S.resvCol], time: t[S.timeCol], veh: t.assigned_vehicle, ota: t[S.otaCol], asg: t[S.assigneeCol] }))
    .filter((t) => {
      if (!t.resv || !t.veh) return false;
      if (t.asg && UNATTENDED_RE.test(String(t.asg))) return false; // 無人貸出・乗り捨ては自動送信しない
      if (!t.time || !/^\d{1,2}:\d{2}/.test(t.time)) return false;
      const [h, m] = t.time.split(":").map(Number);
      const until = (h * 60 + m) - nowMin;
      return until > 0 && until <= lead;
    });
  if (!cands.length) return json({ ok: true, store, candidates: 0 });

  const resvList = cands.map((t) => t.resv);
  const sent = await sbGet(`${S.sends}?action=eq.damage_check&status=eq.sent&resv_no=in.(${resvList.map(enc).join(",")})&select=resv_no`);
  const sentSet = new Set((sent as any[]).map((s) => s.resv_no));

  const vcodes = [...new Set(cands.map((t) => t.veh).filter(Boolean))];
  const tokenMap: Record<string, string> = {};
  if (vcodes.length) {
    const tw = await sbGet(`vehicle_twins?id=in.(${vcodes.map(enc).join(",")})&share_enabled=eq.true&select=id,share_token`);
    (tw as any[]).forEach((v) => { tokenMap[v.id] = v.share_token; });
  }

  const results: any[] = [];
  for (const t of cands) {
    if (sentSet.has(t.resv)) continue;
    const tok = tokenMap[t.veh];
    if (!tok) { results.push({ resv: t.resv, skip: "no_dmg_token" }); continue; }
    const url = `${DMG_BASE}?t=${tok}&v=v3`;
    const msg = "【HANDYMAN " + (store === "nha" ? "那覇" : "札幌") + "】ご利用車両 傷チェックのご案内\nご出発前に、車両の状態を下記URLからご確認ください（アプリ不要）。\n" + url + "\n気になる点がございましたら車両引き渡し時に担当スタッフまでお申し付けくださいませ。\n※ご出発後の申告は対応いたしかねる場合がございます。";
    const r = await fetch(`${SB_URL}/functions/v1/line-push`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: FUNC_SECRET, store, resv_no: t.resv, action: "damage_check", message: msg }),
    });
    const jr = await r.json().catch(() => ({}));
    results.push({ resv: t.resv, ...jr });
  }
  return json({ ok: true, store, processed: results.length, results });
});
