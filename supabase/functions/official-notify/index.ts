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
const MAIL_REPLY = Deno.env.get("INQUIRY_REPLYTO") || "reserve@rent-handyman.jp";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };

const STORES = [
  { store: "spk", resv: "reservations", sends: "spk_line_sends", shop: "札幌デリバリー専門店",
    dCol: "lend_date", rCol: "return_date", mypage: "https://nosh2318.github.io/spk-task/my.html?t=" },
  { store: "nha", resv: "nha_reservations", sends: "nha_line_sends", shop: "那覇空港店",
    dCol: "start_date", rCol: "end_date", mypage: "https://nosh2318.github.io/naha-project/my-nha.html?t=" },
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
async function sendMail(to: string, subject: string, body: string): Promise<boolean> {
  if (!RESEND_KEY || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], reply_to: MAIL_REPLY, subject, text: body }) });
    return r.ok;
  } catch (_) { return false; }
}
const validMail = (m: string) => !!(m && m.indexOf("@") > 0 && !/^ota.*@rent-handyman/i.test(m) && !/^noreply/i.test(m));
const foot0 = (shop: string) => `\n\n※本メールは自動送信です。ご返信いただくと担当に届きます（${MAIL_REPLY}）。\nHANDYMAN RENTCAR ${shop}\n営業時間 9:00〜19:00`;

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
      ? "id,name,mail,vehicle:vehicle_class,lend_date:start_date,lend_time:start_time,return_date:end_date,return_time:end_time,del_place,col_place,insurance,mypage_token,price"
      : "id,name,mail,vehicle,lend_date,lend_time,return_date,return_time,del_place,col_place,insurance,mypage_token,price";
    const rv = (await sbGet(st.resv, `id=eq.${encodeURIComponent(rid)}&select=${sel}`))[0];
    if (!rv || !validMail(rv.mail)) return new Response(JSON.stringify({ ok: false, error: "no reservation/mail" }), { headers: { "content-type": "application/json" } });
    const url = st.mypage + encodeURIComponent(rv.mypage_token || "");
    const body = `${rv.name || "お客様"} 様\n\nこの度はHANDYMAN RENTCAR ${st.shop}をご利用いただきありがとうございます。\nご予約・お支払いが確定いたしましたのでお知らせします。\n\n` +
      `──────────\n【予約番号】${rv.id}\n【車両クラス】${rv.vehicle || ""}\n【ご出発】${rv.lend_date || ""} ${rv.lend_time || ""}\n【ご返却】${rv.return_date || ""} ${rv.return_time || ""}\n` +
      `【お届け場所】${rv.del_place || "（マイページでご登録ください）"}\n【回収場所】${rv.col_place ? rv.col_place : (rv.del_place ? "お届け場所と同じ" : "（マイページでご登録ください）")}\n【補償】${rv.insurance || "なし"}\n【お支払い金額】¥${Number(rv.price || 0).toLocaleString()}（決済済み）\n──────────\n\n` +
      `▼ マイページ（ご予約内容の確認・お届け場所/時間のご連絡・免許証のご登録・変更/キャンセルのご依頼など）\n${url}${foot0(st.shop)}`;
    const ok = await sendMail(rv.mail, `【HANDYMAN RENTCAR ${st.shop}】ご予約が確定しました`, body);
    return new Response(JSON.stringify({ ok }), { headers: { "content-type": "application/json" } });
  }

  const DRY = p.dry === true;             // 検証：送信・記録せず候補だけ返す
  const FORCE_HH = (typeof p.hh === "number") ? p.hh : null; // 検証：時刻ゲートを任意時刻で
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const today = jst.toISOString().slice(0, 10);
  const hh = FORCE_HH != null ? FORCE_HH : jst.getUTCHours();
  const dstr = (offDays: number) => new Date(jst.getTime() + offDays * 86400000).toISOString().slice(0, 10);
  const foot = (shop: string) =>
    `\n\n※本メールは自動送信です。ご返信いただくと担当に届きます（${MAIL_REPLY}）。\nHANDYMAN RENTCAR ${shop}\n営業時間 9:00〜19:00`;

  // 各トリガー：条件が満たされる日付だけ対象を引く（毎時cron・時刻ゲート）
  // {action, dateField目標(相対), hourGate, subject/body生成}
  type Trig = { action: string; targetDate: string; hourGate: (h: number) => boolean; needPlaceEmpty?: boolean; onReturn?: boolean; build: (r: any, url: string, shop: string) => { s: string; b: string } };
  const trigs: Trig[] = [
    { action: "mail_place", targetDate: dstr(3), hourGate: (h) => h === 10, needPlaceEmpty: true,
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】お届け場所のご登録のお願い（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\nご出発が近づいてまいりました。スムーズなお受け渡しのため、お届け先（ご住所・ホテル名等）のご登録をお願いいたします。\n\n▼ マイページ（お届け場所・時間のご登録）\n${url}${foot(shop)}` }) },
    { action: "mail_daybefore", targetDate: dstr(1), hourGate: (h) => h === 18,
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】明日はご出発日です（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\n明日 ${r.__d} はご出発日です。お届け場所・お時間・免許証のご登録がお済みかご確認ください。\n\n▼ マイページ\n${url}${foot(shop)}` }) },
    { action: "mail_returnbefore", targetDate: dstr(1), hourGate: (h) => h === 17, onReturn: true,
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】明日はご返却日です（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\n明日 ${r.__r} はご返却日です。ご返却場所・お時間をご確認ください。\n\n▼ マイページ\n${url}${foot(shop)}` }) },
    { action: "mail_damage", targetDate: today, hourGate: (h) => h >= 8, // 出発当日8時以降
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】ご出発前 車両の状態チェックのお願い（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\n本日はご出発日です。トラブル防止のため、ご出発前に車両の状態チェック（傷の確認）をお願いいたします。マイページよりご確認いただけます。\n\n▼ マイページ（車両の状態チェック）\n${url}${foot(shop)}` }) },
    { action: "mail_returnday", targetDate: today, hourGate: (h) => h >= 9, onReturn: true,
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】本日はご返却日です（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\n本日 ${r.__r} はご返却日です。ご返却場所・お時間のご確認をお願いいたします。ご不明点はお問い合わせください。\n\n▼ マイページ\n${url}${foot(shop)}` }) },
    { action: "mail_thanks", targetDate: dstr(-1), hourGate: (h) => h === 10, onReturn: true,
      build: (r, url, shop) => ({ s: `【HANDYMAN ${shop}】ご利用ありがとうございました（予約番号 ${r.id}）`,
        b: `${r.name || "お客様"} 様\n\nこの度はHANDYMAN RENTCAR ${shop}をご利用いただき誠にありがとうございました。またのご利用を心よりお待ちしております。${foot(shop)}` }) },
  ];

  let enq = 0, cand = 0;
  for (const S of STORES) {
    for (const t of trigs) {
      if (!t.hourGate(hh)) continue;
      const col = t.onReturn ? S.rCol : S.dCol;
      const rows = await sbGet(S.resv, `ota=eq.HANDYMAN&${col}=eq.${t.targetDate}&status=not.in.(%22キャンセル%22,cancelled,cancel)&select=id,name,mail,${S.dCol},${S.rCol},del_place,mypage_token`);
      for (const r of rows) {
        if (!validMail(r.mail)) continue;
        if (t.needPlaceEmpty && String(r.del_place || "").trim()) continue; // 場所登録済みは場所リマインド不要
        cand++;
        // 重複防止：{store}_line_sends に同action+予約が無いか
        const done = await sbGet(S.sends, `resv_no=eq.${encodeURIComponent(r.id)}&action=eq.${t.action}&select=resv_no&limit=1`);
        if (done[0]) continue;
        r.__d = r[S.dCol]; r.__r = r[S.rCol];
        const url = S.mypage + encodeURIComponent(r.mypage_token || "");
        const m = t.build(r, url, S.shop);
        if (DRY) { enq++; console.log(`[dry] ${S.store} ${t.action} ${r.id} → ${r.mail}`); continue; }
        const ok = await sendMail(r.mail, m.s, m.b);
        if (ok) { await sbPost(S.sends, { resv_no: r.id, action: t.action, status: "mailed", message: "official-notify" }); enq++; }
      }
    }
  }
  console.log(`[official-notify] candidates=${cand} sent=${enq} hh=${hh}JST`);
  return new Response(JSON.stringify({ ok: true, candidates: cand, sent: enq, hourJST: hh }), { headers: { "content-type": "application/json" } });
});
