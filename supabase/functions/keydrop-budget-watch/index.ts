// ============================================================
// keydrop-budget-watch : KEYDROP 地図API 予算監視ワーカー（日次・Slack通知）
// 2026-06-13 / omni
//
// 役割: keydrop_map_loads（当月・全店合算）を読み、Google Maps の
//       無料枠(月10,000 map load)・月予算(¥10,000)に対する消費を判定し、
//       閾値到達時のみ Slack に通知する（同じ段階を二重通知しない）。
//   - pg_cron が日次で net.http_post（x-cron-secret 認証）で起動。
//   - verify_jwt=false でデプロイ（config.toml に固定）。CRON_SECRET 一致時のみ実行。
//   - 通知段階: 無料枠80% / 無料枠100%(=課金開始) / 予算50% / 予算80% / 予算100%。
//
// 必要なSupabase Secrets: SUPABASE_SERVICE_ROLE_KEY(自動), CRON_SECRET, SLACK_BOT_TOKEN,
//                         SLACK_KEYDROP_CHANNEL(任意・既定#okinawa…/札幌ch)
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const SLACK_CH = Deno.env.get("SLACK_BUDGET_CHANNEL") || Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36"; // 既定=KEYDROPチャンネル（オーナー指定 2026-06-13・現在のデプロイ済挙動と一致）

function yen(n: number) { return "¥" + Math.round(n).toLocaleString("ja-JP"); }
function jstYM() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function jstDay() { return new Date(Date.now() + 9 * 3600 * 1000).getUTCDate(); }
function daysInMonth() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getUTCDate();
}

async function sbGet(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) { console.error("sbGet", path, await r.text()); return []; }
  return await r.json();
}
async function sbPatch(path: string, body: unknown): Promise<boolean> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  return r.ok;
}
async function notifySlack(text: string) {
  if (!SLACK_TOKEN) { console.warn("no SLACK_BOT_TOKEN"); return; }
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: SLACK_CH, text }),
    });
  } catch (e) { console.error("slack", e); }
}

Deno.serve(async (req) => {
  // pg_cron からの呼び出しのみ許可（CRON_SECRET）
  const sec = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || sec !== CRON_SECRET) return new Response("forbidden", { status: 403 });

  const ym = jstYM();
  // 設定
  const cfgRows = await sbGet(`keydrop_budget?id=eq.1&select=*`);
  const cfg = cfgRows[0] || { monthly_budget_yen: 10000, free_loads: 10000, yen_per_1000: 1050, last_alert_ym: null, last_alert_pct: 0 };
  const budget = Number(cfg.monthly_budget_yen) || 10000;
  const freeLoads = Number(cfg.free_loads) || 10000;
  const per1000 = Number(cfg.yen_per_1000) || 1050;

  // 当月の地図起動回数（全店合算）
  const rows = await sbGet(`keydrop_map_loads?ym=eq.${ym}&select=store,loads`);
  const loads = rows.reduce((s: number, r: any) => s + Number(r.loads || 0), 0);
  const bySpk = rows.find((r: any) => r.store === "spk")?.loads || 0;
  const byNha = rows.find((r: any) => r.store === "nha")?.loads || 0;

  // コスト・割合
  const billable = Math.max(0, loads - freeLoads);
  const costYen = (billable / 1000) * per1000;
  const budgetPct = budget > 0 ? Math.round((costYen / budget) * 100) : 0;
  const freePct = freeLoads > 0 ? Math.round((loads / freeLoads) * 100) : 0;

  // 月末着地予測（日割り）
  const day = jstDay(), dim = daysInMonth();
  const projLoads = day > 0 ? Math.round(loads / day * dim) : loads;
  const projBillable = Math.max(0, projLoads - freeLoads);
  const projCost = (projBillable / 1000) * per1000;

  // ── 今日の増分（前回レポート時の累計との差＝直近24h分）──
  const costAt = (n: number) => Math.max(0, n - freeLoads) / 1000 * per1000;
  const lastRepYm = cfg.last_report_ym, lastRepLoads = Number(cfg.last_report_loads) || 0;
  const baseLoads = (lastRepYm === ym) ? lastRepLoads : 0; // 月またぎは0から
  const todayLoads = Math.max(0, loads - baseLoads);
  const todayCost = Math.max(0, costAt(loads) - costAt(baseLoads));
  const remainYen = Math.max(0, budget - costYen);          // 予算残高
  const remainPct = budget > 0 ? Math.max(0, Math.round((remainYen / budget) * 100)) : 0;

  // ── 閾値（新規到達した時だけ"超過アラート"行を冒頭に付ける）──
  let stage = 0, alertHead = "";
  if (budgetPct >= 100) { stage = 100; alertHead = "🔴🔴🔴 *予算100%超過* 🔴🔴🔴\n"; }
  else if (budgetPct >= 80) { stage = 80; alertHead = "🟠 *予算80%到達*\n"; }
  else if (budgetPct >= 50) { stage = 50; alertHead = "🟡 *予算50%到達*\n"; }
  else if (freePct >= 100) { stage = 12; alertHead = "🟠 *無料枠を超過（課金開始・地図は止まりません）*\n"; }
  else if (freePct >= 80) { stage = 8; alertHead = "🟡 *無料枠80%（まもなく課金圏）*\n"; }
  const lastStage = (cfg.last_alert_ym === ym) ? (Number(cfg.last_alert_pct) || 0) : 0;
  const head = (stage > lastStage) ? alertHead : "";

  // ── 日次レポート（毎日発信：今日の使用量/料金＋予算残高）──
  const report = head +
    `📊 *KEYDROP 地図API 日次レポート* (${ym}-${String(jstDay()).padStart(2, "0")})\n` +
    `・今日: *${todayLoads.toLocaleString()}回* / 推定 ${yen(todayCost)}\n` +
    `・当月累計: ${loads.toLocaleString()}回 / 推定 ${yen(costYen)}（札幌${Number(bySpk).toLocaleString()}/那覇${Number(byNha).toLocaleString()}）\n` +
    `・無料枠: ${loads.toLocaleString()} / ${freeLoads.toLocaleString()}（${freePct}%）\n` +
    `・予算残高: *${yen(remainYen)}* / ${yen(budget)}（残${remainPct}%）\n` +
    `・月末着地予測: ${projLoads.toLocaleString()}回 → 推定 ${yen(projCost)}` + (projCost > budget ? "（⚠️予算超過ペース）" : "");

  await notifySlack(report);
  await sbPatch(`keydrop_budget?id=eq.1`, {
    last_report_ym: ym, last_report_loads: loads,
    last_alert_ym: ym, last_alert_pct: Math.max(stage, lastStage),
    updated_at: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true, ym, today: todayLoads, todayCost, loads, costYen, remainYen, budgetPct, freePct, stage }), {
    headers: { "content-type": "application/json" },
  });
});
