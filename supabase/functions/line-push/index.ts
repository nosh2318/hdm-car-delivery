// Supabase Edge Function: line-push (店舗対応: spk / nha)
// 予約番号→userId解決→LINE push→ログ。挨拶文付与・設定ON/OFF・テストモード・誤送信ガード。
// body: { secret, store('spk'|'nha'), resv_no, action, message }
//   action: damage_check | track_del | track_col | test/owner_test
// deploy: functions deploy line-push --no-verify-jwt
//   secrets: LINE_CHANNEL_TOKEN(spk), NHA_LINE_CHANNEL_TOKEN(nha), FUNC_SECRET

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const TOKENS: Record<string, string> = {
  spk: Deno.env.get("LINE_CHANNEL_TOKEN") || "",
  nha: Deno.env.get("NHA_LINE_CHANNEL_TOKEN") || "",
};
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbGet(p: string) { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); return r.ok ? await r.json() : []; }
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  if (body.secret !== FUNC_SECRET) return json({ ok: false, error: "unauthorized" }, 401);

  const store = (body.store === "nha") ? "nha" : "spk";
  const resv_no = String(body.resv_no || "").trim();
  const action = String(body.action || "").trim();
  const message = String(body.message || "").trim();
  if (!resv_no || !action || !message) return json({ ok: false, error: "missing params" }, 400);

  const LINKS = `${store}_line_links`, CFG = `${store}_line_config`, SENDS = `${store}_line_sends`;
  const RESV = store === "nha" ? "nha_reservations" : "reservations";
  const delCol = store === "nha" ? "start_date" : "lend_date";
  const colCol = store === "nha" ? "end_date" : "return_date";
  const LINE_TOKEN = TOKENS[store];
  const isTest = action === "test" || action === "owner_test";
  const logSend = async (rec: Record<string, unknown>) => {
    await fetch(`${SB_URL}/rest/v1/${SENDS}`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(rec) });
  };

  // 予約の実在・状態・日付ガード（誤送信対策）
  const resv = await sbGet(`${RESV}?id=eq.${encodeURIComponent(resv_no)}&select=id,ota,status,${delCol},${colCol}`);
  // KEYDROP予約も送信対象（linksにuserIDがあれば送る＝HANDYMAN LINE登録済み。無ければno_useridで安全に止まる）
  if (!isTest) {
    if (!resv[0]) { await logSend({ resv_no, action, status: "skipped", error: "reservation_not_found" }); return json({ ok: false, reason: "reservation_not_found" }); }
    const st = String(resv[0].status || "").toLowerCase();
    if (st.includes("cancel") || st.includes("キャンセル")) { await logSend({ resv_no, action, status: "skipped", error: "cancelled" }); return json({ ok: false, reason: "cancelled" }); }
    // マイページ関連通知（mypage_*）は日付ウィンドウ外でも送る（承認/却下・各種案内は将来/過去日どちらでも必要）
    const noticeAct = action.startsWith("mypage_");
    if (!noticeAct) {
    const nowMs = Date.now() + 9 * 3600 * 1000;
    const dstr = (off: number) => new Date(nowMs + off * 86400000).toISOString().slice(0, 10);
    const todayJST = dstr(0);
    // 返却時アクション(回収追跡/乗り捨て/御礼)は返却日で、貸出時アクション(傷チェック/お届け追跡/到着)は貸出日で判定
    const returnAct = action === "track_col" || action === "dropoff" || action === "thanks" || action === "col_arrival";
    const refDate = returnAct ? resv[0][colCol] : resv[0][delCol];
    const rd = refDate ? String(refDate).slice(0, 10) : "";
    if (action === "thanks") {
      // 御礼は返却が直近(過去7日〜明日)ならOK＝返却翌日の自動送信を通す
      if (!rd || rd < dstr(-7) || rd > dstr(1)) { await logSend({ resv_no, action, status: "skipped", error: "thanks_out_of_window:" + rd }); return json({ ok: false, reason: "thanks_out_of_window" }); }
    } else {
      if (!rd || rd < todayJST) { await logSend({ resv_no, action, status: "skipped", error: "past_or_no_date:" + rd }); return json({ ok: false, reason: "past_or_no_date" }); }
    }
    }
  }

  // 予約番号 → userId（完全一致）
  const link = await sbGet(`${LINKS}?resv_no=eq.${encodeURIComponent(resv_no)}&select=line_user_id`);
  const realUserId = link[0]?.line_user_id;
  if (!realUserId) { await logSend({ resv_no, action, status: "no_userid", message }); return json({ ok: false, reason: "no_userid" }); }

  // 安全スイッチ
  const cfg = (await sbGet(`${CFG}?id=eq.1&select=*`))[0] || {};
  let enabled = true;
  if (action === "damage_check") enabled = cfg.damage_enabled === true;
  else if (action === "track_del" || action === "track_col") enabled = cfg.track_enabled === true;
  const testActive = !isTest && cfg.test_mode === true;
  if (!isTest && !testActive && !enabled) { await logSend({ resv_no, action, line_user_id: realUserId, status: "skipped", error: "disabled" }); return json({ ok: false, reason: "disabled" }); }

  const GREETING = "この度はHANDYMANをご利用頂きまして誠にありがとうございます。\n\n";
  const isRealMsg = action === "damage_check" || action === "track_del" || action === "track_col";
  const withGreeting = isRealMsg ? GREETING + message : message;
  let targetUser = realUserId;
  let outMsg = withGreeting;
  if (testActive) {
    if (!cfg.test_user_id) { await logSend({ resv_no, action, status: "skipped", error: "test_no_target" }); return json({ ok: false, reason: "test_no_target(テスト宛先未設定)" }); }
    targetUser = cfg.test_user_id;
    outMsg = "【テストモード】\n" + withGreeting + "\n（本番なら宛先: " + String(realUserId).slice(0, 8) + "…）";
  }

  if (!LINE_TOKEN) { await logSend({ resv_no, action, line_user_id: targetUser, status: "failed", error: "no_line_token(" + store + ")" }); return json({ ok: false, reason: "no_line_token" }, 500); }
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: targetUser, messages: [{ type: "text", text: outMsg }] }),
  });
  if (r.ok) { await logSend({ resv_no, action, line_user_id: targetUser, status: "sent", message: outMsg, error: testActive ? "TEST_MODE" : null }); return json({ ok: true, test: testActive, store }); }
  const err = await r.text();
  await logSend({ resv_no, action, line_user_id: targetUser, status: "failed", message: outMsg, error: err.slice(0, 300) });
  return json({ ok: false, reason: "line_error", error: err.slice(0, 300) }, 502);
});
