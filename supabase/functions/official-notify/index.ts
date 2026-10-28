// ============================================================
// official-notify : HANDYMAN公式サイト(rent-handyman.com) 札幌/那覇 予約の 各種メール通知
// 2026-08-27 / omni  （KEYDROPと同じ通知セット・タイミングを ota=HANDYMAN(公式) の予約にメールで送る・HANDYMANブランド）
// 確定メールは official-pay が即時送信済 → ここは "その後" の通知：
//   場所リマインド(3日前10時/場所未設定)・前日(18時)・返却前日(17時)・傷チェック(出発当日8時)・返却日(9時〜)・御礼(返却翌日10時)
// 毎時cronで全トリガーを評価（JST時刻ゲート）。重複は {store}_line_sends(action=mail_*)で防止。
// 送信=Resend(FROM=HANDYMAN RENTCAR <reserve@rent-handyman.com>)。全メールにマイページURLを封入（傷チェックはマイページに出る）。
// verify_jwt OFF・x-cron-secret 認証。
// ============================================================
// ★BTプロジェクトにデプロイ（RESEND_API_KEYがrent-handyman.comを送れるのはBT側だけ）。
//   那覇/札幌の予約(reservations/nha_reservations)はMAINにあるので MAIN_SERVICE でクロスDB読み書き。
const SB_URL = "https://ckrxttbnawkclshczsia.supabase.co"; // MAIN（予約・送信ログ）
const SB_KEY = Deno.env.get("MAIN_SERVICE")!;              // MAINのservice_role
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";   // BT側＝rent-handyman.com認可済
const MAIL_FROM = Deno.env.get("INQUIRY_FROM") || "HANDYMAN RENTCAR <reserve@rent-handyman.com>";
const MAIL_REPLY = "reserve@rent-handyman.com";
// 2026-10-28 新サイト(hdm-rentacar.jp)予約＝site=hdm2 は新ドメインから送る（ota=HANDYMANのまま区別）
const MAIL_FROM_HDM2 = "HANDYMAN RENTCAR <reserve@hdm-rentacar.jp>";
const MAIL_REPLY_HDM2 = "reserve@hdm-rentacar.jp";
const replyOf = (site?: string) => site === "hdm2" ? MAIL_REPLY_HDM2 : MAIL_REPLY;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };

const STORES = [
  { store: "spk", resv: "reservations", sends: "spk_line_sends", shop: "札幌デリバリー専門店",
    dCol: "lend_date", rCol: "return_date", mypage: "https://nosh2318.github.io/spk-task/my.html?t=",
    lineForm: "https://line.me/R/ti/p/%40730kyhwl" },
  { store: "nha", resv: "nha_reservations", sends: "nha_line_sends", shop: "那覇空港店",
    dCol: "start_date", rCol: "end_date", mypage: "https://nosh2318.github.io/naha-project/my-nha.html?t=",
    lineForm: "https://line.me/R/ti/p/%40466dbckq" },
];

async function sbGet(t: string, q: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: H });
  if (!r.ok) { console.error(`GET ${t}`, await r.text()); return []; }
  return await r.json();
}
async function sbPost(t: string, b: unknown): Promise<boolean> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(b) });
  if (!r.ok) console.error(`POST ${t}`, await r.text());
  return r.ok;
}
async function sbPatch(t: string, q: string, b: unknown): Promise<void> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(b) });
  if (!r.ok) console.error(`PATCH ${t}`, await r.text());
}
const SQUARE_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const SQUARE_LOCATION = Deno.env.get("SQUARE_LOCATION_ID") || "L8N7J9RKPN3WH";
// じゃらん事前決済のSquare決済リンク生成。★reference_idは付けない＝payment-webhookはsquare_order_idで突合しDB paid化(KEYDROP経路と衝突させない)。
async function createSquareLink(name: string, amountYen: number, note: string): Promise<{ url: string; orderId: string } | null> {
  if (!SQUARE_TOKEN || !(amountYen > 0)) return null;
  try {
    const r = await fetch("https://connect.squareup.com/v2/online-checkout/payment-links", {
      method: "POST",
      headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, "Content-Type": "application/json", "Square-Version": "2024-01-18" },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: { name, price_money: { amount: Math.round(amountYen), currency: "JPY" }, location_id: SQUARE_LOCATION },
        payment_note: note,
      }),
    });
    const d = await r.json();
    if (!r.ok || !d.payment_link) { console.error("[square] link fail", r.status, JSON.stringify(d).slice(0, 300)); return null; }
    return { url: d.payment_link.url, orderId: d.payment_link.order_id };
  } catch (e) { console.error("[square]", e); return null; }
}
async function sendMail(to: string, subject: string, body: string, site = ""): Promise<boolean> {
  if (!RESEND_KEY || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: site === "hdm2" ? MAIL_FROM_HDM2 : MAIL_FROM, to: [to], reply_to: replyOf(site), subject, text: body }) });
    return r.ok;
  } catch (_) { return false; }
}
const validMail = (m: string) => !!(m && m.indexOf("@") > 0 && !/^ota.*@rent-handyman/i.test(m) && !/^noreply/i.test(m));
const foot0 = (shop: string, site = "") => `\n\n※本メールは自動送信です。ご返信いただくと担当に届きます（${replyOf(site)}）。\nHANDYMAN RENTCAR ${shop}\n営業時間 9:00〜19:00`;
// オプション表記（シート等は個数まで）・補償プラン名（顧客向け・必須セット）
const _optN = (v: any) => { if (v === true) return 1; const x = Number(v); return isNaN(x) ? 0 : x; };
function optLine(r: any): string {
  const p: string[] = [];
  if (_optN(r.opt_c) > 0) p.push(`チャイルドシート×${_optN(r.opt_c)}`);
  if (_optN(r.opt_j) > 0) p.push(`ジュニアシート×${_optN(r.opt_j)}`);
  if (_optN(r.opt_b) > 0) p.push(`ベビーシート×${_optN(r.opt_b)}`);
  if (_optN(r.opt_usb) > 0) p.push(`USB×${_optN(r.opt_usb)}`);
  return p.length ? p.join(" / ") : "なし";
}
function insName(v: any): string {
  const s = String(v || "");
  if (/フル|NOC|安心/.test(s)) return "安心ワイドパック（免責補償＋NOC補償）";
  if (/免責|CDW/.test(s)) return "免責補償";
  return "基本プラン";
}
// 初動メール(welcome)本文：予約を承った直後にマイページ＋受付フォーム(LINE友だち追加)へ誘導。OTA(じゃらん/skyticket/エアトリ/RDC/GoGoOut)向け。
function buildWelcome(r: any, url: string, S: any, payUrl?: string, payAmt?: number): { s: string; b: string } {
  const pay = (payUrl && payUrl.indexOf("http") === 0)
    ? `──────────\n【事前決済のお願い（じゃらん）】\n当店ではお待ち時間・待機時間の解消のため事前決済をお願いしております。\nお支払い金額：¥${Number(payAmt || 0).toLocaleString()}\n下記より ご出発3日前19:00まで にお支払いをお願いいたします。\n${payUrl}\n※現金決済をご希望の場合は、お手数ですが事前にお問い合わせください。\n──────────\n\n`
    : "";
  const b = `${r.name || "お客様"} 様\n\nこの度はHANDYMAN RENTCAR ${S.shop}をご予約いただきありがとうございます。\nご予約を承りましたのでお知らせいたします。\n\n` +
    `──────────\n【予約番号】${r.id}\n【車両クラス】${r.vehicle || ""}\n【ご出発】${r.lend_date || ""} ${r.lend_time || ""}\n【ご返却】${r.return_date || ""} ${r.return_time || ""}\n【オプション】${optLine(r)}\n【補償プラン】${insName(r.insurance)}\n──────────\n\n` +
    pay +
    `━━━━━━━━━━━━━━━━━━\n■【必ずご登録ください】公式LINE\n━━━━━━━━━━━━━━━━━━\n` +
    `ご出発前のご準備・当日のお受け渡しのご連絡は、原則すべて公式LINEで行います。\n下記から友だち追加のうえ、届く受付フォームで【お届け場所・お時間・免許証】をご登録ください。\n` +
    `⚠️ ご登録がない場合、当日のご連絡ができず、お受け渡し・ご出発に間に合わないことがございます。必ずお早めにご登録をお願いいたします。\n\n` +
    `▶ 公式LINE 友だち追加はこちら\n${S.lineForm}\n\n` +
    `──────────\n▼ LINEをお使いでない方・ご予約内容の確認は「マイページ」から\n（お届け場所/時間のご連絡・免許証のご登録・変更/キャンセルのご依頼）\n${url}\n──────────` +
    foot0(S.shop);
  return { s: `【HANDYMAN RENTCAR ${S.shop}】ご予約を承りました（マイページのご案内）`, b };
}
// 初動メール対象OTA（楽天=アドレス取得不可→スタッフが楽天管理画面から手動）。
//   HP=rent-handyman.jp直販(GAS取込・那覇/札幌)＝.com初動メールに移行するので対象に含める。
//   HANDYMAN=rent-handyman.com直販(HDMS/HDMN・official-pay確定メール.com済)＝除外(2重防止)。KEYDROPも各自confirm。高松は別ブランド網。
const WELCOME_OTA = new Set(["J", "S", "O", "RC", "G", "HP"]);

Deno.serve(async (req) => {
  const sec = req.headers.get("x-cron-secret") || "";
  let p: any = {}; try { p = await req.json(); } catch { /* */ }
  if (!CRON_SECRET || sec !== CRON_SECRET) {
    if (!p.test) return new Response("forbidden", { status: 403 });
    return new Response(JSON.stringify({ ok: true, test: true }), { headers: { "content-type": "application/json" } });
  }
  // ★確定メール中継：official-pay(MAIN・MAIN Resendはrent-handyman.com不可)から呼ばれ、BTキーで確定メールを送る
  if (p.confirm) {
    const st = p.store === "nha" ? STORES[1] : STORES[0];
    const rid = String(p.reservationId || "");
    const sel = st.store === "nha"
      ? "id,name,mail,vehicle:vehicle_class,lend_date:start_date,lend_time:start_time,return_date:end_date,return_time:end_time,del_place,col_place,insurance,opt_c,opt_j,opt_b,opt_usb,mypage_token,price,site"
      : "id,name,mail,vehicle,lend_date,lend_time,return_date,return_time,del_place,col_place,insurance,opt_c,opt_j,opt_b,opt_usb,mypage_token,price,site";
    const rv = (await sbGet(st.resv, `id=eq.${encodeURIComponent(rid)}&select=${sel}`))[0];
    if (!rv || !validMail(rv.mail)) return new Response(JSON.stringify({ ok: false, error: "no reservation/mail" }), { headers: { "content-type": "application/json" } });
    const csite = (p.site === "hdm2" || rv.site === "hdm2") ? "hdm2" : "";
    const url = st.mypage + encodeURIComponent(rv.mypage_token || "");
    const body = `${rv.name || "お客様"} 様\n\nこの度はHANDYMAN RENTCAR ${st.shop}をご利用いただきありがとうございます。\nご予約・お支払いが確定いたしましたのでお知らせします。\n\n` +
      `──────────\n【予約番号】${rv.id}\n【車両クラス】${rv.vehicle || ""}\n【ご出発】${rv.lend_date || ""} ${rv.lend_time || ""}\n【ご返却】${rv.return_date || ""} ${rv.return_time || ""}\n` +
      `【お届け場所】${rv.del_place || "（マイページでご登録ください）"}\n【回収場所】${rv.col_place ? rv.col_place : (rv.del_place ? "お届け場所と同じ" : "（マイページでご登録ください）")}\n【オプション】${optLine(rv)}\n【補償プラン】${insName(rv.insurance)}\n【お支払い金額】¥${Number(rv.price || 0).toLocaleString()}（決済済み）\n──────────\n\n` +
      `▼ マイページ（ご予約内容の確認・お届け場所/時間のご連絡・免許証のご登録・変更/キャンセルのご依頼など）\n${url}\n\n` +
      `▼ 📱 当日のご連絡・各種通知をLINEで受け取る（おすすめ）\n公式LINEを友だち追加のうえ受付フォームにご登録いただくと、お迎え・傷チェック・前日/返却リマインド等をLINEでお届けします（マイページからも登録できます）。\n${st.lineForm}${foot0(st.shop, csite)}`;
    const ok = await sendMail(rv.mail, `【HANDYMAN RENTCAR ${st.shop}】ご予約が確定しました`, body, csite);
    return new Response(JSON.stringify({ ok }), { headers: { "content-type": "application/json" } });
  }

  const DRY = p.dry === true;             // 検証：送信・記録せず候補だけ返す
  const FORCE_HH = (typeof p.hh === "number") ? p.hh : null; // 検証：時刻ゲートを任意時刻で
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const today = jst.toISOString().slice(0, 10);
  const hh = FORCE_HH != null ? FORCE_HH : jst.getUTCHours();
  const dstr = (offDays: number) => new Date(jst.getTime() + offDays * 86400000).toISOString().slice(0, 10);
  const foot = (shop: string, site = "") =>
    `\n\n※本メールは自動送信です。ご返信いただくと担当に届きます（${replyOf(site)}）。\nHANDYMAN RENTCAR ${shop}\n営業時間 9:00〜19:00`;

  // 各トリガー：条件が満たされる日付だけ対象を引く（毎時cron・時刻ゲート）
  // {action, dateField目標(相対), hourGate, subject/body生成}
  type Trig = { action: string; targetDate: string; hourGate: (h: number) => boolean; needPlaceEmpty?: boolean; onReturn?: boolean; otaIn?: string[]; build: (r: any, url: string, shop: string) => { s: string; b: string } };
  const trigs: Trig[] = [
    { action: "mail_place", targetDate: dstr(3), hourGate: (h) => h === 10, needPlaceEmpty: true, otaIn: ["HANDYMAN", "J", "S", "O", "RC", "G", "HP"],
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】お届け場所のご登録のお願い（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\nご出発が近づいてまいりました。スムーズなお受け渡しのため、お届け先（ご住所・ホテル名等）のご登録をお願いいたします。\n\n▼ マイページ（お届け場所・時間のご登録）\n${url}${foot(shop, r.site)}` }) },
    { action: "mail_daybefore", targetDate: dstr(1), hourGate: (h) => h === 18, otaIn: ["HANDYMAN", "J", "S", "O", "RC", "G", "HP"],
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】明日はご出発日です（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\n明日 ${r.__d} はご出発日です。お届け場所・お時間・免許証のご登録がお済みかご確認ください。\n\n▼ マイページ\n${url}${foot(shop, r.site)}` }) },
    { action: "mail_returnbefore", targetDate: dstr(1), hourGate: (h) => h === 17, onReturn: true, otaIn: ["HANDYMAN", "J", "S", "O", "RC", "G", "HP"],
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】明日はご返却日です（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\n明日 ${r.__r} はご返却日です。ご返却場所・お時間をご確認ください。\n\n▼ マイページ\n${url}${foot(shop, r.site)}` }) },
    { action: "mail_damage", targetDate: today, hourGate: (h) => h >= 8, otaIn: ["HANDYMAN", "J", "S", "O", "RC", "G", "HP"], // 出発当日8時以降
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】ご出発前 車両の状態チェックのお願い（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\n本日はご出発日です。トラブル防止のため、ご出発前に車両の状態チェック（傷の確認）をお願いいたします。マイページよりご確認いただけます。\n\n▼ マイページ（車両の状態チェック）\n${url}${foot(shop, r.site)}` }) },
    { action: "mail_returnday", targetDate: today, hourGate: (h) => h >= 9, onReturn: true, otaIn: ["HANDYMAN", "J", "S", "O", "RC", "G", "HP"],
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】本日はご返却日です（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\n本日 ${r.__r} はご返却日です。ご返却場所・お時間のご確認をお願いいたします。ご不明点はお問い合わせください。\n\n▼ マイページ\n${url}${foot(shop, r.site)}` }) },
    { action: "mail_thanks", targetDate: dstr(-1), hourGate: (h) => h === 10, onReturn: true, otaIn: ["HANDYMAN", "J", "S", "O", "RC", "G", "HP"],
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】ご利用ありがとうございました（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\nこの度はHANDYMAN RENTCAR ${shop}をご利用いただき誠にありがとうございました。またのご利用を心よりお待ちしております。${foot(shop, r.site)}` }) },
  ];

  let enq = 0, cand = 0;
  for (const S of STORES) {
    // ★2026-10-07: キャンセル申請中(mypage_changes field=cancel status=requested)はリマインド対象外。
    //   予約statusは担当承認まで confirmed のままなので、status除外だけでは申請中に飛ぶ穴があった。
    const pcRows = await sbGet("mypage_changes", `store=eq.${S.store}&field=eq.cancel&status=eq.requested&select=reservation_id`);
    const pendingCancel = new Set((pcRows || []).map((x: any) => String(x.reservation_id)));
    for (const t of trigs) {
      if (!t.hourGate(hh)) continue;
      const col = t.onReturn ? S.rCol : S.dCol;
      const otaClause = t.otaIn ? `ota=in.(${t.otaIn.join(",")})` : "ota=eq.HANDYMAN";
      const rows = await sbGet(S.resv, `${otaClause}&${col}=eq.${t.targetDate}&status=not.in.(%22キャンセル%22,cancelled,cancel)&select=id,name,mail,${S.dCol},${S.rCol},del_place,mypage_token,site`);
      for (const r of rows) {
        if (!validMail(r.mail)) continue;
        if (pendingCancel.has(String(r.id))) continue; // ★キャンセル申請中→リマインド送らない
        if (t.needPlaceEmpty && String(r.del_place || "").trim()) continue; // 場所登録済みは場所リマインド不要
        cand++;
        // 重複防止：{store}_line_sends に同action+予約が無いか
        const done = await sbGet(S.sends, `resv_no=eq.${encodeURIComponent(r.id)}&action=eq.${t.action}&select=resv_no&limit=1`);
        if (done[0]) continue;
        r.__d = r[S.dCol]; r.__r = r[S.rCol];
        const url = S.mypage + encodeURIComponent(r.mypage_token || "");
        const m = t.build(r, url, S.shop);
        if (DRY) { enq++; console.log(`[dry] ${S.store} ${t.action} ${r.id} → ${r.mail}`); continue; }
        const ok = await sendMail(r.mail, m.s, m.b, r.site);
        if (ok) { await sbPost(S.sends, { resv_no: r.id, action: t.action, status: "mailed", message: "official-notify" }); enq++; }
      }
    }
  }
  // ===== 初動メール(welcome) =====
  // 那覇/札幌のOTA予約(J/S/O/RC/G)で「当社の初動メール未送信」の穴を埋める。楽天=対象外(スタッフ手動)。
  // 安全: welcome:true 明示時のみ動作(cron本体は無指定=無動作)。新規のみ=既定95分窓、backfillは welcomeSinceDate 指定。
  let wcand = 0, wsent = 0;
  const previews: any[] = [];
  if (p.welcome === true) {
    const sinceIso = p.welcomeSinceDate
      ? new Date(String(p.welcomeSinceDate) + "T00:00:00Z").toISOString()
      : new Date(Date.now() - 7 * 86400 * 1000).toISOString(); // 7日ルックバック＝1回逃しても次cronで再送(dedupで1通保証)
    for (const S of STORES) {
      if (Array.isArray(p.welcomeStores) && !p.welcomeStores.includes(S.store)) continue; // 段階投入(札幌先行/那覇最後)
      const sel = S.store === "nha"
        ? "id,name,mail,vehicle:vehicle_class,lend_date:start_date,lend_time:start_time,return_date:end_date,return_time:end_time,mypage_token,ota,price,opt_c,opt_j,opt_b,opt_usb,insurance,created_at"
        : "id,name,mail,vehicle,lend_date,lend_time,return_date,return_time,mypage_token,ota,price,opt_c,opt_j,opt_b,opt_usb,insurance,created_at";
      const rows = await sbGet(S.resv, `created_at=gte.${sinceIso}&${S.dCol}=gte.${today}&status=not.in.(%22キャンセル%22,cancelled,cancel)&select=${sel}&limit=3000`);
      for (const r of rows) {
        if (p.welcomeOnlyId && r.id !== p.welcomeOnlyId) continue; // 単発テスト用
        if (!WELCOME_OTA.has(String(r.ota || ""))) continue;
        if (!validMail(r.mail)) continue;
        wcand++;
        if (!p.welcomePreview) {
          const done = await sbGet(S.sends, `resv_no=eq.${encodeURIComponent(r.id)}&action=eq.mail_welcome&select=resv_no&limit=1`);
          if (done[0]) continue;
        }
        // じゃらん(事前決済)は決済リンクを本文に追加。正本=DB1本(jalan_payments札幌 / nha_jalan_payments那覇)。那覇はリンク未発行なら.comで生成(=.jp GAS停止の代替)。
        let payUrl = "", payAmt = 0;
        if (String(r.ota) === "J" && (S.store === "spk" || S.store === "nha")) {
          const jt = S.store === "spk" ? "jalan_payments" : "nha_jalan_payments";
          const jp = await sbGet(jt, `reservation_id=eq.${encodeURIComponent(r.id)}&select=square_payment_url,amount&limit=1`);
          if (jp[0] && jp[0].square_payment_url) { payUrl = jp[0].square_payment_url; payAmt = Number(jp[0].amount || 0); }
          else if (Number(r.price || 0) > 0) {
            // 那覇/札幌とも：リンク未発行なら.comが生成(GAS障害に非依存・DB1本)。札幌は札幌GASが先に生成するので2h待って重複回避、那覇は即。
            const graceMs = S.store === "spk" ? 20 * 60 * 1000 : 0; // 札幌20分(GASのcheckSquareLinks5分周期で生成される猶予)・GAS障害時も20分後に.comが代替生成
            const ageMs = Date.now() - new Date(r.created_at).getTime();
            if (ageMs < graceMs) continue; // 猶予内はGAS生成を待つ(重複回避・handleJalanPayment_のexistingチェックで二重にならない)
            if (!DRY && !p.welcomePreview) {
              const amt = Number(r.price || 0);
              const shop = S.store === "spk" ? "札幌デリバリー専門店" : "那覇空港店";
              const note = (S.store === "spk" ? "札幌" : "那覇") + ` / ${r.name || ""} / ${r.id}`;
              const link = await createSquareLink(`【HANDYMAN ${shop}】じゃらん事前決済（予約番号 ${r.id}）`, amt, note);
              if (link) {
                await sbPost(jt, { reservation_id: r.id, customer_name: r.name || "", customer_email: r.mail || "", amount: amt, status: "link_created", square_payment_url: link.url, square_order_id: link.orderId, lend_date: r.lend_date, return_date: r.return_date, link_created_at: new Date().toISOString(), memo: "official-notify" });
                payUrl = link.url; payAmt = amt;
              } else continue; // 生成失敗→次cronで再試行(dedup記録しない)
            } else { payAmt = Number(r.price || 0); } // preview/dry：金額だけ・リンク生成しない
          }
        }
        const url = S.mypage + encodeURIComponent(r.mypage_token || "");
        const m = buildWelcome(r, url, S, payUrl, payAmt);
        if (p.welcomePreview) { previews.push({ store: S.store, ota: r.ota, id: r.id, subject: m.s, body: m.b }); continue; }
        if (DRY) { wsent++; console.log(`[dry-welcome] ${S.store} ${r.ota} ${r.id} → ${r.mail}`); continue; }
        const ok = await sendMail(r.mail, m.s, m.b);
        if (ok) {
          await sbPost(S.sends, { resv_no: r.id, action: "mail_welcome", status: "mailed", message: "welcome" }); wsent++;
          // じゃらん：決済リンクを客に送ったので link_created→email_sent(未送信→未払い)。決済タブの3状態を正確に。
          if (String(r.ota) === "J" && payUrl) { await sbPatch(S.store === "spk" ? "jalan_payments" : "nha_jalan_payments", `reservation_id=eq.${encodeURIComponent(r.id)}&status=eq.link_created`, { status: "email_sent", email_sent_at: new Date().toISOString() }); }
        }
      }
    }
    // じゃらん未払い催促(.com・全店共有)：未払い＆出発3日以内にSquareリンクを再送(1日1回)。
    // ★DB(status=link_created/email_sent)を読む＝webhookでpaid化済みは対象外＝「払ったのに催促」が構造的に起きない(paid除外)。dedupで同日重複なし。
    if (hh === 10) {
      const dayTag = today.replace(/-/g, "");
      const REMIND = [
        { store: "spk", jt: "jalan_payments", sends: "spk_line_sends", shop: "札幌デリバリー専門店" },
        { store: "nha", jt: "nha_jalan_payments", sends: "nha_line_sends", shop: "那覇空港店" },
      ];
      for (const R of REMIND) {
        if (Array.isArray(p.welcomeStores) && !p.welcomeStores.includes(R.store)) continue;
        const jrows = await sbGet(R.jt, `status=in.(link_created,email_sent)&square_payment_url=not.is.null&select=reservation_id,customer_name,customer_email,amount,square_payment_url,lend_date&limit=1000`);
        for (const pay of jrows) {
          const ld = String(pay.lend_date || "");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ld) || ld < today || ld > dstr(3)) continue;
          if (!validMail(pay.customer_email)) continue;
          const act = `mail_jalan_remind_${dayTag}`;
          const done = await sbGet(R.sends, `resv_no=eq.${encodeURIComponent(pay.reservation_id)}&action=eq.${act}&select=resv_no&limit=1`);
          if (done[0]) continue;
          const b = `${pay.customer_name || "お客様"} 様\n\n【リマインド】HANDYMAN RENTCAR ${R.shop}です。\nご予約 ${pay.reservation_id} の事前決済がまだお済みでないようです。\n当店ではお待ち時間・待機時間の解消のため事前決済をお願いしております。\n\nお支払い金額：¥${Number(pay.amount || 0).toLocaleString()}\n下記より ご出発3日前19:00まで にお支払いをお願いいたします。\n${pay.square_payment_url}\n※現金決済をご希望の場合は、お手数ですが事前にお問い合わせください。${foot(R.shop)}`;
          if (DRY) { wsent++; continue; }
          const ok = await sendMail(pay.customer_email, `【リマインド】【HANDYMAN RENTCAR ${R.shop}】事前決済のお願い（予約番号: ${pay.reservation_id}）`, b);
          if (ok) {
            await sbPost(R.sends, { resv_no: pay.reservation_id, action: act, status: "mailed", message: "jalan-remind" }); wsent++;
            // 催促でリンクを送ったので link_created→email_sent(未送信→未払い)
            await sbPatch(R.jt, `reservation_id=eq.${encodeURIComponent(pay.reservation_id)}&status=eq.link_created`, { status: "email_sent", email_sent_at: new Date().toISOString() });
          }
        }
      }
    }
  }
  console.log(`[official-notify] candidates=${cand} sent=${enq} welcome(cand=${wcand} sent=${wsent}) hh=${hh}JST`);
  return new Response(JSON.stringify({ ok: true, candidates: cand, sent: enq, welcomeCand: wcand, welcomeSent: wsent, previews, hourJST: hh }), { headers: { "content-type": "application/json" } });
});
