// Supabase Edge Function: seat-overflow-alert (店舗対応: spk / bt)
// オプション（チャイルド/ベビー/ジュニアシート）の在庫を先の日付まで走査し、
// ある日の必要数が在庫を超えたら Slack にアラート。
//   SPK: reservations / app_settings(seat_stock_spk) → #sapporo_reservation(C08TDTPEB36)
//   BT : bt_reservations / bt_app_settings(seat_stock_bt) → 高松の reservation_notification
// 需要ロジックはOPシートのシート在庫バッジと完全一致:
//   sheet日Dの需要 = 非キャンセル予約で lend<=D+1 かつ (return>=D または lend>=D) の optB/C/J 合計
//   （＝当日アクティブ + 翌日出発の積込準備分。★2026-08-13 返却日もシートを占有(>=)＝返却当日も在庫にカウント[オーナー承認]）
// dedup: seat_alert_state(store,alert_date,seat,over)。新規発生 or 不足増加のみ通知。
//   解消した(date,seat)は state から削除→再発時に再通知。過去日も掃除。
// pg_cron が x-cron-secret + body{store} で起動。既存機能には一切手を入れない（監視・通知のみ）。
// deploy: functions deploy seat-overflow-alert --no-verify-jwt
//   secrets: CRON_SECRET, SLACK_BOT_TOKEN

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbGet(p: string) { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); return r.ok ? await r.json() : []; }
function json(o: unknown) { return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } }); }

const WINDOW_DAYS = 45; // 走査する先の日数（本日含む）
const SEATS = [
  { k: "b", col: "opt_b", label: "ベビーシート" },
  { k: "c", col: "opt_c", label: "チャイルドシート" },
  { k: "j", col: "opt_j", label: "ジュニアシート" },
];
const WK = ["日", "月", "火", "水", "木", "金", "土"];

const STORES: Record<string, any> = {
  spk: { label: "札幌", resv: "reservations", lendCol: "lend_date", retCol: "return_date", settings: "app_settings", stockKey: "seat_stock_spk", channel: "C08TDTPEB36" },
  bt:  { label: "高松", resv: "bt_reservations", lendCol: "start_date", retCol: "end_date", settings: "bt_app_settings", stockKey: "seat_stock_bt", channel: Deno.env.get("BT_SEAT_ALERT_CHANNEL") || "" },
};

function isCancelled(st: string): boolean {
  const s = String(st || "").toLowerCase();
  return s === "cancelled" || s === "cancel" || String(st) === "キャンセル";
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, n: number): Date { return new Date(base.getTime() + n * 86400000); }
function fmtMd(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  const wd = WK[new Date(dateStr + "T00:00:00+09:00").getDay()];
  return `${m}/${d}(${wd})`;
}

async function slackPost(channel: string, text: string, blocks?: unknown[]): Promise<boolean> {
  if (!SLACK_TOKEN) { console.error("[slack] no SLACK_BOT_TOKEN"); return false; }
  if (!channel) { console.error("[slack] no channel"); return false; }
  const body: any = { channel, text };
  if (blocks) body.blocks = blocks;
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) { console.error("[slack]", JSON.stringify(d)); return false; }
    return true;
  } catch (e) { console.error("[slack]", String(e)); return false; }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("unauthorized", { status: 401 });
  let store = "spk";
  let testMode = false;
  let dryRun = false;
  try { const b = await req.json(); if (b && STORES[b.store]) store = b.store; if (b && b.test === true) testMode = true; if (b && b.dryRun === true) dryRun = true; } catch { /* default spk */ }
  const S = STORES[store];

  // Slack疎通テスト: DBに一切書かず サンプル投稿のみ（bot招待確認用）
  if (testMode) {
    const posted = await slackPost(S.channel, `🧪 シート在庫オーバー アラート 疎通テスト（実データではありません）— ${S.label}店`, [
      { type: "header", text: { type: "plain_text", text: `🧪 シート在庫オーバー 疎通テスト — ${S.label}店`, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: "これは投稿疎通テストです（DBには何も書き込みません）。\n• *7/30(木)* チャイルドシート 必要4 / 在庫3 → 🔴不足1" } },
      { type: "divider" },
    ]);
    return json({ ok: true, store, test: true, posted });
  }

  // 在庫設定
  const stRows = await sbGet(`${S.settings}?key=eq.${S.stockKey}&select=value`);
  let stock: Record<string, number> = { b: 0, c: 0, j: 0 };
  if (Array.isArray(stRows) && stRows[0] && stRows[0].value != null) {
    try { const raw = (stRows[0] as any).value; const v = typeof raw === "string" ? JSON.parse(raw) : raw; if (v && typeof v === "object") stock = { b: +(v.b || 0), c: +(v.c || 0), j: +(v.j || 0) }; } catch { /* keep 0 */ }
  }

  const nowJST = new Date(Date.now() + 9 * 3600 * 1000);
  const today = ymd(nowJST);
  const lastDay = ymd(addDays(nowJST, WINDOW_DAYS));

  // 走査対象の予約（本日以降に絡む・オプションあり）を一括取得
  const rows = await sbGet(`${S.resv}?${S.retCol}=gte.${today}&or=(opt_b.gt.0,opt_c.gt.0,opt_j.gt.0)&select=id,name,${S.lendCol},${S.retCol},status,opt_b,opt_c,opt_j`);
  const active = (rows as any[]).map((r) => ({ ...r, _lend: r[S.lendCol], _ret: r[S.retCol] })).filter((r) => !isCancelled(r.status) && r._lend && r._ret);

  // 日付ループ（本日..本日+WINDOW）で需要を算出し在庫と比較
  type Short = { date: string; seat: string; label: string; demand: number; stock: number; over: number };
  const shortages: Short[] = [];
  for (let i = 0; i <= WINDOW_DAYS; i++) {
    const D = ymd(addDays(nowJST, i));
    const tomorrow = ymd(addDays(nowJST, i + 1));
    const act = active.filter((r) => r._lend <= tomorrow && (r._ret >= D || r._lend >= D));
    for (const s of SEATS) {
      const demand = act.reduce((sum, r) => sum + (+(r[s.col] || 0)), 0);
      const stk = stock[s.k] || 0;
      if (demand > stk) shortages.push({ date: D, seat: s.k, label: s.label, demand, stock: stk, over: demand - stk });
    }
  }

  // 既存 state（この店舗）
  const stateRows = await sbGet(`seat_alert_state?store=eq.${store}&select=alert_date,seat,over`);
  const prev: Record<string, number> = {};
  (stateRows as any[]).forEach((r) => { prev[`${r.alert_date}|${r.seat}`] = +(r.over || 0); });
  const curKeys = new Set(shortages.map((s) => `${s.date}|${s.seat}`));

  // 新規発生 or 不足増加のみ通知対象
  const toNotify = shortages.filter((s) => {
    const key = `${s.date}|${s.seat}`;
    const p = prev[key];
    return p === undefined || s.over > p;
  });

  let posted = false;
  if (toNotify.length && !dryRun) {
    toNotify.sort((a, b) => a.date.localeCompare(b.date) || a.seat.localeCompare(b.seat));
    const lines = toNotify.map((s) => `• *${fmtMd(s.date)}* ${s.label} 必要${s.demand} / 在庫${s.stock} → 🔴不足${s.over}`);
    const header = `🪑 シート在庫オーバー アラート — ${S.label}店（${toNotify.length}件）`;
    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: header, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `オプション（チャイルド/ベビー/ジュニアシート）の必要数が在庫を超える日があります（本日〜${WINDOW_DAYS}日先）。\n在庫を追加手配するか、予約のシート数を調整してください。` } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      { type: "context", elements: [{ type: "mrkdwn", text: `👉 OPシート「🪑 シート在庫」で各日を確認・在庫数は「⚙ 在庫設定」で変更` }] },
      { type: "divider" },
    ];
    posted = await slackPost(S.channel, header, blocks);
  }

  // dryRun は state を書き換えない（検証用）
  if (dryRun) return json({ ok: true, store, dryRun: true, stock, shortages, toNotify });

  // state 更新（通知成功時のみ書く。通知が無い日も現状の over を反映して差分検知を正確に）
  if (posted || toNotify.length === 0) {
    // 現在の全 shortage を upsert
    if (shortages.length) {
      await fetch(`${SB_URL}/rest/v1/seat_alert_state?on_conflict=store,alert_date,seat`, {
        method: "POST",
        headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(shortages.map((s) => ({ store, alert_date: s.date, seat: s.seat, over: s.over, updated_at: new Date().toISOString() }))),
      });
    }
    // 解消 or 過去日の state を掃除（再発時に再通知させる）
    for (const key of Object.keys(prev)) {
      const [d] = key.split("|");
      if (!curKeys.has(key) || d < today) {
        const [ad, seat] = key.split("|");
        await fetch(`${SB_URL}/rest/v1/seat_alert_state?store=eq.${store}&alert_date=eq.${ad}&seat=eq.${seat}`, { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } });
      }
    }
  }

  return json({ ok: true, store, posted, notified: toNotify.length, totalShortages: shortages.length, items: toNotify });
});
