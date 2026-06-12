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
const SLACK_CH = Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36"; // 既定=札幌KEYDROP ch

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

  // 段階判定（高い段階を優先・同じ月で同じ段階は二重通知しない）
  // 数値が大きいほど深刻: 100(予算100)>80(予算80)>50(予算50)>12(無料100=課金開始)>8(無料80)
  let stage = 0, head = "";
  if (budgetPct >= 100) { stage = 100; head = "🔴🔴🔴 *地図API 予算100%超過* 🔴🔴🔴"; }
  else if (budgetPct >= 80) { stage = 80; head = "🟠 *地図API 予算80%* 到達"; }
  else if (budgetPct >= 50) { stage = 50; head = "🟡 *地図API 予算50%* 到達"; }
  else if (freePct >= 100) { stage = 12; head = "🟠 *地図API 無料枠を超過（課金が始まりました）*"; }
  else if (freePct >= 80) { stage = 8; head = "🟡 *地図API 無料枠80%*（まだ¥0・もうすぐ課金圏）"; }

  const lastYM = cfg.last_alert_ym, lastStage = Number(cfg.last_alert_pct) || 0;
  const isNewMonth = lastYM !== ym;
  const shouldAlert = stage > 0 && (isNewMonth || stage > lastStage);

  const summary =
    `当月(${ym}) 地図起動: *${loads.toLocaleString()}回* (札幌${Number(bySpk).toLocaleString()}/那覇${Number(byNha).toLocaleString()})\n` +
    `無料枠: ${loads.toLocaleString()} / ${freeLoads.toLocaleString()} (${freePct}%)\n` +
    `推定コスト: *${yen(costYen)}* / 予算 ${yen(budget)} (${budgetPct}%)\n` +
    `月末着地予測: ${projLoads.toLocaleString()}回 → 推定 ${yen(projCost)}`;

  if (shouldAlert) {
    await notifySlack(`${head}\n${summary}\n${stage >= 12 ? "→ 課金圏です。問題なければ放置でOK（止まりません）。想定外なら不正アクセス等を確認。" : ""}`);
    await sbPatch(`keydrop_budget?id=eq.1`, { last_alert_ym: ym, last_alert_pct: stage, updated_at: new Date().toISOString() });
  } else if (isNewMonth && stage === 0) {
    // 月初の状態リセット（前月通知をクリア）
    await sbPatch(`keydrop_budget?id=eq.1`, { last_alert_ym: ym, last_alert_pct: 0, updated_at: new Date().toISOString() });
  }

  return new Response(JSON.stringify({ ok: true, ym, loads, costYen, budgetPct, freePct, stage, alerted: shouldAlert }), {
    headers: { "content-type": "application/json" },
  });
});
