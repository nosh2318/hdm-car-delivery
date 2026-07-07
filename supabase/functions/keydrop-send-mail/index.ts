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
function withFooter(m: { subject: string; body: string }) {
  m.body += `\n──────────\n※このメールは送信専用です。ご返信いただいてもお答えできません。\n　お問い合わせは公式LINE（${LINE_ID}）／TEL ${TEL}（9:00〜19:00）へ。\n`;
  return m;
}
function buildMail(n: any) {
  switch (n.type) {
    case "confirm": return withFooter(buildConfirm(n));
    case "cancel_ack": return withFooter(buildCancelAck(n));
    case "cancel_done": return withFooter(buildCancelDone(n));
    case "change_done": return withFooter(buildChangeDone(n));
    case "reminder": return withFooter(buildReminder(n));
    case "track_delivering": return withFooter(buildTrack(n, false));
    case "track_collecting": return withFooter(buildTrack(n, true));
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
