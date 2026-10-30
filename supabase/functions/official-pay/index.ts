// 2026-10-23 新API鍵移行：新形式の鍵を優先し、無ければ旧鍵（移行期間の保険・旧鍵の無効化前に外す）
function __newKey(env: string, name: string): string { try { return (JSON.parse(Deno.env.get(env) || "{}") as Record<string, string>)[name] || ""; } catch { return ""; } }
console.log("[keymig]", __newKey("SUPABASE_SECRET_KEYS", "edge") ? "secret" : "legacy");
// ============================================================
// official-pay : HANDYMAN公式サイト(rent-handyman.com) 札幌/那覇 カード決済（Square即時課金）
// 2026-08-26 / omni  （official-pay-tkm の 札幌/那覇版・MAINプロジェクトにデプロイ）
// フロー: client tokenize → official_book_spk/nha(総額サーバ確定・配車確保 pending) → Square即時課金
//   成功: status='confirmed' → keydrop_payments記録 → 確定メール(＋マイページURL=②) → 各店ch Slack → {ok}
//   失敗: 予約キャンセル・配車解放
// 決済先: KEYDROPと同一 Square location L8N7J9RKPN3WH（北海道銀行*670）。統一ルール=メール通知。
// --no-verify-jwt（公開フォーム）。
// ============================================================
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = (__newKey("SUPABASE_SECRET_KEYS", "edge") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const SQUARE_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const SQUARE_LOCATION = Deno.env.get("SQUARE_LOCATION_ID") || "L8N7J9RKPN3WH";
const SQUARE_API = "https://connect.squareup.com";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("OFFICIAL_FROM") || "HANDYMAN RENTCAR <reserve@rent-handyman.com>";
const MAIL_REPLY = "reserve@rent-handyman.com";
const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";

const STORE_MAP: Record<string, { rpc: string; resv: string; fleet: string; mypage: string; slackEnv: string; slackDefault: string; resvCh: string; shop: string }> = {
  spk: { rpc: "official_book_spk", resv: "reservations", fleet: "fleet",
    mypage: "https://nosh2318.github.io/spk-task/my.html?t=",
    slackEnv: "SLACK_KEYDROP_CHANNEL", slackDefault: "C08TDTPEB36", resvCh: "C08TDTPEB36", shop: "札幌店" },  // resvCh=#sapporo_reservation(OTA取込と同一)
  nha: { rpc: "official_book_nha", resv: "nha_reservations", fleet: "nha_fleet",
    mypage: "https://nosh2318.github.io/naha-project/my-nha.html?t=",
    slackEnv: "SLACK_KEYDROP_CHANNEL_NAHA", slackDefault: "C06KZ56NTDF", resvCh: "C06KZ56NTDF", shop: "那覇空港店" },  // resvCh=#okinawa_reservation_notification
};
// PostgRESTエイリアスで札幌の項目名に揃える（那覇は start_date 等 → lend_date 等へ）
const SEL: Record<string, string> = {
  spk: "name,mail,vehicle,lend_date,lend_time,return_date,return_time,del_place,insurance,mypage_token",
  nha: "name,mail,vehicle:vehicle_class,lend_date:start_date,lend_time:start_time,return_date:end_date,return_time:end_time,del_place,insurance,mypage_token",
};

const ALLOWED = ["https://nosh2318.github.io", "https://rent-handyman.com", "https://www.rent-handyman.com", "https://handyman-official.github.io", "https://hdm-rentacar.jp", "https://www.hdm-rentacar.jp"];
// 2026-10-28 新サイト(hdm-rentacar.jp)からの予約＝site=hdm2（ota=HANDYMANのまま・バッジHDM2・メール送り元を新ドメインに）
const HDM2_ORIGINS = ["https://hdm-rentacar.jp", "https://www.hdm-rentacar.jp"];
function cors(o: string | null) {
  const allow = o && ALLOWED.includes(o) ? o : ALLOWED[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Vary": "Origin" };
}
let _o: string | null = null;
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(_o), "content-type": "application/json" } });

async function sbGet(t: string, q: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) { console.error(`GET ${t}: ${await r.text()}`); return []; }
  return await r.json();
}
async function sbPatch(t: string, q: string, d: unknown): Promise<void> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(d) });
  if (!r.ok) console.error(`PATCH ${t}: ${await r.text()}`);
}
async function sbPost(t: string, d: unknown): Promise<void> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}`, { method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(d) });
  if (!r.ok) console.error(`POST ${t}: ${await r.text()}`);
}
async function sbDelete(t: string, q: string) {
  await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "DELETE", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
}
async function sbRpc(fn: string, args: unknown): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args) });
  if (!r.ok) { console.error(`RPC ${fn}: ${await r.text()}`); return null; }
  return await r.json();
}
function couponReasonJa(reason: string): string {
  const m: Record<string,string> = {
    not_found:'コードが見つかりません', inactive:'無効なクーポンです', store:'この店舗では使えません',
    not_started:'利用期間前です', expired:'有効期限切れです', min_amount:'最低利用額に達していません',
    exhausted:'上限に達しました', used:'既に使用済みです', empty:'コード未入力',
  };
  return m[reason] || '適用できません';
}
async function notifySlack(text: string, ch: string) {
  if (!SLACK_TOKEN || !ch) return;
  try { await fetch("https://slack.com/api/chat.postMessage", { method: "POST",
    headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: ch, text }) }); } catch (e) { console.error("[slack]", e); }
}
// ★確定メールはBTのofficial-notify経由で送る（MAIN Resendはrent-handyman.com不可・BTのRESEND_API_KEYが認可済）。
//   store+reservationIdを渡し、中継側が予約を読んでHANDYMANブランドで送信。
async function sendConfirmMail(store: string, resId: string, site = ""): Promise<string> {
  const url = Deno.env.get("OFFICIAL_NOTIFY_URL") || "";
  const sec = Deno.env.get("OFFICIAL_NOTIFY_SECRET") || "";
  if (!url || !sec) return "";
  try {
    const r = await fetch(url, { method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": sec },
      body: JSON.stringify({ confirm: true, store, reservationId: resId, site }) });
    const d = await r.json().catch(() => ({}));
    return d?.ok ? "relay" : "";
  } catch (_) { return ""; }
}

Deno.serve(async (req) => {
  _o = req.headers.get("origin");
  const isHdm2 = !!_o && HDM2_ORIGINS.includes(_o);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(_o) });
  if (req.method !== "POST") return J({ error: "POST only" }, 405);

  let p: any; try { p = await req.json(); } catch { return J({ error: "invalid json" }, 400); }

  const store = p.store === "nha" ? "nha" : (p.store === "spk" ? "spk" : "");
  if (!store) return J({ error: "store未指定（spk/nha）" }, 400);
  const M = STORE_MAP[store];
  const slackCh = Deno.env.get(M.slackEnv) || M.slackDefault;

  const token = String(p.token || p.sourceId || "").trim();
  const cls = String(p.vehicleClass || "").trim();
  const lend = String(p.lend_date || "").trim();
  const ret = String(p.return_date || "").trim();
  const name = String(p.name || "").trim();
  const mail = String(p.mail || "").trim();
  const tel = String(p.tel || "").trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!token) return J({ error: "カード情報が取得できませんでした" }, 400);
  if (!cls) return J({ error: "クラス未指定" }, 400);
  if (!dateRe.test(lend) || !dateRe.test(ret) || ret < lend) return J({ error: "日付エラー" }, 400);
  if (!name || !mail || mail.indexOf("@") < 0 || !tel) return J({ error: "予約者情報が不足しています" }, 400);
  if (!SQUARE_TOKEN) return J({ error: "決済が一時的に利用できません" }, 503);

  // 受取方法(receiveMethod)→OPシート区分(サーバ権威・クライアント値は信用しない)
  // 札幌=デリバリー専門で常にDEL/COL／那覇 airport(無料送迎＝送迎バス)→PUB/BDB・store(来店)→来店/返却・delivery→DEL/COL
  // 2026-10-28 那覇の空港送迎はバス(PUB/BDB)。旧PU/BD(個別送迎)ではマイページが「個別送迎」表示になり現場と食い違っていた
  const _m = String(p.receiveMethod || "").toLowerCase();
  const _leg = store === "spk" ? { vt: "DEL", rt: "COL" }
    : _m === "airport" ? { vt: "PUB", rt: "BDB" }
    : _m === "store" ? { vt: "来店", rt: "返却" }
    : { vt: "DEL", rt: "COL" };
  const rpc = await sbRpc(M.rpc, { p: {
    vehicleClass: cls, vehicleModel: String(p.vehicleModel || ""),
    lend_date: lend, return_date: ret, lend_time: String(p.lend_time || ""), return_time: String(p.return_time || ""),
    name, mail, tel, people: p.people,
    insuranceType: String(p.insuranceType || "basic"),
    childSeat: parseInt(String(p.childSeat ?? 0), 10) || 0,
    juniorSeat: parseInt(String(p.juniorSeat ?? 0), 10) || 0,
    usb: p.usb === true || p.opt_usb === 1 || p.opt_usb === "1",
    del_place: String(p.del_place || ""), col_place: String(p.col_place || ""),
    note: String(p.note || ""),
    visit_type: String(p.visit_type || _leg.vt), return_type: String(p.return_type || _leg.rt),
  } });
  if (!rpc) return J({ error: "予約処理に失敗しました" }, 500);
  if (rpc.error) return J({ error: rpc.error, soldOut: rpc.soldOut === true }, rpc.soldOut ? 409 : 400);

  const resId = rpc.reservationId;
  const amount = Math.round(Number(rpc.total || 0));
  const baseAmt = Math.round(Number(rpc.classTotal || 0));
  async function cancelPending() {
    try { await sbDelete(M.fleet, `reservation_id=eq.${encodeURIComponent(resId)}`);
      await sbPatch(M.resv, `id=eq.${encodeURIComponent(resId)}&status=eq.pending_payment`, { status: "cancelled" }); } catch (_) {}
  }
  if (amount <= 0 || baseAmt <= 0) { await cancelPending(); return J({ error: "金額計算エラー" }, 400); }

  // ── 🎟 クーポン（任意）：読み取り検証で割引後の課金額を確定。確定記録(redeem/used_count++)は決済成功後＝失敗時に消費しない ──
  const couponCode = String(p.coupon || "").trim();
  let chargeAmount = amount, couponDiscount = 0;
  if (couponCode) {
    const chk = await sbRpc("official_check_coupon", { p_code: couponCode, p_store: store, p_amount: amount, p_email: mail });
    if (!chk || chk.ok !== true) {
      await cancelPending();
      return J({ error: "クーポンを適用できませんでした（" + couponReasonJa((chk && chk.reason) || "invalid") + "）", couponError: true }, 400);
    }
    couponDiscount = Math.max(0, Math.round(Number(chk.discount || 0)));
    chargeAmount = Math.max(0, Math.round(Number(chk.final || amount)));
  }
  async function finalizeCoupon() {
    if (!couponCode) return;
    const rd = await sbRpc("official_redeem_coupon", { p_code: couponCode, p_store: store, p_amount: amount, p_email: mail, p_resv: resId });
    if (!rd || rd.ok !== true) { try { await notifySlack("⚠️ 公式 クーポン確定記録に失敗 " + resId + " code=" + couponCode + " reason=" + ((rd && rd.reason) || "?"), slackCh); } catch (_) {} }
  }

  try {
    let payId = "FREE-COUPON";
    if (chargeAmount > 0) {
      const r = await fetch(`${SQUARE_API}/v2/payments`, { method: "POST",
        headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, "content-type": "application/json", "Square-Version": "2024-06-04" },
        body: JSON.stringify({ idempotency_key: `hdmpay-${resId}`, source_id: token, location_id: SQUARE_LOCATION,
          amount_money: { amount: chargeAmount, currency: "JPY" }, reference_id: resId, note: `HANDYMAN公式 ${resId}` }) });
      const j = await r.json();
      const st = j?.payment?.status;
      if (!r.ok || (st !== "COMPLETED" && st !== "APPROVED")) {
        console.error(`[pay] failed ${resId}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
        await cancelPending();
        const detail = (j.errors && j.errors[0] && (j.errors[0].detail || j.errors[0].code)) || "カードが承認されませんでした";
        return J({ error: "決済に失敗しました：" + detail }, 402);
      }
      payId = j.payment.id;
    }
    const _patch: Record<string, unknown> = { status: "confirmed" };
    if (isHdm2) _patch.site = "hdm2";
    if (couponCode) { _patch.price = chargeAmount; _patch.discount = couponDiscount; _patch.coupon_code = couponCode; }
    await sbPatch(M.resv, `id=eq.${encodeURIComponent(resId)}&status=eq.pending_payment`, _patch);
    await sbPost("keydrop_payments", { reservation_id: resId, square_payment_id: payId, amount: chargeAmount, status: "paid", paid_at: new Date().toISOString(), store });
    await finalizeCoupon();
    const rv = (await sbGet(M.resv, `id=eq.${encodeURIComponent(resId)}&select=${SEL[store]}`))[0] || { name, mail };
    const mypageUrl = M.mypage + encodeURIComponent(rv.mypage_token || "");
    const mailId = await sendConfirmMail(store, resId, isHdm2 ? "hdm2" : "");
    const slackMsg = [isHdm2 ? `🆕 *HANDYMAN ${M.shop} 新規予約*（🆕HDM2 新サイト hdm-rentacar.jp・カード決済確定）` : `🆕 *HANDYMAN ${M.shop} 新規予約*（🆕NEW リニューアル公式サイト rent-handyman.com・カード決済確定）`,
      `予約番号: ${resId} / ${rv.name || name}様`, `車両: ${rv.vehicle || cls}クラス`,
      `出発: ${rv.lend_date || lend} ${rv.lend_time || ""}　返却: ${rv.return_date || ret} ${rv.return_time || ""}`,
      `受け渡し: ${_leg.vt === "PUB" ? "店舗で受け渡し（空港から送迎バス）" : _leg.vt === "来店" ? "来店（営業所）" : "お届け：" + (rv.del_place || "（マイページで登録待ち）")}　補償: ${rv.insurance || "なし"}`,
      couponCode ? `クーポン: ${couponCode}（-¥${couponDiscount.toLocaleString()}）` : null,
      `金額: ¥${chargeAmount.toLocaleString()}　確定メール: ${mailId ? "送信済" : "未送信"}`,
      (String(p.note || "").trim() ? `📝 備考・ご要望: ${String(p.note).trim()}` : "")].filter(Boolean).join("\n");
    await notifySlack(slackMsg, slackCh);
    // ★OTA取込と同じ「予約取込」チャンネルにも🆕通知（slackChが別チャンネルに上書きされていても確実に出す・同一なら重複回避）
    if (M.resvCh && M.resvCh !== slackCh) { try { await notifySlack(slackMsg, M.resvCh); } catch (_) {} }
    console.log(`[pay] PAID ${store} ${resId} ¥${chargeAmount} payment=${payId}${couponCode ? ` coupon=${couponCode}` : ""}`);
    return J({ ok: true, reservationId: resId, amount: chargeAmount, discount: couponDiscount, mypage: mypageUrl });
  } catch (e) {
    console.error("[pay]", e); await cancelPending();
    return J({ error: "決済処理で問題が発生しました。時間をおいてお試しください" }, 500);
  }
});
