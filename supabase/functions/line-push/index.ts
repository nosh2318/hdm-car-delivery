// Supabase Edge Function: line-push
// HANDYMAN 札幌店 LINE自動送信（傷チェック / 位置追跡URL）
// 呼び出し: POST { secret, resv_no, action, message }
//   action: 'damage_check' | 'track_del' | 'track_col'
// 役割: 予約番号→userId解決 → LINE push → spk_line_sends に記録
//       KEYDROP予約(別LINE)はスキップ / userId無しは no_userid で記録(誤送信しない)
// secret検証で外部濫用を防止。LINEトークン・service_roleはFunction secretから。
// deploy: supabase functions deploy line-push --no-verify-jwt
//   secrets: LINE_CHANNEL_TOKEN, FUNC_SECRET

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_TOKEN")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  return r.ok ? await r.json() : [];
}
async function logSend(rec: Record<string, unknown>) {
  await fetch(`${SB_URL}/rest/v1/spk_line_sends`, {
    method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(rec),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  if (body.secret !== FUNC_SECRET) return json({ ok: false, error: "unauthorized" }, 401);

  const resv_no = String(body.resv_no || "").trim();
  const action = String(body.action || "").trim();
  const message = String(body.message || "").trim();
  if (!resv_no || !action || !message) return json({ ok: false, error: "missing params" }, 400);

  const isTest = action === "test" || action === "owner_test";

  // 予約の実在・状態・日付を確認（誤送信対策の本丸）
  const resv = await sbGet(`reservations?id=eq.${encodeURIComponent(resv_no)}&select=id,ota,status,lend_date,return_date`);
  // KEYDROP除外（別LINEアカウント・今回対象外）
  if (resv[0]?.ota === "KEYDROP") {
    await logSend({ resv_no, action, status: "skipped", error: "keydrop_diff_line" });
    return json({ ok: false, reason: "skipped_keydrop" });
  }
  if (!isTest) {
    // ① 予約が実在しない（＝予約番号タイポ/別物）→ 送らない
    if (!resv[0]) {
      await logSend({ resv_no, action, status: "skipped", error: "reservation_not_found" });
      return json({ ok: false, reason: "reservation_not_found" });
    }
    // ② キャンセル済み → 送らない
    const st = String(resv[0].status || "").toLowerCase();
    if (st.includes("cancel") || st.includes("キャンセル")) {
      await logSend({ resv_no, action, status: "skipped", error: "cancelled" });
      return json({ ok: false, reason: "cancelled" });
    }
    // ③ 出発/返却が過去 → 送らない（DEL=lend_date / COL=return_date）
    const todayJST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const refDate = action === "track_col" ? resv[0].return_date : resv[0].lend_date;
    if (!refDate || String(refDate).slice(0, 10) < todayJST) {
      await logSend({ resv_no, action, status: "skipped", error: "past_or_no_date:" + (refDate || "") });
      return json({ ok: false, reason: "past_or_no_date" });
    }
  }

  // 予約番号 → userId（完全一致）
  const link = await sbGet(`spk_line_links?resv_no=eq.${encodeURIComponent(resv_no)}&select=line_user_id`);
  const realUserId = link[0]?.line_user_id;
  if (!realUserId) {
    await logSend({ resv_no, action, status: "no_userid", message });
    return json({ ok: false, reason: "no_userid" }); // 呼び出し側でSlack通知・手動対応
  }

  // 安全スイッチ（spk_line_config）: ON/OFF＋テストモード
  const cfg = (await sbGet(`spk_line_config?id=eq.1&select=*`))[0] || {};
  let enabled = true;
  if (action === "damage_check") enabled = cfg.damage_enabled === true;
  else if (action === "track_del" || action === "track_col") enabled = cfg.track_enabled === true;
  const testActive = !isTest && cfg.test_mode === true;
  if (!isTest && !testActive && !enabled) {
    await logSend({ resv_no, action, line_user_id: realUserId, status: "skipped", error: "disabled" });
    return json({ ok: false, reason: "disabled" });
  }
  // 全LINE送信 共通の冒頭挨拶（実アクションのみ・テスト/オーナーpingには付けない）
  const GREETING = "この度はHANDYMANをご利用頂きまして誠にありがとうございます。\n\n";
  const isRealMsg = action === "damage_check" || action === "track_del" || action === "track_col";
  const withGreeting = isRealMsg ? GREETING + message : message;
  // テストモード: 宛先を強制的にテスト用(オーナー)へ・本文に印
  let targetUser = realUserId;
  let outMsg = withGreeting;
  if (testActive) {
    targetUser = cfg.test_user_id || realUserId;
    outMsg = "【テストモード】\n" + withGreeting + "\n（本番なら宛先: " + String(realUserId).slice(0, 8) + "…）";
  }

  // LINE push
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: targetUser, messages: [{ type: "text", text: outMsg }] }),
  });
  if (r.ok) {
    await logSend({ resv_no, action, line_user_id: targetUser, status: "sent", message: outMsg, error: testActive ? "TEST_MODE" : null });
    return json({ ok: true, test: testActive });
  } else {
    const err = await r.text();
    await logSend({ resv_no, action, line_user_id: targetUser, status: "failed", message: outMsg, error: err.slice(0, 300) });
    return json({ ok: false, reason: "line_error", error: err.slice(0, 300) }, 502);
  }
});

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
}
