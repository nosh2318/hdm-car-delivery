// Supabase Edge Function: damage-check-cron (店舗対応: spk / nha)
// 出発日の朝8:00に、割当車両の傷チェックURLを対象顧客へ自動送信（line-push経由）※2026-07-08 8時統一(那覇/札幌)
//   SPK: type=DEL / tasks / reservations.lend_date
//   NHA: 内容 in (PUB,DEL,来店) / nha_tasks / nha_reservations.start_date
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
  spk: { tasks: "tasks", typeCol: "type", typeVals: ["DEL"], timeCol: "time", resvCol: "reservation_id", otaCol: "ota", assigneeCol: "assignee", cfg: "spk_line_config", sends: "spk_line_sends", doneCol: "done", resvTbl: "reservations", resvTimeCol: "lend_time", defLead: 30 },
  nha: { tasks: "nha_tasks", typeCol: "内容", typeVals: ["PUB", "DEL", "来店"], timeCol: "時間", resvCol: "予約番号", otaCol: "OTA", assigneeCol: "担当", cfg: "nha_line_config", sends: "nha_line_sends", doneCol: null, resvTbl: "nha_reservations", resvTimeCol: "start_time", defLead: 60 },
};
// 無人貸出・乗り捨ては傷チェック自動送信の対象外（担当欄でスタッフが手動運用）。将来 全体で自動ONになっても、この2種は除外を維持する。
const UNATTENDED_RE = /無人|乗り?捨/;
// "HH:MM" → 分。時刻不明は null。
function parseMin(v: unknown): number | null { const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; }

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

  // タスク取得（列名は日本語含むのでencode）※done は SQL で除外せず JS で「未出発判定」に使う（早めにdone化された未出発便を救済）
  let sel = `${enc(S.resvCol)},${enc(S.timeCol)},assigned_vehicle,${enc(S.otaCol)},${enc(S.assigneeCol)}`;
  if (S.doneCol) sel += `,${enc(S.doneCol)}`;
  const q = `${S.tasks}?date=eq.${today}&${enc(S.typeCol)}=in.(${S.typeVals.map(enc).join(",")})&${enc(S.resvCol)}=not.is.null&select=${sel}`;
  const tasks = await sbGet(q);
  const rawCands = (tasks as any[]).map((t) => ({ resv: t[S.resvCol], time: t[S.timeCol], veh: t.assigned_vehicle, ota: t[S.otaCol], asg: t[S.assigneeCol], done: S.doneCol ? (t[S.doneCol] === true) : false }));

  // 予約の出発時刻（タスク時刻が空の時の補完＝出発済み判定に使う）
  const rc0 = rawCands.filter((t) => t.resv && t.veh);
  const lendMap: Record<string, string> = {};
  const rlist0 = [...new Set(rc0.map((t) => t.resv))];
  if (rlist0.length) {
    const rr = await sbGet(`${S.resvTbl}?id=in.(${rlist0.map(enc).join(",")})&select=id,${enc(S.resvTimeCol)}`);
    (rr as any[]).forEach((r) => { lendMap[r.id] = r[S.resvTimeCol]; });
  }

  const cands = rc0.filter((t) => {
    if (t.asg && UNATTENDED_RE.test(String(t.asg))) return false; // 無人貸出・乗り捨ては自動送信しない（スタッフ手動運用）
    // ★ 2026-07-08 オーナー確定：傷チェックは「出発日の朝8:00」で統一（那覇・札幌共通）。
    if (nowMin < 480) return false;                                // 8:00前は送らない
    const depMin = parseMin(t.time) ?? parseMin(lendMap[t.resv]);  // 出発時刻（タスク→予約の順で補完）
    // 出発済み(done)は、出発時刻が判明していて かつ まだ出発前 の時だけ救済送信（早めにdone化された未出発便）。それ以外の出発済みは送らない（傷チェックは出発前案内）。
    if (t.done) return depMin != null && nowMin < depMin;
    if (depMin == null) return true;                               // 時刻不明でも当日便なら8時以降に送る
    return depMin >= 480;                                          // 8時より前の早朝便=既出発は除外
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
