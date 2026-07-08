// ============================================================
// keydrop-send-mail : KEYDROP 通知メール送信ワーカー（Resend直送・GAS代替）
// 2026-06-11 / omni
//
// 役割: keydrop_notifications(sent=false) を回収し、Resend API で
//       reserve@keydrop.jp（KEYDROP専用ドメイン）から送信して sent=true にする。
//   - GASの GmailApp（個人Gmail100通/日・HANDYMANと共有）を廃し、
//     Resend（keydrop.jp認証済・独立枠）に移行 → 上限/ブランド/遅延を解決。
//   - pg_cron が1分ごとに net.http_post で起動（x-cron-secret 認証）。
//   - verify_jwt=false でデプロイ。CRON_SECRET 一致時のみ実行。
//
// 必要なSupabase Secrets: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY(自動), CRON_SECRET, KEYDROP_FROM(任意)
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const FROM = Deno.env.get("KEYDROP_FROM") || "CARデリバリー KEY-DROP <reserve@keydrop.jp>";

const MYPAGE_URL = "https://keydrop.jp/?mypage=1";
const LINE_URL = "https://lin.ee/ZxBknUv";
const LINE_ID = "@149ahjll";
const TEL = "050-1785-2711";

function yen(n: unknown) { return "¥" + Number(n || 0).toLocaleString("ja-JP"); }
function dt(d: unknown, t: unknown) { return (d || "") + (t ? " " + t : ""); }
function mypageLink(n: any) {
  // 🔑 新方式：トークンURL（ログイン不要）。予約完了時に発行される mypage_token を使う。
  const tok = n?._mypage_token || (n?.payload && n.payload.mypage_token) || "";
  if (tok) return "https://keydrop.jp/mypage.html?t=" + encodeURIComponent(tok);
  // フォールバック：旧ログインURL（予約番号+メール）
  const id = n?.reservation_id || "", mail = n?.to_email || "";
  if (id && mail) return MYPAGE_URL + "&id=" + encodeURIComponent(id) + "&mail=" + encodeURIComponent(mail);
  return MYPAGE_URL;
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
async function resendSend(to: string, subject: string, text: string): Promise<{ ok: boolean; err?: string }> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text }),
  });
  if (r.ok) return { ok: true };
  const t = await r.text();
  return { ok: false, err: t.slice(0, 400) };
}

// ── テンプレート（GAS keydrop_mail.gs と同一文面）──
function buildConfirm(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return { subject: "CARデリバリー KEY-DROP ご予約が確定しました", body:
    `${p.name || "お客様"} 様\n\nこの度はCARデリバリーKEY-DROPをご利用いただき誠にありがとうございます。\nお支払いを確認し、ご予約が確定いたしました。\n\n━━━━━━━━━━━━━━━━━━━━\n■ ご予約内容\n予約番号　：${id}\n車両クラス：${p.vehicleClass || ""}\nお届け　　：${dt(p.lend_date, p.lend_time)}\n　　場所　：${p.del_place || "（ご指定の場所）"}\nご返却　　：${dt(p.return_date, p.return_time)}\n　　場所　：${p.col_place || p.del_place || "（ご指定の場所）"}\nご利用人数：${p.people || 1}名\n補償　　　：${p.insurance || "なし"}${(+(p.opt_c||0)>0)?`\nチャイルドシート：${+p.opt_c}台`:``}${(+(p.opt_j||0)>0)?`\nジュニアシート：${+p.opt_j}台`:``}${(+(p.opt_b||0)>0)?`\nベビーシート：${+p.opt_b}台`:``}${(+(p.opt_usb||0)>0)?`\nUSBケーブル：あり`:``}\nお支払い額：${yen(p.price)}\n━━━━━━━━━━━━━━━━━━━━\n\n■ ご予約の確認・変更・キャンセル\n下記のマイページから直接ご確認いただけます（ログイン不要）。\n${mypageLink(n)}\n※お届け／回収の時間・場所の変更は、マイページから変更をリクエストできます（お届け＝出発48時間前まで／回収＝返却2時間前まで・運営の承認後に反映）。締切後・日程・車種・オプションの変更は公式LINEへ。\n※キャンセルのご依頼はマイページの「キャンセルをリクエスト」より承ります。\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n営業時間：9:00〜19:00\n\nCARデリバリー KEY-DROP\n` };
}
function buildCancelAck(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return { subject: `CARデリバリー KEY-DROP キャンセル依頼を受け付けました（予約番号 ${id}）`, body:
    `${p.name || "お客様"} 様\n\nキャンセルのご依頼を受け付けいたしました。\n※この時点ではまだキャンセルは確定しておりません。\n内容（返金可否・キャンセル料）を確認のうえ、担当者より折り返しご連絡いたします。\n\n━━━━━━━━━━━━━━━━━━━━\n■ ご依頼内容\n予約番号　：${id}\n車両クラス：${p.vehicleClass || ""}\nお届け　　：${dt(p.lend_date, p.lend_time)}\nご返却　　：${dt(p.return_date, p.return_time)}\nお支払い額：${yen(p.price)}\nご依頼理由：${p.reason || "（記入なし）"}\n━━━━━━━━━━━━━━━━━━━━\n\n■ キャンセル料（目安）\n・7日前まで：無料\n・6〜3日前：基本料金の20%\n・2〜1日前：基本料金の30%\n・当日以降：基本料金の50%\n※航空便欠航時は欠航証明書のご提示でキャンセル料無料。\n\n■ ご確認\nマイページで現在の状況をご確認いただけます。\n${mypageLink(n)}\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n営業時間：9:00〜19:00\n\nCARデリバリー KEY-DROP\n` };
}
function buildCancelDone(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return { subject: `CARデリバリー KEY-DROP キャンセルが確定しました（予約番号 ${id}）`, body:
    `${p.name || "お客様"} 様\n\nご予約のキャンセルが確定いたしました。\nご返金の手続きを行いましたのでお知らせいたします。\n\n━━━━━━━━━━━━━━━━━━━━\n■ キャンセル内容\n予約番号　：${id}\n車両クラス：${p.vehicleClass || ""}\nお届け予定：${p.lend_date || ""}\nお支払い額：${yen(p.paid)}\nキャンセル料：${yen(p.fee)}${p.rate != null ? "（" + p.rate + "%）" : ""}\nご返金額　：${yen(p.refund)}\n━━━━━━━━━━━━━━━━━━━━\n\n※ご返金はカード会社の処理により、反映までお時間をいただく場合がございます。\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n営業時間：9:00〜19:00\n\nまたのご利用を心よりお待ちしております。\nCARデリバリー KEY-DROP\n` };
}
function buildChangeDone(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "", d = p.del || null, c = p.col || null;
  return { subject: `CARデリバリー KEY-DROP ご予約内容の変更が確定しました（予約番号 ${id}）`, body:
    `${p.name || "お客様"} 様\n\nご依頼いただいた変更を確認し、反映いたしました。\n\n━━━━━━━━━━━━━━━━━━━━\n■ 変更後の内容\n予約番号　：${id}\n${d ? `お届け　　：${d.time || ""}${d.place ? "　" + d.place : ""}\n` : ""}${c ? `ご返却　　：${c.time || ""}${c.place ? "　" + c.place : ""}\n` : ""}━━━━━━━━━━━━━━━━━━━━\n\n■ ご確認\nマイページで最新の予約内容をご確認いただけます。\n${mypageLink(n)}\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n営業時間：9:00〜19:00\n\nCARデリバリー KEY-DROP\n` };
}
function buildReminder(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return { subject: `【明日お届け】CARデリバリー KEY-DROP ご予約のご確認（予約番号 ${id}）`, body:
    `${p.name || "お客様"} 様\n\nいつもありがとうございます。明日が貸出予定日です。\n最新のご予約内容をお送りしますので、念のためご確認ください。\n\n━━━━━━━━━━━━━━━━━━━━\n■ ご予約内容（最新）\n予約番号　：${id}\n車両クラス：${p.vehicleClass || ""}クラス\nお届け　　：${dt(p.lend_date, p.lend_time)}\n　　場所　：${p.del_place || "（ご指定の場所）"}\nご返却　　：${dt(p.return_date, p.return_time)}\n　　場所　：${p.col_place || p.del_place || "（ご指定の場所）"}\nご利用人数：${p.people || 1}名\n補償　　　：${p.insurance || "なし"}\n━━━━━━━━━━━━━━━━━━━━\n\n■ 内容に変更がある場合\nお届け／回収の時間・場所の変更は、マイページまたは公式LINEへお早めにご連絡ください。\n（お届けの変更は出発48時間前まで／回収は返却2時間前まで・運営の承認後に反映）\n${mypageLink(n)}\n\n■ 当日について\nご指定の場所・時間にお届けにあがります。安全に停車・受け渡しができる場所でお待ちください。\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n緊急連絡先：${TEL} ／ 営業時間 9:00〜19:00\n\nCARデリバリー KEY-DROP\n` };
}
function buildCancelRequest(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return { subject: `【KEY-DROP】キャンセル依頼 予約番号 ${id} / ${p.name || ""}様`, body:
    `顧客がマイページでキャンセルを依頼しました。\nSPK admin で確定処理（承認＝自動返金）をしてください。\n\n━━━━━━━━━━━━━━━━━━━━\n予約番号　：${id}\n氏名　　　：${p.name || ""}\n連絡先　　：${p.mail || ""} / ${p.tel || ""}\n車両クラス：${p.vehicleClass || ""}\n期間　　　：${dt(p.lend_date, p.lend_time)} 〜 ${dt(p.return_date, p.return_time)}\nお届け場所：${p.del_place || ""}\n回収場所　：${p.col_place || ""}\n金額　　　：${yen(p.price)}\nキャンセル理由：${p.reason || "（記入なし）"}\n━━━━━━━━━━━━━━━━━━━━\n` };
}
function buildTrack(n: any, collecting: boolean) {
  const p = n.payload || {}, id = n.reservation_id || "", url = p.track_url || mypageLink(n);
  const head = collecting ? "🧭 回収に向かっています" : "🚚 まもなくお届けです";
  const lead = collecting
    ? "スタッフがご返却場所へ向かっています。"
    : "スタッフがお届けに向かっています。";
  return { subject: `CARデリバリー KEY-DROP ${head}（予約番号 ${id}）`, body:
    `${p.name || "お客様"} 様\n\n${lead}\n下のリンクから、地図でスタッフの現在地と待ち合わせ場所をリアルタイムにご確認いただけます（アプリのインストールは不要です）。\n\n▶ 地図を開く\n${url}\n\n・地図で「📍今いる場所を共有」を押していただくと、より正確に合流できます（任意）。\n・マイページからもご確認いただけます：\n${mypageLink(n)}\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）／TEL ${TEL}（9:00〜19:00）\n\nCARデリバリー KEY-DROP\n` };
}
function withFooter(m: any) {
  // 一部テンプレは {text} を返すため body に正規化（旧バグ: body未定義で"undefined"送信を防止）
  const base = (m.body != null ? m.body : (m.text != null ? m.text : ""));
  m.body = base + `\n──────────\n※このメールは送信専用です。ご返信いただいてもお答えできません。\n　お問い合わせは公式LINE（${LINE_ID}）／TEL ${TEL}（9:00〜19:00）へ。\n`;
  return m;
}
// ④ 傷チェック（毎朝8時・当日お届け）＝傷チェックURLのみ（HANDYMAN同方針）
function buildDamageCheck(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return { subject: `【KEY-DROP】ご利用車両 傷チェックのご案内（予約番号: ${id}）`, body:
    `${p.name || "お客様"} 様\n\n本日ご利用予定の車両について、傷チェックのご案内です。\nご出発前に、下記URLから車両の状態（傷・ヘコミ）をご確認ください（アプリのインストールは不要です）。\n\n▶ 車両 傷チェック\n${p.damage_url || ""}\n\n気になる点がございましたら、車両お引き渡し時に担当スタッフまでお申し付けください。\n※ご出発後の申告は対応いたしかねる場合がございます。\n\nCARデリバリー KEY-DROP\n` };
}
// ⑤ 御礼（返却翌日）＝URLなし（HANDYMAN同方針）
function buildThanks(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return { subject: `【KEY-DROP】先日はご利用ありがとうございました（予約番号: ${id}）`, body:
    `${p.name || "お客様"} 様\n\n先日はCARデリバリー KEY-DROP をご利用いただき、誠にありがとうございました。\nその後、お変わりなくお過ごしでしょうか。\n\n数あるサービスの中から当店をお選びいただけましたこと、スタッフ一同、心より感謝申し上げます。\nお車での道中やご旅行が、素敵なお時間となっておりましたら幸いです。\n\nまたのご利用を、心よりお待ち申し上げております。\n\nCARデリバリー KEY-DROP\n` };
}
// ⑨ 到着のお知らせ（到着ボタン）＝URLなし（HANDYMAN同方針）お届け/回収で文面別
function buildArrival(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "", collecting = !!p.collecting;
  const plate = String(p.plate || "").trim();
  if (collecting) {
    return { subject: `【KEY-DROP】ご返却場所到着のお知らせ（予約番号: ${id}）`, body:
      `${p.name || "お客様"} 様\n\n回収スタッフがご返却場所に到着いたしました。\nご準備できましたら対応のほどお願い申し上げます。\n何卒よろしくお願いいたします。\n\nCARデリバリー KEY-DROP\n` };
  }
  return { subject: `【KEY-DROP】車両到着のお知らせ（予約番号: ${id}）`, body:
    `${p.name || "お客様"} 様\n\nお待たせいたしました。只今スタッフが到着いたしました。\nご準備整い次第、受け取り対応をお願いいたします。引き続きどうぞ宜しくお願い申し上げます。`
    + (plate ? `\n\n対象車両のナンバーは ${plate} でございます。` : "")
    + `\n\nCARデリバリー KEY-DROP\n` };
}
function buildPlaceReminder(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return {
    subject: `【KEY-DROP】お届け場所のご確認（3日前）｜予約番号: ${id}`,
    text: `${p.name || "お客様"} 様\n\nいつもありがとうございます。3日後にお届け予定です。\nスムーズなお引き渡しのため、お届け／回収の「場所・時間」に間違いがないかご確認ください。\n\n━━━━━━━━━━━━━━━━━━━━\n予約番号　：${id}\nお届け　　：${dt(p.lend_date, p.lend_time)}\n　　場所　：${p.del_place || "（未確定）"}\nご返却　　：${dt(p.return_date, p.return_time)}\n　　場所　：${p.col_place || p.del_place || "（未確定）"}\n━━━━━━━━━━━━━━━━━━━━\n\n■ 場所・時間の変更・入力\nマイページから直接ご変更・ご入力いただけます（ログイン不要）。\n${mypageLink(n)}\n※お届けの時間・場所の変更は出発48時間前まで／回収は返却2時間前まで（運営の承認後に反映）。\n※場所が「未確定」の方は、お手数ですがマイページからご入力をお願いいたします。\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n営業時間：9:00〜19:00\n\nCARデリバリー KEY-DROP\n` };
}
function buildReturnReminder(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return {
    subject: `【KEY-DROP】ご返却のご案内（前日）｜予約番号: ${id}`,
    text: `${p.name || "お客様"} 様\n\nいつもありがとうございます。明日がご返却予定日です。\n回収の時間・場所をご確認ください。\n\n━━━━━━━━━━━━━━━━━━━━\n予約番号　：${id}\nご返却　　：${dt(p.return_date, p.return_time)}\n　回収場所：${p.col_place || p.del_place || "（ご指定の場所）"}\n━━━━━━━━━━━━━━━━━━━━\n\n■ 当日について\nご指定の時間・場所にスタッフが回収にあがります。安全に停車・受け渡しができる場所でお待ちください。\n・早めのご返却が可能な場合は、マイページの「返却準備ができた」からお知らせください。\n・回収時間・場所の変更は返却2時間前までマイページから承ります（運営の承認後に反映）。\n${mypageLink(n)}\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n緊急連絡先：${TEL} ／ 営業時間 9:00〜19:00\n\nCARデリバリー KEY-DROP\n` };
}
function buildDecision(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  const approved = p.decision === "approved";
  const label = p.label || "ご依頼", detail = p.detail ? `（${p.detail}）` : "";
  return {
    subject: approved ? `【KEY-DROP】ご依頼を承認しました｜予約番号: ${id}` : `【KEY-DROP】ご依頼について｜予約番号: ${id}`,
    text: approved
      ? `${p.name || "お客様"} 様\n\nマイページからいただいた${label}${detail}を確認し、承認・反映いたしました。\n\n━━━━━━━━━━━━━━━━━━━━\n予約番号　：${id}\n内容　　　：${label}${detail}\n状態　　　：✅ 承認・反映済み\n━━━━━━━━━━━━━━━━━━━━\n\n■ ご確認\nマイページで最新の予約内容をご確認いただけます（ログイン不要）。\n${mypageLink(n)}\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n営業時間：9:00〜19:00\n\nCARデリバリー KEY-DROP\n`
      : `${p.name || "お客様"} 様\n\nマイページからいただいた${label}${detail}を確認いたしました。\n誠に恐れ入りますが、今回は下記のとおり承れませんでした。\n\n━━━━━━━━━━━━━━━━━━━━\n予約番号　：${id}\n内容　　　：${label}${detail}\n状態　　　：今回は見送りとさせていただきました\n━━━━━━━━━━━━━━━━━━━━\n\n詳細・別のご希望については、お手数ですが公式LINEよりご連絡ください。\n\n■ ご確認\n${mypageLink(n)}\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n営業時間：9:00〜19:00\n\nCARデリバリー KEY-DROP\n` };
}
// オプション/補償/受渡 変更依頼の受付（未確定・承認制）
function buildRequestAck(n: any) {
  const p = n.payload || {}, id = n.reservation_id || "";
  return { subject: `【KEY-DROP】変更のご依頼を受け付けました（予約番号 ${id}）`, body:
    `${p.name || "お客様"} 様\n\n下記の変更のご依頼を受け付けました。\n※この時点では *まだ確定しておりません（未確定）* 。\n担当が内容を確認のうえ、確定・ご連絡いたします。\n\n━━━━━━━━━━━━━━━━━━━━\n予約番号　：${id}\nご依頼内容：${p.label || "変更のご依頼"}${p.detail ? `（${p.detail}）` : ""}\n状態　　　：🕓 確認中（未確定）\n━━━━━━━━━━━━━━━━━━━━\n\n■ ご確認\n現在の状況はマイページでご確認いただけます（🕓確認中と表示されます）。\n${mypageLink(n)}\n\n■ お問い合わせ\n公式LINE：${LINE_URL}（ID: ${LINE_ID}）\n営業時間：9:00〜19:00\n\nCARデリバリー KEY-DROP\n` };
}
function buildMail(n: any) {
  switch (n.type) {
    case "request_ack": return withFooter(buildRequestAck(n));
    case "confirm": return withFooter(buildConfirm(n));
    case "cancel_ack": return withFooter(buildCancelAck(n));
    case "cancel_done": return withFooter(buildCancelDone(n));
    case "change_done": return withFooter(buildChangeDone(n));
    case "reminder": return withFooter(buildReminder(n));
    case "track_delivering": return withFooter(buildTrack(n, false));
    case "track_collecting": return withFooter(buildTrack(n, true));
    case "mypage_decision": return withFooter(buildDecision(n));
    case "reminder_place": return withFooter(buildPlaceReminder(n));
    case "reminder_return": return withFooter(buildReturnReminder(n));
    case "damage_check": return withFooter(buildDamageCheck(n));
    case "thanks": return withFooter(buildThanks(n));
    case "arrival": return withFooter(buildArrival(n));
    default: return buildCancelRequest(n); // 運営向け（cancel_request）はフッター無し
  }
}

Deno.serve(async (req) => {
  // pg_cron からの呼び出しのみ許可（CRON_SECRET）
  const sec = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || sec !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  if (!RESEND_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY未設定" }), { status: 503 });

  const rows = await sbGet("keydrop_notifications?sent=eq.false&order=created_at.asc&limit=50&select=*");
  let ok = 0, ng = 0;
  for (const n of rows) {
    try {
      if (!n.to_email || String(n.to_email).indexOf("@") < 0) throw new Error("宛先不正: " + n.to_email);
      // 🔑 マイページtoken取得（ログイン不要URL用）。payloadに無ければ予約から引く。
      if (n.reservation_id && !(n.payload && n.payload.mypage_token)) {
        const tbl = String(n.reservation_id).toUpperCase().startsWith("KDN-") ? "nha_reservations" : "reservations";
        const rr = await sbGet(`${tbl}?id=eq.${encodeURIComponent(n.reservation_id)}&select=mypage_token`);
        if (rr[0]?.mypage_token) n._mypage_token = rr[0].mypage_token;
      }
      const m = buildMail(n);
      const r = await resendSend(n.to_email, m.subject, m.body);
      if (!r.ok) throw new Error("resend: " + r.err);
      await sbPatch(`keydrop_notifications?id=eq.${n.id}`, { sent: true, sent_at: new Date().toISOString(), error: null });
      ok++;
    } catch (e) {
      await sbPatch(`keydrop_notifications?id=eq.${n.id}`, { error: String(e).slice(0, 480) });
      ng++;
      console.error("[send-mail]", n.id, String(e));
    }
    await new Promise((res) => setTimeout(res, 600)); // ★ Resendの「2通/秒」レート制限(429)を回避＝送信間に600ms間隔。失敗分は次回cronで自動再送。
  }
  console.log(`[send-mail] sent=${ok} failed=${ng}`);
  return new Response(JSON.stringify({ ok: true, sent: ok, failed: ng }), { headers: { "content-type": "application/json" } });
});
