// 2026-10-23 新API鍵移行：新形式の鍵を優先し、無ければ旧鍵（移行期間の保険・旧鍵の無効化前に外す）
function __newKey(env: string, name: string): string { try { return (JSON.parse(Deno.env.get(env) || "{}") as Record<string, string>)[name] || ""; } catch { return ""; } }
console.log("[keymig]", __newKey("SUPABASE_SECRET_KEYS", "edge") ? "secret" : "legacy");
// ============================================================
// handyman-mypage : HANDYMAN 統合マイページ（全予約ユニークURL・token認証）
// 2026-07-03 / omni  ※札幌(spk)先行。那覇(nha)は後追いで STORES に追加。
// 設計思想:
//  ・token(=mypage_token) 所持＝本人（URLはLINE個別送信のみ・非公開）。KEYDROP追跡URLと同じ信頼モデル。
//  ・変更は必ず mypage_changes に追記（上書き・消失しても検出&復元できる保険）。
//  ・確定項目は reservations.mypage_locked に印を付ける → GAS再取込/タスク自動生成は上書きしない(protect相乗り)。
//  ・変更・キャンセルは全て「申請→スタッフ承認」（2026-11-07 nosh：期限は目安・期限後も申請可・公式LINEへは誘導しない）。
//  ・service_role は関数内のみ。deploy: --no-verify-jwt
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = (__newKey("SUPABASE_SECRET_KEYS", "edge") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };
// ★security 2026-10-23 スタッフ許可リスト：「ログインしていれば誰でも」→ 正規スタッフのメールドメインだけ通す。
//   main(ckrxttbnawkclshczsia) の auth.users ドメイン＝spk.hdm/nha.hdm/g-lines.jp/partner.hdm（2026-10-23確認）。協力会社 partner.hdm は不可。新規登録は無効(disable_signup=true)のためドメインで判定できる。EF は個別デプロイなので各 EF に同じ小関数をコピー。
const STAFF_EMAIL_RE = /@(spk\.hdm|nha\.hdm|g-lines\.jp)$/i;
async function staffUser(token: string): Promise<{ id: string; email: string } | null> {
  const t = String(token || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${t}` } });
    if (!r.ok) return null;
    const u: any = await r.json().catch(() => null);
    const email = String(u?.email || "").trim();
    if (!u?.id || !STAFF_EMAIL_RE.test(email)) return null;
    return { id: String(u.id), email };
  } catch (_) { return null; }
}

// 認証はbody内のmypage_token(推測不能UUID)のみ・Cookie/資格情報を一切使わない → CORSは全origin許可でよい。
// 旧実装は非allowlist origin(例:Apple Notesアプリ内WebView=Origin:null / 各種アプリ内ブラウザ)に対し固定でnosh2318.github.ioを返し、
// ブラウザ側でACAOミスマッチ→lookupがブロックされ「予約が見つかりません」になっていた(EF直叩きは成功するのに、が症状)。→ originをそのままエコー(無ければ*)。
const ALLOWED = ["https://nosh2318.github.io", "https://keydrop.jp"];
function cors(o: string | null) {
  const allow = o || "*";
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Vary": "Origin" };
}
function json(b: unknown, s: number, o: string | null) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "content-type": "application/json" } }); }

// x-hdm-actor: 監査ログ(_audit_actor)が「誰が書いたか」を区別するためのヘッダ。customer:<予約番号> / staff:<email> を載せる。
function withActor(actor?: string): Record<string, string> { return actor ? { ...H, "x-hdm-actor": actor } : H; }
async function sbGet(t: string, q: string): Promise<any[]> { const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: H }); if (!r.ok) { console.error(`GET ${t}`, await r.text()); return []; } return await r.json(); }
async function sbPatch(t: string, q: string, b: unknown, actor?: string): Promise<boolean> { const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "PATCH", headers: { ...withActor(actor), Prefer: "return=representation" }, body: JSON.stringify(b) }); if (!r.ok) { console.error(`PATCH ${t}`, await r.text()); return false; } const d = await r.json(); return Array.isArray(d) && d.length > 0; }
async function sbPost(t: string, b: unknown, actor?: string): Promise<void> { const r = await fetch(`${SB_URL}/rest/v1/${t}`, { method: "POST", headers: { ...withActor(actor), Prefer: "return=minimal" }, body: JSON.stringify(b) }); if (!r.ok) console.error(`POST ${t}`, await r.text()); }

// 顧客へLINE通知（line-push 経由。誤送信ガード・userId解決・test_mode は line-push 側で担保）
async function pushLine(resvNo: string, message: string): Promise<void> {
  const secret = Deno.env.get("LINEPUSH_SECRET");
  if (!secret) { console.log("[line skip] no LINEPUSH_SECRET", resvNo); return; }
  try {
    const r = await fetch(`${SB_URL}/functions/v1/line-push`, {
      method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify({ secret, store: "spk", resv_no: resvNo, action: "mypage_decision", message }),
    });
    const d = await r.json().catch(() => ({})); if (!d.ok) console.log("[line-push]", JSON.stringify(d));
  } catch (e) { console.error("[line-push]", String(e)); }
}

async function slackPost(text: string, blocks?: unknown[]): Promise<void> {
  // マイページ関連の全通知（変更/依頼/キャンセル/承認却下/整合アラート）は #sapporo_user_action へ
  const token = Deno.env.get("SLACK_BOT_TOKEN"); const ch = Deno.env.get("SLACK_MYPAGE_CHANNEL") || "C0BER0YC6AK";
  if (!token) { console.log("[slack skip]", text); return; }
  const body: any = { channel: ch, text }; if (blocks) body.blocks = blocks;
  try { const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!d.ok) console.error("[slack]", JSON.stringify(d)); } catch (e) { console.error("[slack]", String(e)); }
}
// ★新規予約(official-pay)の逆パターン：キャンセルも予約取込ch #sapporo_reservation に出す（那覇と統一）
async function slackResv(text: string, blocks?: unknown[]): Promise<void> {
  if (Deno.env.get("MYPAGE_SILENT") === "1") { console.log("[slackResv muted]", text); return; }
  const token = Deno.env.get("SLACK_BOT_TOKEN"); const ch = Deno.env.get("SLACK_SPK_RESV_CHANNEL") || "C08TDTPEB36";
  if (!token) { console.log("[slackResv skip]", text); return; }
  try { const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(blocks ? { channel: ch, text, blocks } : { channel: ch, text }) }); const d = await r.json().catch(() => ({})); if (!d.ok) console.error("[slackResv]", JSON.stringify(d)); } catch (e) { console.error("[slackResv]", String(e)); }
}
// 新サイト(rent-handyman.com)判定＝ota'HANDYMAN' or id HDMS始まり
const isNewSite = (o?: string, id?: string) => String(o || "") === "HANDYMAN" || /^HDMS/.test(String(id || ""));
// 予約もと（OTA）ラベル
const OTA_JP: Record<string, string> = { J: "じゃらん", R: "楽天", S: "skyticket", O: "エアトリ", RC: "レンタカーcom", G: "GoGoOut", HP: "オフィシャル(HP)", SP: "オフィシャル(HP)", direct: "直販", KEYDROP: "KEYDROP" };
function otaJp(o?: string): string { const k = String(o || ""); return OTA_JP[k] || k || "—"; }
// 承認管理ページ（マイページ管理コンソール）URL＝承認待ちカードのボタンから飛べるように
const MGMT_URL = "https://nosh2318.github.io/spk-task/mypage-admin.html?bucket=but_tkm";
// 2026-11-07 キャンセル申請などは該当予約をアクションタブで直接開く（札幌=hdm_spk）
const actUrl = (rid: string) => `https://nosh2318.github.io/spk-task/mypage-active.html?tab=action&bucket=hdm_spk&rid=${encodeURIComponent(rid)}`;
// マイページ通知カード（統一フォーマット）＝ 見出し＋基本情報(お客様/予約番号/予約もと/利用/車両)＋内容＋対応の要否
type MpCard = { emoji: string; title: string; name: string; resId: string; ota?: string; period?: string; vehicle?: string; lines?: string[]; action: string };
function mpCard(c: MpCard): { text: string; blocks: unknown[] } {
  const fields: any[] = [
    { type: "mrkdwn", text: `*お客様*\n${c.name || "-"} 様` },
    { type: "mrkdwn", text: `*予約番号*\n\`${c.resId}\`` },
  ];
  fields.push({ type: "mrkdwn", text: `*予約もと*\n${otaJp(c.ota)}` });
  if (c.period) fields.push({ type: "mrkdwn", text: `*利用期間*\n${c.period}` });
  if (c.vehicle) fields.push({ type: "mrkdwn", text: `*車両*\n${c.vehicle}` });
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `${c.emoji} ${c.title}`, emoji: true } },
    { type: "section", fields },
  ];
  if (c.lines && c.lines.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: c.lines.join("\n") } });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: c.action }] });
  // 承認/対応が要るカードには管理コンソール（承認管理ページ）へのボタンを付ける
  if (/管理コンソール/.test(c.action)) {
    blocks.push({ type: "actions", elements: [
      { type: "button", text: { type: "plain_text", text: "🔔 承認管理ページを開く", emoji: true }, url: c.resId ? actUrl(c.resId) : MGMT_URL, style: "primary" },
    ] });
  }
  blocks.push({ type: "divider" });
  const text = `${c.emoji} ${c.title}｜${c.name}様 ${c.resId}`; // 通知バナー/フォールバック用の一行
  return { text, blocks };
}
async function notifySlackCard(c: MpCard): Promise<void> {
  if (Deno.env.get("MYPAGE_SILENT") === "1") { console.log("[slack muted]", c.title); return; }
  const { text, blocks } = mpCard(c); await slackPost(text, blocks);
}
async function notifySlack(text: string): Promise<void> {
  // 一時ミュート（MYPAGE_SILENT=1 の間はSlack通知を出さない＝開発/テスト中の混乱防止）
  if (Deno.env.get("MYPAGE_SILENT") === "1") { console.log("[slack muted]", text); return; }
  await slackPost(text);
}

// 店舗マップ（P1=spk）。那覇は resv:nha_reservations, 列エイリアスで札幌名に揃える。
const STORES: Record<string, any> = {
  spk: {
    resv: "reservations", fleet: "fleet", tasks: "tasks", label: "札幌",
    sel: "id,ota,vehicle,lend_date,return_date,lend_time,return_time,del_time,col_time,name,mail,people,price,status,insurance,opt_b,opt_c,opt_j,opt_usb,del_place,col_place,del_lat,del_lng,col_lat,col_lng,kd_status,kd_track_token,mypage_locked",
    lendTimeCol: "lend_time", returnTimeCol: "return_time",
  },
};

// 営業時間内・30分刻み（9:00〜19:00・曜日問わず）
function validTime(t: string): boolean { const m = /^(\d{1,2}):(\d{2})$/.exec(t); if (!m) return false; const h = +m[1], mi = +m[2]; if (mi % 30 !== 0) return false; const v = h * 60 + mi; return v >= 540 && v <= 1140; }
// 場所は札幌市内限定・新千歳空港(千歳市)は不可。lat/lngがあれば札幌市域で判定、無ければ「札幌」表記を要求。
function isChitose(s: string): boolean { return /新千歳|千歳空港|千歳市/i.test(s || "") || /(^|[^A-Za-z])CTS([^A-Za-z]|$)/.test(s || ""); }
function inSapporo(lat: number, lng: number): boolean { return lat >= 42.90 && lat <= 43.30 && lng >= 141.15 && lng <= 141.62; }
function placeError(place: string, lat: number | null, lng: number | null): string | null {
  if (isChitose(place)) return "新千歳空港・千歳市は対象外です。札幌市内の場所をご指定ください。";
  if (lat != null && lng != null) { return inSapporo(lat, lng) ? null : "札幌市内の場所をご指定ください（新千歳空港など市外は不可）。"; }
  // ピン座標が無い自由入力は「札幌」表記必須をやめる（すすきの/大通/丘珠/カタカナ名等の有効な場所が弾かれないように）。市外の明示(新千歳/千歳)のみ上でブロック。
  return null;
}
// 基準日時まで hours 時間以内か（JST基準・雑に安全側）。日付なしは false（=まだ余裕あり扱い）。
function withinHours(date: string, time: string, hours: number): boolean {
  if (!date) return false;
  const t = (time && /^\d{1,2}:\d{2}$/.test(time)) ? time : "09:00";
  const dep = new Date(`${date}T${t}:00+09:00`).getTime();
  return (dep - Date.now()) < hours * 3600 * 1000;
}
function within24h(lendDate: string, lendTime: string): boolean { return withinHours(lendDate, lendTime, 24); }
// オプション受付期限＝貸出前日19:00（= 貸出日00:00 の 5時間前）
function pastOptionDeadline(lendDate: string): boolean {
  if (!lendDate) return false;
  const cutoff = new Date(`${lendDate}T00:00:00+09:00`).getTime() - 5 * 3600 * 1000;
  return Date.now() >= cutoff;
}
// 補償受付期限＝貸出前まで（貸出開始後は不可）
function pastInsDeadline(lendDate: string, lendTime: string): boolean {
  if (!lendDate) return false;
  const t = (lendTime && /^\d{1,2}:\d{2}$/.test(lendTime)) ? lendTime : "09:00";
  return Date.now() >= new Date(`${lendDate}T${t}:00+09:00`).getTime();
}
// 2026-11-08 nosh「出発済みのユーザーがお届け場所や時間を変更しても意味がないのでロック」:
//   お届け(DEL)が終わった＝お届けタスク済／お客様の受取報告／貸出中以降(kd_status)／貸出日を過ぎた、のどれかなら
//   お届け場所・お届け時間の変更依頼は受け付けない（回収の場所・時間はこれまでどおり申請できる）。
function jstToday(): string { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function delHandedOver(r: any, dTask: any, received: boolean): boolean {
  if (received) return true;
  if (dTask && dTask.done === true) return true;
  if (["active", "collecting", "completed"].includes(String(r.kd_status || ""))) return true;
  return !!r.lend_date && jstToday() > String(r.lend_date);
}
// ==== 差額決済（追加オプション/補償）====
const OPT_UNIT: Record<string, number> = { opt_c: 1000, opt_j: 500, opt_b: 1000 }; // 1レンタルあたり/台
const INS_DAY: Record<string, number> = { "なし": 0, "免責": 1100, "NOC": 1650 };  // 1日あたり
function insPriceOf(v: string): number { if (/フル|NOC|安心/.test(v)) return 1650; if (/免責|CDW/.test(v)) return 1100; return 0; }
// 暦日数：7/10 19:00-7/11 9:00 = 2日（= 日付差+1、最低1）
function calDays(lend: string, ret: string): number {
  if (!lend) return 1;
  const a = new Date(`${lend}T00:00:00+09:00`).getTime();
  const b = new Date(`${(ret || lend)}T00:00:00+09:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}
async function squareLink(name: string, amount: number, resId: string): Promise<{ url: string; orderId: string } | null> {
  const token = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
  if (!token || amount <= 0) return null;
  const loc = Deno.env.get("SQUARE_LOCATION_ID") || "L8N7J9RKPN3WH";
  try {
    const r = await fetch("https://connect.squareup.com/v2/online-checkout/payment-links", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "Square-Version": "2024-06-04" },
      body: JSON.stringify({ idempotency_key: `mypxtra-${resId}-${Date.now()}`, quick_pay: { name: `札幌店 ${name}様（${resId}）追加オプション/補償`, price_money: { amount, currency: "JPY" }, location_id: loc } }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.payment_link?.url) { console.log("[square link]", JSON.stringify(d)); return null; }
    return { url: d.payment_link.url, orderId: d.payment_link.order_id || "" };
  } catch (e) { console.error("[square link]", String(e)); return null; }
}
function nowJst(slice = false): string { const s = new Date(Date.now() + 9 * 3600 * 1000).toISOString(); return slice ? s.slice(5, 16).replace("T", " ") : s.replace("Z", "+09:00"); }

// OPシート/my-admin と同一の場所解決式。SPKでは実際の場所は reservations でなく tasks(changed_json._ssPlace) にある。
// _placeSource==="manual" なら手入力(place)を優先、それ以外は SSパトロール値(_ssPlace) を優先。
function resolveTaskPlace(t: any): string {
  if (!t) return "";
  let cj = t.changed_json;
  if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch { cj = {}; } }
  cj = cj || {};
  const place = String(t.place || "");
  if (cj._placeSource === "manual") return place;
  return String(cj._ssPlace || place || "");
}
function resolveTaskTime(t: any): string {
  if (!t) return "";
  let cj = t.changed_json;
  if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch { cj = {}; } }
  cj = cj || {};
  return String(cj._timeChange || cj._ssTime || t.time || "");  // OPシートと同じ優先(_timeChange最優先)
}
// オプション数量を tasks(changed_json._optB/_optC/_optJ) から取得（reservations と大きい方を採用）。
function taskOptNum(t: any, key: string): number {
  if (!t) return 0;
  let cj = t.changed_json;
  if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch { cj = {}; } }
  cj = cj || {};
  return Number(cj[key]) || 0;
}

// 2026-11-08 場所・時間の反映は DB 関数 spk_apply_mypage_change に一本化（那覇 nha_apply_mypage_change と同じ設計）。
//   予約・OPタスク(d-/c-)・記録(mypage_changes applied 行＋依頼の approved)を1トランザクションで書き、OPシートと同じ読み方で
//   読み直して承認値になっていなければ全部取り消す。承認値は changed_json._mpLock で取込・SSパトロール・古い画面の保存から守る。
//   旧 applyPlaceTime / patchTasksSpk（予約 PATCH → applied 行 → タスク PATCH を別々に送り、途中失敗や後からの上書きで食い違っていた）は廃止。
const SPK_PT_FIELDS = ["del_place", "col_place", "lend_time", "return_time"];
async function spkApplyChange(resId: string, field: string, val: unknown, actor: string, changeId: unknown, lat: unknown, lng: unknown, hdrActor?: string): Promise<{ ok: boolean; error?: string; data?: any }> {
  const v = String(val ?? "").trim();
  if (!SPK_PT_FIELDS.includes(field)) return { ok: false, error: "反映できない項目です: " + field };
  if (!v) return { ok: false, error: "反映する値が空です" };
  const la = lat == null || lat === "" ? NaN : Number(lat), ln = lng == null || lng === "" ? NaN : Number(lng);
  const ll = Number.isFinite(la) && Number.isFinite(ln) && (field === "del_place" || field === "col_place");
  const cid = changeId == null || changeId === "" ? null : (Number(changeId) || null);
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/spk_apply_mypage_change`, { method: "POST", headers: withActor(hdrActor),
      body: JSON.stringify({ p_res: resId, p_field: field, p_val: v, p_actor: actor, p_change_id: cid, p_lat: ll ? la : null, p_lng: ll ? ln : null }) });
    const tx = await r.text();
    if (!r.ok) { console.error("[spk apply]", r.status, tx); let m = tx; try { m = JSON.parse(tx).message || tx; } catch { /* noop */ } return { ok: false, error: String(m).slice(0, 300) }; }
    let d: any = null; try { d = JSON.parse(tx); } catch { /* noop */ }
    return { ok: true, data: d };
  } catch (e) { console.error("[spk apply]", String(e)); return { ok: false, error: String(e).slice(0, 300) }; }
}

// ==== 2026-11-07 別の案・お断り理由（アクションタブ仕様。マイページ側の「この案でOK／やめる」と対。那覇・高松・KEYと同じ形） ====
const REJ_JP: Record<string, string> = {  // 11/7 nosh「理由は明確に（予約状況の兼ね合いにて・回収スタッフ状況など）」
  no_vehicle: "誠に恐れ入りますが、予約状況の兼ね合いにより、ご希望の日時にご用意できるお車がございません。",
  full_slot: "誠に恐れ入りますが、{staff}の状況により、ご希望のお時間に伺うことができません。",
  out_of_area: "ご希望の場所は、お届け・回収の対象エリア外のため、伺うことができません。",
  out_of_stock: "誠に恐れ入りますが、在庫状況により、ご希望のオプションをご用意できる数がございません。",
  past_deadline: "変更の受付締切を過ぎているため、ご変更を承ることができません。",
  other: "",
};
function staffOf(field: string): string { return ["del_place", "lend_time"].includes(field) ? "お届けスタッフ" : ["col_place", "return_time", "ready"].includes(field) ? "回収スタッフ" : "担当スタッフ"; }
function rejectLine(code: string, text: string, field = ""): string { const a = (REJ_JP[code] || "").replace("{staff}", staffOf(field)); const t = String(text || "").trim().slice(0, 200); return [a, t].filter(Boolean).join("\n"); }
const PROP_FIELDS_END = ["col_place", "return_time", "ready"];
function proposalExpires(field: string, sd: string, st: string, ed: string, et: string): string {
  const now = Date.now(); let exp = now + 24 * 3600e3;
  const d = PROP_FIELDS_END.includes(field) ? ed : sd, t = PROP_FIELDS_END.includes(field) ? et : st;
  if (d) { const hm = String(t || "09:00").match(/(\d{1,2}):(\d{2})/); const h = hm ? +hm[1] : 9, m = hm ? +hm[2] : 0;
    const hand = Date.parse(`${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`); if (!isNaN(hand)) exp = Math.min(exp, hand - 2 * 3600e3); }
  return new Date(Math.max(exp, now + 30 * 60e3)).toISOString();
}
// お断り＝「できない理由＋代わりにできること＋今のご予約はそのまま」の1通（別の案・お断り共通の文面）
function declineMsg(head: string, label: string, field: string, newV: string, oldV: string, why: string, alt: string, next: string, url: string): string {
  // 11/7 nosh「返信の内容には気を付ける 丁寧な内容で」
  const want = field === "cancel" ? "ご予約のキャンセル" : field === "ready" ? "早めの回収" : `${label}の変更${newV ? `（${newV}）` : ""}`;
  const lines = [`${head}ご依頼いただいた${want}につきまして、ご連絡いたします。`];
  if (why) lines.push(why);
  if (alt) lines.push(`代わりに、${alt}${/[。！？!?]$/.test(alt) ? "" : "。"}`);
  if (next) lines.push(next);
  lines.push(field === "cancel" || !oldV ? "今のご予約はそのままです。" : `今のご予約（${label}：${oldV}）はそのままです。`);
  lines.push("ご不便をおかけいたしますが、何卒よろしくお願いいたします。");
  if (url) lines.push(url);
  return lines.join("\n");
}
// 2026-11-08 nosh「スタッフ編集できるように」：アクションタブの確認画面でスタッフが直した文（message_text）があれば、その文をそのまま送る
function staffText(p: any, url: string): string { const s = String(p?.message_text || "").replace(/\r\n/g, "\n").trim().slice(0, 2000); if (!s) return ""; return s.replace(/（マイページのURL）/g, url || "").replace(/\n{3,}/g, "\n\n").trim(); }
function expOverride(p: any, fallback: string): string { const e = Date.parse(String(p?.expires_at || "")), now = Date.now(); return (!isNaN(e) && e >= now + 25 * 60e3 && e <= now + 24 * 3600e3 + 10 * 60e3) ? new Date(e).toISOString() : fallback; }
function jstMdHm(iso: string): string { const j = new Date(Date.parse(iso) + 9 * 3600e3); return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`; }

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  let p: any; try { p = await req.json(); } catch { return json({ error: "bad json" }, 400, origin); }

  const action = String(p.action || "lookup").trim();

  // ==== keep-warm ping（DB不使用・即応答）＝cronでisolateを温めコールドスタート回避 ====
  if (action === "ping") return json({ ok: true, warm: true }, 200, origin);

  // ==== 追加決済の入金検知（cron/staff）: unpaid の charge を Square で照合→paid に更新＋顧客へ入金御礼LINE ====
  if (action === "checkExtra") {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const hdrSecret = req.headers.get("x-cron-secret");
    const bySecret = !!cronSecret && (hdrSecret === cronSecret || String(p.secret || "") === cronSecret);
    if (!bySecret) {
      const staffToken = String(p.staff_token || "").trim();
      if (!staffToken) return json({ error: "認証がありません" }, 401, origin);
      const who = await staffUser(staffToken);
      if (!who) return json({ error: "認証に失敗しました" }, 401, origin);
    }
    const token = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
    if (!token) return json({ error: "SQUARE未設定" }, 503, origin);
    const rows = await sbGet("mypage_extra_payments", `status=eq.unpaid&direction=eq.charge&square_order_id=not.is.null&select=id,reservation_id,square_order_id,amount,detail&limit=100`);
    if (!rows.length) return json({ ok: true, checked: 0, paid: 0 }, 200, origin);
    const ids = rows.map((x: any) => String(x.square_order_id));
    const br = await fetch("https://connect.squareup.com/v2/orders/batch-retrieve", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "Square-Version": "2024-06-04" },
      body: JSON.stringify({ location_ids: [Deno.env.get("SQUARE_LOCATION_ID") || "L8N7J9RKPN3WH"], order_ids: ids }),
    });
    const bd = await br.json().catch(() => ({}));
    const orders = Array.isArray(bd?.orders) ? bd.orders : [];
    const paidSet = new Set(orders.filter((o: any) => o.state === "COMPLETED" || (Array.isArray(o.tenders) && o.tenders.length > 0) || (o.net_amount_due_money && Number(o.net_amount_due_money.amount) === 0 && Number(o.total_money?.amount || 0) > 0)).map((o: any) => String(o.id)));
    let paidCount = 0;
    for (const row of rows) {
      if (paidSet.has(String(row.square_order_id))) {
        await sbPatch("mypage_extra_payments", `id=eq.${encodeURIComponent(String(row.id))}`, { status: "paid", paid_at: new Date().toISOString() }, "cron:extra");
        await pushLine(String(row.reservation_id), `【HANDYMAN 札幌デリバリー】追加分（${row.detail}）¥${Number(row.amount).toLocaleString()} のご入金を確認いたしました。ありがとうございます。`);
        paidCount++;
      }
    }
    return json({ ok: true, checked: rows.length, paid: paidCount }, 200, origin);
  }

  // ==== notify_preview: 全通知パターンをサンプルデータでSlackへ（DB書込/LINEなし・リリース前確認用）====
  if (action === "notify_preview") {
    const who = await staffUser(String(p.staff_token || "").trim());
    if (!who) return json({ error: "unauthorized" }, 401, origin);
    const N = "山田 太郎", ID = "R0SAMPLE01", OT = "R", PD = "2026-07-10〜2026-07-12", V = "ノア（Bクラス）";
    const samples: MpCard[] = [
      { emoji: "✏️", title: "マイページで変更（即時反映済）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📍 *お届け先*　（未設定） → *ススキノ ○○ホテル*", "🕐 *お届け時間*　10:00 → *11:00*", "📍 *回収先*　札幌駅 → *大通公園*"],
        action: "✅ OPシートに反映済み・*対応不要*（内容をご確認ください／🕘履歴にも記録）" },
      { emoji: "🟡", title: "お届け変更の承認待ち（お届け24時間以内）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📍 *お届け先*（希望）　○○ホテル → *△△ホテル*", "🕐 *お届け時間*（希望）　10:00 → *09:30*", "↳ 回収側（回収時間）は即時反映済み"],
        action: "⚠️ *要承認*：管理コンソール →「🔔変更依頼」で承認（承認で反映＋顧客へLINE通知）" },
      { emoji: "🟡", title: "有料オプション(シート類)変更の依頼（承認待ち）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📝 *依頼内容*\nチャイルドシート 1 → 2"], action: "⚠️ *要対応*：管理コンソール →「🔔変更依頼」で承認/却下（即時反映されていません）" },
      { emoji: "🟡", title: "補償(免責)変更の依頼（承認待ち）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📝 *依頼内容*\n基本＋免責補償 → 安心ワイドパック（NOC）"], action: "⚠️ *要対応*：管理コンソール →「🔔変更依頼」で承認/却下（即時反映されていません）" },
      { emoji: "🟡", title: "貸出/返却方法(区分)変更の依頼（承認待ち）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📝 *依頼内容*\nお届け → 来店受取に変更希望"], action: "⚠️ *要対応*：管理コンソール →「🔔変更依頼」で承認/却下（即時反映されていません）" },
      { emoji: "🔴", title: "キャンセル申請（承認待ち）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📝 *理由*\n急な予定変更のため"], action: "⚠️ *要対応*：管理コンソール →「🔔変更依頼」で承認/却下（承認でキャンセル確定＋配車解除＋顧客LINE）" },
      { emoji: "🟢", title: "早め回収OK（返却準備完了）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["🕐 *予定回収*　12:00", "🕒 *お客様の希望*　*10:30〜*"], action: "💡 スケジュールに余裕があれば早めに回収をご検討ください（お客様には「確認中」と表示中）" },
      { emoji: "🟢", title: "早め回収OK（返却準備完了）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["🕐 *予定回収*　12:00", "🕒 *お客様の希望*　指定なし"], action: "💡 スケジュールに余裕があれば早めに回収をご検討ください（お客様には「確認中」と表示中）" },
      { emoji: "✅", title: "承認して反映しました（オプション）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📝 *内容*　チャイルドシート 1 → 2", "👤 *担当*　大下"], action: "✅ 顧客へLINE通知済み・予約に反映済み" },
      { emoji: "✅", title: "承認して反映しました（キャンセル）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📝 *内容*　キャンセル依頼", "👤 *担当*　大下"], action: "✅ 顧客へLINE通知済み＋キャンセル確定・配車解除" },
      { emoji: "🚫", title: "却下しました（補償）", name: N, resId: ID, ota: OT, period: PD, vehicle: V,
        lines: ["📝 *内容*　安心ワイドパックへ変更希望", "👤 *担当*　大下"], action: "✅ 顧客へLINE通知済み（見送り）" },
    ];
    await slackPost("🧪 *マイページ通知プレビュー*（本日リリース前の全パターン確認・以下はサンプルで実データではありません）");
    for (const s of samples) { const { text, blocks } = mpCard(s); await slackPost(text, blocks); }
    return json({ ok: true, sent: samples.length }, 200, origin);
  }

  // ==== 管理者アクション: decide（承認/却下→実反映＋顧客LINE通知）====
  // スタッフの本体ログインJWTを検証（token=mypage_tokenは使わない）。
  if (action === "decide") {
    // 認証: (a) 共通PIN（全店ダッシュボード mypage-admin） / (b) スタッフJWT。他店EFと統一。
    const ADMIN_PIN = Deno.env.get("ADMIN_PIN") || "";
    const adminPin = String(p.admin_pin || "");
    let actor = "";
    if (ADMIN_PIN && adminPin && adminPin === ADMIN_PIN) { actor = "admin_pin"; }
    else {
      const staffToken = String(p.staff_token || "").trim();
      if (!staffToken) return json({ error: "スタッフ認証（PIN）が必要です" }, 401, origin);
      const who = await staffUser(staffToken);
      if (!who) return json({ error: "スタッフ認証に失敗しました" }, 401, origin);
      const user = who;
      actor = String(user?.email || user?.id || "staff");
    }
    const sAct = "staff:" + actor; // 監査ログ用（誰が＝担当個人）
    const changeId = p.change_id;
    const decision = String(p.decision || "").trim(); // approved | rejected | acknowledged | proposed
    if (!changeId || (decision !== "approved" && decision !== "rejected" && decision !== "acknowledged" && decision !== "proposed")) return json({ error: "パラメータ不正" }, 400, origin);
    const st0 = STORES.spk;
    const cRows = await sbGet("mypage_changes", `id=eq.${encodeURIComponent(String(changeId))}&select=id,reservation_id,field,old_value,new_value,note,status,payload`);
    const c = cRows[0];
    if (!c) return json({ error: "依頼が見つかりません" }, 404, origin);
    if (c.status !== "requested") return json({ error: "この依頼は既に処理済みです" }, 409, origin);
    // 確認済み（対応不要）＝反映も通知もせず、ステータスだけ更新してアーカイブ
    if (decision === "acknowledged") {
      await sbPatch("mypage_changes", `id=eq.${encodeURIComponent(String(changeId))}`, { status: "acknowledged", actor }, sAct);
      return json({ ok: true, decision, field: c.field }, 200, origin);
    }
    const resId2 = String(c.reservation_id);
    const rr = (await sbGet(st0.resv, `id=eq.${encodeURIComponent(resId2)}&select=id,name,ota,vehicle,lend_date,return_date,lend_time,return_time,del_place,col_place,insurance,opt_b,opt_c,opt_j,mypage_locked,mypage_token`))[0] || {};
    const myUrl = rr.mypage_token ? `https://nosh2318.github.io/spk-task/my.html?t=${rr.mypage_token}` : "";
    const kindJp: Record<string, string> = { option: "オプション", insurance: "補償", method: "受渡方法", cancel: "キャンセル", del_place: "お届け場所", col_place: "回収場所", lend_time: "お届け時間", return_time: "回収時間", ready: "早め回収(返却準備)" };
    const label = kindJp[c.field] || c.field;
    const pl = (c.payload && typeof c.payload === "object") ? c.payload : {};
    // ready(早め回収)の希望回収時刻を note/new_value から抽出（HH:MM）
    const rdyHM = c.field === "ready" ? ((String(c.note || "") + " " + String(c.new_value || "")).match(/(\d{1,2}:\d{2})/)?.[1] || "") : "";
    const rejCode = String(p.reject_reason || ""), rejText = String(p.reject_text || "").trim().slice(0, 200);
    const rejLine = decision === "rejected" ? rejectLine(rejCode, rejText, String(c.field)) : "";
    const altText = String(p.alt_text || "").trim().slice(0, 300);
    const keep = p.keep_as_is === true || p.keep_as_is === "true";  // 11/7 nosh「NGだけもあり得る＝既存予約のままでお願いします」
    // 2026-11-07 nosh決定「お断り＝できないが〜ならできます」：代わりの案なしのお断りは受け付けない（早め回収＝予定通り回収 は例外）
    if (decision === "rejected" && !altText && !keep) return json({ error: "代わりにできること（〜ならできます）を書いてください" }, 400, origin);
    const rejPayload = decision === "rejected" ? { payload: { ...pl, reject: { reason: rejCode || "other", text: rejText, alt: altText, ...(keep ? { keep: true } : {}), by: actor, at: new Date().toISOString() } } } : {};
    // ---- 別の案（お客様がマイページで「この案でOK」を押すと承認と同じ処理で確定）----
    if (decision === "proposed") {
      const ptext = String(p.proposal_text || "").trim().slice(0, 300); const pval = String(p.proposal_value || "").trim().slice(0, 100);
      if (!ptext) return json({ error: "別の案の内容を書いてください" }, 400, origin);
      if (c.field === "ready" && !/^\d{1,2}:\d{2}$/.test(pval)) return json({ error: "回収できる時間を 15:00 の形で入れてください" }, 400, origin);  // 11/7 nosh「早め回収も〜時ならOK」
      if (!["del_place", "col_place", "lend_time", "return_time", "ready"].includes(String(c.field))) return json({ error: "この種類の依頼は、マイページのボタンではなく文でお返事します（decision=rejected＋alt_text）" }, 400, origin);
      const exp = expOverride(p, proposalExpires(String(c.field), rr.lend_date, rr.lend_time, rr.return_date, rr.return_time));
      const whyP = rejectLine(rejCode, rejText, String(c.field));
      const pBody = staffText(p, myUrl) || declineMsg("【HANDYMAN 札幌デリバリー】", label, String(c.field), String(c.new_value || ""), String(c.old_value || ""), whyP, ptext, `マイページで「この案でOK」を押すと確定します（${jstMdHm(exp)}まで）。ご都合が合わなければ「やめる」を押してください。`, myUrl);
      // 2026-11-08 送った文そのものも記録（那覇と同じ・アーカイブで確認できるように）
      await sbPatch("mypage_changes", `id=eq.${encodeURIComponent(String(changeId))}`, { status: "proposed", actor, payload: { ...pl, proposal: { text: ptext, value: pval, reason: rejCode || "", reason_text: rejText, expires_at: exp, by: actor, at: new Date().toISOString(), sent: pBody.slice(0, 2000) } } }, sAct);
      await pushLine(resId2, pBody);
      await slackPost(`💬 別の案を送りました [札幌] ${label} / ${resId2}：${ptext}（お客様の返事待ち・${jstMdHm(exp)}まで）／ ${actor}`);
      return json({ ok: true, decision: "proposed", expires_at: exp }, 200, origin);
    }

    // 2026-11-08 場所・時間（と希望時間つきの早め回収）の承認は、お客様へ送る前に DB 関数で反映する。
    //   反映できなければ承認しない＝お客様へも送らない・依頼は requested のまま（関数内で全部取り消し済み）。
    //   成功時は関数が applied 行・予約の mypage_locked・タスク同期・依頼の approved まで済ませている。
    if (decision === "approved" && SPK_PT_FIELDS.includes(String(c.field))) {
      const f = String(c.field);
      const ap = await spkApplyChange(resId2, f, pl[f] ?? c.new_value, actor, changeId,
        f === "del_place" ? pl.del_lat : f === "col_place" ? pl.col_lat : null,
        f === "del_place" ? pl.del_lng : f === "col_place" ? pl.col_lng : null, sAct);
      if (!ap.ok) return json({ error: "反映できませんでした（何も変更していません）：" + (ap.error || ""), apply_failed: true }, 500, origin);
    } else if (decision === "approved" && c.field === "ready" && rdyHM) {
      const apR = await spkApplyChange(resId2, "return_time", rdyHM, actor, changeId, null, null, sAct);
      if (!apR.ok) return json({ error: "反映できませんでした（何も変更していません）：" + (apR.error || ""), apply_failed: true }, 500, origin);
    }

    // 顧客へLINE通知は「予約が有効なうち」に先に送る（キャンセル確定で cancelled になる前）。場所・時間・早め回収は上の反映が成功した後
    let msg: string;
    if (decision === "approved") {
      if (c.field === "cancel") msg = `【HANDYMAN 札幌デリバリー】ご予約 ${resId2} のキャンセルを承りました。\n担当より別途ご連絡いたします。ご利用ありがとうございました。`;
      else if (c.field === "ready") msg = rdyHM ? `【HANDYMAN 札幌デリバリー】早めのご返却（回収）を承りました。\n回収予定時間を ${rdyHM} に調整いたしました。マイページよりご確認ください。\n${myUrl}` : `【HANDYMAN 札幌デリバリー】早めのご返却（回収）を承りました。\nスケジュールを調整し、回収時間が早まる場合は改めてご連絡いたします。`;
      else msg = `【HANDYMAN 札幌デリバリー】ご依頼の${label}変更を承り、反映いたしました。\nマイページよりご確認ください。\n${myUrl}`;
    } else {
      if (c.field === "ready" && (keep || !altText)) msg = `【HANDYMAN 札幌デリバリー】ご連絡ありがとうございます。誠に申し訳ございませんが、今回は予定のお時間での回収とさせていただきます。${rejLine ? "\n" + rejLine : ""}\n何卒ご理解いただけますと幸いです。`;
      else if (keep) msg = declineMsg("【HANDYMAN 札幌デリバリー】", label, String(c.field), String(c.new_value || ""), String(c.old_value || ""), rejLine, "", "", myUrl).replace(/はそのままです。/, "のままでのご利用をお願いできますでしょうか。");
      else msg = declineMsg("【HANDYMAN 札幌デリバリー】", label, String(c.field), String(c.new_value || ""), String(c.old_value || ""), rejLine, altText, c.field === "cancel" ? "" : "こちらでよろしければ、マイページから改めてご依頼ください。", myUrl);
      const st3 = staffText(p, myUrl); if (st3) msg = st3;
    }
    await pushLine(resId2, msg);

    // 承認時の実反映
    if (decision === "approved") {
      if (c.field === "insurance" && pl.insurance) {
        await sbPatch(st0.resv, `id=eq.${encodeURIComponent(resId2)}`, { insurance: String(pl.insurance) }, sAct);
        const its = await sbGet(st0.tasks, `reservation_id=eq.${encodeURIComponent(resId2)}&deleted=not.is.true&select=_id`);
        for (const t of its) await sbPatch(st0.tasks, `_id=eq.${encodeURIComponent(String(t._id))}`, { insurance: String(pl.insurance) }, sAct);
      } else if (c.field === "option") {
        const rp: Record<string, unknown> = {};
        if (pl.opt_b != null) rp.opt_b = Number(pl.opt_b) || 0;
        if (pl.opt_c != null) rp.opt_c = Number(pl.opt_c) || 0;
        if (pl.opt_j != null) rp.opt_j = Number(pl.opt_j) || 0;
        if (Object.keys(rp).length) await sbPatch(st0.resv, `id=eq.${encodeURIComponent(resId2)}`, rp, sAct);
        // tasks(d-/c-) の changed_json._optB/_optC/_optJ も同期（OPシート表示の正本）
        const its = await sbGet(st0.tasks, `reservation_id=eq.${encodeURIComponent(resId2)}&deleted=not.is.true&select=_id,changed_json`);
        for (const t of its) {
          let cj: any = t.changed_json; if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch { cj = {}; } } cj = cj || {};
          if (pl.opt_b != null) cj._optB = Number(pl.opt_b) || 0;
          if (pl.opt_c != null) cj._optC = Number(pl.opt_c) || 0;
          if (pl.opt_j != null) cj._optJ = Number(pl.opt_j) || 0;
          await sbPatch(st0.tasks, `_id=eq.${encodeURIComponent(String(t._id))}`, { changed_json: cj, opt_c: (Number(pl.opt_c) || 0) > 0 }, sAct);
        }
      } else if (SPK_PT_FIELDS.includes(String(c.field)) || c.field === "ready") {
        // 場所・時間・早め回収(希望時間つき)は、お客様へ送る前に spk_apply_mypage_change で反映済み
      } else if (c.field === "cancel") {
        await sbPatch(st0.resv, `id=eq.${encodeURIComponent(resId2)}`, { status: "cancelled" }, sAct);
        // 配車解除＋タスク墓標（1アクション=対象のみ・復活させない）
        await fetch(`${SB_URL}/rest/v1/${st0.fleet}?reservation_id=eq.${encodeURIComponent(resId2)}`, { method: "DELETE", headers: withActor(sAct) });
        const its = await sbGet(st0.tasks, `reservation_id=eq.${encodeURIComponent(resId2)}&deleted=not.is.true&select=_id`);
        for (const t of its) await sbPatch(st0.tasks, `_id=eq.${encodeURIComponent(String(t._id))}`, { deleted: true }, sAct);
      }
      // method は自由記述のため自動反映せず（スタッフが本体で対応）
    }

    // 差額決済（追加オプション/補償）: 承認時のみ。プラス=Square決済リンク発行＋LINE送信 / マイナス=返金保留（手動）
    let extraLine = "";
    try {
    if (decision === "approved" && (c.field === "option" || c.field === "insurance")) {
      let amt = 0, det = "";
      if (c.field === "option") {
        const oc = Number(rr.opt_c) || 0, nc = (pl.opt_c != null ? Number(pl.opt_c) : oc) || 0;
        const oj = Number(rr.opt_j) || 0, nj = (pl.opt_j != null ? Number(pl.opt_j) : oj) || 0;
        const ob = Number(rr.opt_b) || 0, nb = (pl.opt_b != null ? Number(pl.opt_b) : ob) || 0;
        amt = (nc - oc) * OPT_UNIT.opt_c + (nj - oj) * OPT_UNIT.opt_j + (nb - ob) * OPT_UNIT.opt_b;
        const ps: string[] = [];
        if (nc !== oc) ps.push(`チャイルド${oc}→${nc}`);
        if (nj !== oj) ps.push(`ジュニア${oj}→${nj}`);
        if (nb !== ob) ps.push(`ベビー${ob}→${nb}`);
        det = "オプション " + ps.join(" / ");
      } else {
        const days = calDays(rr.lend_date, rr.return_date);
        const op = insPriceOf(String(rr.insurance || ""));
        const np = INS_DAY[String(pl.insurance)] ?? 0;
        amt = (np - op) * days;
        det = `補償 ${rr.insurance || "なし"}→${pl.insurance}（${days}日）`;
      }
      if (amt > 0) {
        const lk = await squareLink(rr.name || "", amt, resId2);
        await sbPost("mypage_extra_payments", { reservation_id: resId2, store: "spk", change_id: String(changeId), kind: c.field, detail: det, amount: amt, direction: "charge", square_order_id: lk?.orderId || null, square_url: lk?.url || null, status: lk ? "unpaid" : "link_failed" }, sAct);
        if (lk?.url) { await pushLine(resId2, `【HANDYMAN 札幌デリバリー】${det} の差額 ¥${amt.toLocaleString()} のお支払いをお願いいたします。\n下記リンクよりお手続きください。\n${lk.url}`); extraLine = `💳 *追加請求* ¥${amt.toLocaleString()}（決済リンク送信済・未決済）`; }
        else extraLine = `⚠️ *追加請求* ¥${amt.toLocaleString()}（リンク発行失敗＝手動でリンク作成・送信）`;
      } else if (amt < 0) {
        await sbPost("mypage_extra_payments", { reservation_id: resId2, store: "spk", change_id: String(changeId), kind: c.field, detail: det, amount: amt, direction: "refund", status: "refund_pending" }, sAct);
        extraLine = `↩️ *返金* ¥${Math.abs(amt).toLocaleString()}（手動で返金処理してください）`;
      }
    }
    } catch (e) { console.error("[extra-payment]", String(e)); extraLine = "⚠️ 差額決済の処理でエラー（手動確認）"; }

    // 2026-11-08 お断りは送った文そのものも記録（那覇と同じ）
    await sbPatch("mypage_changes", `id=eq.${encodeURIComponent(String(changeId))}`, { status: decision, actor, ...(decision === "rejected" ? { payload: { ...(rejPayload as any).payload, reject: { ...(rejPayload as any).payload.reject, sent: msg.slice(0, 2000) } } } : rejPayload) }, sAct);
    await notifySlackCard({
      emoji: decision === "approved" ? "✅" : "🚫",
      title: decision === "approved" ? `承認して反映しました（${label}）` : `却下しました（${label}）`,
      name: rr.name || "", resId: resId2, ota: rr.ota,
      period: (rr.lend_date ? `${rr.lend_date}〜${rr.return_date}` : undefined),
      vehicle: rr.vehicle,
      lines: [`📝 *内容*　${c.note || c.new_value || "-"}`, `👤 *担当*　${actor}`, ...(extraLine ? [extraLine] : []), ...(rejLine ? [`💬 *理由*　${rejLine.replace(/\n/g, " ")}`] : []), ...(altText || keep ? [`🔁 *代わりの案*　${altText || "今のご予約のまま"}`] : [])],
      action: decision === "approved"
        ? `✅ 顧客へLINE通知済み${c.field === "cancel" ? "＋キャンセル確定・配車解除" : "・予約に反映済み"}`
        : "✅ 顧客へLINE通知済み（見送り）",
    });
    // ★キャンセル(承認/却下)は予約取込chにも出す（新規予約の逆パターン・那覇と統一）
    if (c.field === "cancel") {
      const _nt = isNewSite(rr.ota, resId2) ? "（🆕NEW リニューアル公式サイト rent-handyman.com）" : "";
      await slackResv(decision === "approved"
        ? `✅ キャンセル承認（確定）[札幌]${_nt} ${rr.name || ""} / ${resId2} ／ 配車解放済・返金は規定に沿ってSquare手動返金`
        : `🚫 キャンセル却下 [札幌]${_nt} ${rr.name || ""} / ${resId2} ／ ${actor}`);
    }
    return json({ ok: true, decision, field: c.field }, 200, origin);
  }

  // ==== 整合パトロール: 予約情報(reservations) と マイページ/OP(tasks) が一致しているか全予約突合 ====
  // 認証: スタッフJWT(オンデマンド) または CRON_SECRET(定期・Slackアラート)。
  // マイページ・マイページ管理・OPシートは同じ resolve を使うので、食い違いの根＝reservations と tasks の値が競合している予約を検出する。
  if (action === "patrol") {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const hdrSecret = req.headers.get("x-cron-secret");
    const bySecret = !!cronSecret && (hdrSecret === cronSecret || String(p.secret || "") === cronSecret);
    if (!bySecret) {
      const staffToken = String(p.staff_token || "").trim();
      if (!staffToken) return json({ error: "認証がありません" }, 401, origin);
      const who = await staffUser(staffToken);
      if (!who) return json({ error: "スタッフ認証に失敗しました" }, 401, origin);
    }
    const st0 = STORES.spk;
    const today = nowJst().slice(0, 10);
    const resvs = await sbGet(st0.resv, `return_date=gte.${today}&status=not.in.("キャンセル",cancelled,cancel)&select=id,name,del_place,col_place,lend_time,return_time,del_time,col_time,insurance,opt_b,opt_c,opt_j&limit=1000`);
    // tasks をまとめて取得
    const ids = resvs.map((r: any) => r.id);
    const taskByRes: Record<string, any[]> = {};
    for (let i = 0; i < ids.length; i += 60) {
      const chunk = ids.slice(i, i + 60).map((x: string) => encodeURIComponent(x)).join(",");
      const ts = await sbGet(st0.tasks, `reservation_id=in.(${chunk})&deleted=not.is.true&select=_id,reservation_id,place,time,insurance,changed_json`);
      for (const t of ts) (taskByRes[t.reservation_id] = taskByRes[t.reservation_id] || []).push(t);
    }
    const norm = (v: any) => String(v ?? "").trim();
    const conflicts: any[] = []; let checked = 0; let okCount = 0;
    for (const r of resvs) {
      const tk = taskByRes[r.id] || [];
      const dT = tk.find((t: any) => String(t._id || "").startsWith("d-"));
      const cT = tk.find((t: any) => String(t._id || "").startsWith("c-"));
      const rowConf: any[] = [];
      const cmpText = (field: string, resvV: string, taskV: string) => {
        const a = norm(resvV), b = norm(taskV);
        if (a && b && a !== b) rowConf.push({ field, reservations: a, op: b });
      };
      cmpText("del_place", r.del_place, resolveTaskPlace(dT));
      cmpText("col_place", r.col_place, resolveTaskPlace(cT));
      cmpText("lend_time", r.lend_time || r.del_time, resolveTaskTime(dT));
      cmpText("return_time", r.return_time || r.col_time, resolveTaskTime(cT));
      cmpText("insurance", r.insurance, (dT?.insurance || cT?.insurance || ""));
      // オプション（両方>0で不一致のみ）
      const optCmp = (field: string, resvN: number, key: string) => {
        const tN = Math.max(taskOptNum(dT, key), taskOptNum(cT, key));
        if (resvN > 0 && tN > 0 && resvN !== tN) rowConf.push({ field, reservations: String(resvN), op: String(tN) });
      };
      optCmp("opt_c", Number(r.opt_c) || 0, "_optC");
      optCmp("opt_j", Number(r.opt_j) || 0, "_optJ");
      optCmp("opt_b", Number(r.opt_b) || 0, "_optB");
      checked++;
      if (rowConf.length) conflicts.push({ id: r.id, name: r.name, fields: rowConf });
      else okCount++;
    }
    const report = { ok: true, checked, matched: okCount, conflictCount: conflicts.length, conflicts, at: nowJst() };
    // 監視アラートは MYPAGE_SILENT に関係なく必ず発報（slackPost で強制）
    if (conflicts.length > 0) {
      const lines = conflicts.slice(0, 15).map((c: any) => `・${c.name || ""}様 ${c.id}: ${c.fields.map((f: any) => `${f.field}[予約:${f.reservations}≠OP:${f.op}]`).join(" / ")}`).join("\n");
      await slackPost(`🔍 *マイページ整合アラート* [札幌]\n照合${checked}件 → 一致${okCount} / *要対応 ${conflicts.length}件*\n${lines}${conflicts.length > 15 ? `\n…他${conflicts.length - 15}件` : ""}\n\n👉 *対応はこちら（1画面で確認→ボタンで統一）*\nhttps://nosh2318.github.io/spk-task/mypage-admin.html?bucket=but_tkm の「🛠 対応」タブ`);
    } else if (bySecret) {
      await slackPost(`🟢 *マイページ整合パトロール* [札幌] 照合${checked}件すべて一致（予約情報＝マイページ＝OPシート）。`);
    }
    return json(report, 200, origin);
  }

  // ==== resolve: 整合相違を「どちらかの値で統一」して解消（対応タブから）====
  if (action === "resolve") {
    const staffToken = String(p.staff_token || "").trim();
    if (!staffToken) return json({ error: "スタッフ認証がありません" }, 401, origin);
    const who = await staffUser(staffToken);
    if (!who) return json({ error: "スタッフ認証に失敗しました" }, 401, origin);
    const user = who; const actor = String(user?.email || "staff");
    const sAct = "staff:" + actor;
    const st0 = STORES.spk;
    const rid = String(p.reservation_id || "");
    const field = String(p.field || "");
    const value = String(p.value ?? "");
    const target = String(p.target || ""); // "resv"（予約に合わせる）| "op"（OP/マイページに合わせる）
    const FIELDS = ["del_place", "col_place", "lend_time", "return_time", "insurance", "opt_c", "opt_j", "opt_b"];
    if (!rid || !FIELDS.includes(field) || (target !== "resv" && target !== "op")) return json({ error: "パラメータ不正" }, 400, origin);
    const rr = (await sbGet(st0.resv, `id=eq.${encodeURIComponent(rid)}&select=id,${field.startsWith("opt") ? field : field},del_time,col_time,lend_time,return_time`))[0];
    if (!rr) return json({ error: "予約が見つかりません" }, 404, origin);
    // 2026-11-08 場所・時間は「予約に合わせる／OPに合わせる」のどちらも、統一する値を spk_apply_mypage_change で予約とOPタスクの両方へ
    //   1回で書く（読み直し確認・戻し防止ロック・applied 行の記録つき。依頼に紐づかないので p_change_id=null）
    if (SPK_PT_FIELDS.includes(field)) {
      const ap = await spkApplyChange(rid, field, value, actor, null, null, null, sAct);
      if (!ap.ok) return json({ error: "反映できませんでした（何も変更していません）：" + (ap.error || ""), apply_failed: true }, 500, origin);
      return json({ ok: true, field, value: (ap.data && ap.data.new) || value, target }, 200, origin);
    }
    if (target === "resv") {
      const rp: Record<string, unknown> = {};
      if (field.startsWith("opt")) rp[field] = Number(value) || 0;
      else rp[field] = value;
      await sbPatch(st0.resv, `id=eq.${encodeURIComponent(rid)}`, rp, sAct);
    } else { // op: tasksへ書いて予約情報側の値をOP/マイページに反映
      if (field === "insurance") { const its = await sbGet(st0.tasks, `reservation_id=eq.${encodeURIComponent(rid)}&deleted=not.is.true&select=_id`); for (const t of its) await sbPatch(st0.tasks, `_id=eq.${encodeURIComponent(String(t._id))}`, { insurance: value }, sAct); }
      else if (field.startsWith("opt")) { const key = "_opt" + field.slice(4).toUpperCase(); const its = await sbGet(st0.tasks, `reservation_id=eq.${encodeURIComponent(rid)}&deleted=not.is.true&select=_id,changed_json`); for (const t of its) { let cj: any = t.changed_json; if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch { cj = {}; } } cj = cj || {}; cj[key] = Number(value) || 0; await sbPatch(st0.tasks, `_id=eq.${encodeURIComponent(String(t._id))}`, { changed_json: cj, ...(field === "opt_c" ? { opt_c: (Number(value) || 0) > 0 } : {}) }, sAct); } }
    }
    await sbPost("mypage_changes", { reservation_id: rid, store: "spk", field, old_value: "", new_value: value, source: "staff", status: "applied", actor, note: `整合統一(${target === "resv" ? "予約側を更新" : "OP側を更新"})` }, sAct);
    return json({ ok: true, field, value, target }, 200, origin);
  }

  const token = String(p.token || "").trim();
  if (!token || token.length < 20) return json({ error: "アクセスキーが不正です" }, 400, origin);

  // token で予約特定（P1=spk）。将来 nha も同 token 空間で探索。
  const store = STORES.spk;
  const rows = await sbGet(store.resv, `mypage_token=eq.${encodeURIComponent(token)}&select=${store.sel}`);
  const r = rows[0];
  if (!r) return json({ error: "予約が見つかりません" }, 404, origin);
  const resId = String(r.id);
  // ★CANCELLED_ONLY_1030 キャンセル済みは「M月D日にキャンセル済みです」だけを返す（予約の中身は一切返さない／全アクション共通）
  { const _cs = String(r.status || ""); if (/cancel/i.test(_cs) || _cs.indexOf("キャンセル") >= 0) {
    let _at = "";
    try { const _lg = await sbGet("reservation_cancel_ledger", `reservation_id=eq.${encodeURIComponent(resId)}&event=eq.cancel&order=changed_at.desc&limit=1&select=changed_at`); _at = String((_lg[0] && _lg[0].changed_at) || ""); } catch (_) { /* noop */ }
    if (!_at) { try { const _u = await sbGet(store.resv, `id=eq.${encodeURIComponent(resId)}&select=updated_at`); _at = String((_u[0] && _u[0].updated_at) || ""); } catch (_) { /* noop */ } }
    const _t = _at ? new Date(_at).getTime() : NaN;
    const _cd = isNaN(_t) ? "" : new Date(_t + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const _msg = _cd ? `${+_cd.slice(5, 7)}月${+_cd.slice(8, 10)}日にキャンセル済みです` : "キャンセル済みです";
    return json({ ok: false, cancelled: true, cancel_date: _cd, error: _msg }, 200, origin);
  } }

  // ---- proposal_reply: お客様が別の案に返事（accept=この案でOK / decline=やめる）----
  if (action === "proposal_reply") {
    const cid = String(p.change_id || ""); const ans = String(p.answer || "");
    if (!cid || (ans !== "accept" && ans !== "decline")) return json({ error: "パラメータ不正" }, 400, origin);
    const pc = (await sbGet("mypage_changes", `id=eq.${encodeURIComponent(cid)}&store=eq.spk&reservation_id=eq.${encodeURIComponent(resId)}&select=id,field,new_value,status,payload`))[0];
    if (!pc) return json({ error: "ご提案が見つかりません" }, 404, origin);
    if (pc.status !== "proposed") return json({ ok: true, already: pc.status }, 200, origin);
    const ppl: any = (pc.payload && typeof pc.payload === "object") ? pc.payload : {}; const pr: any = ppl.proposal || {};
    const fj: Record<string, string> = { option: "オプション", insurance: "補償", method: "受渡方法", cancel: "キャンセル", del_place: "お届け場所", col_place: "回収場所", lend_time: "お届け時間", return_time: "回収時間", ready: "早め回収" };
    const lb = fj[pc.field] || pc.field;
    if (pr.expires_at && Date.parse(pr.expires_at) < Date.now()) {
      await sbPatch("mypage_changes", `id=eq.${encodeURIComponent(cid)}`, { status: "expired", payload: { ...ppl, proposal: { ...pr, answer: "expired", answered_at: new Date().toISOString() } } }, "customer");
      return json({ ok: false, expired: true, error: "ご提案の期限が過ぎました。今のご予約のままです。" }, 200, origin);
    }
    if (ans === "decline") {
      await sbPatch("mypage_changes", `id=eq.${encodeURIComponent(cid)}`, { status: "declined_by_guest", payload: { ...ppl, proposal: { ...pr, answer: "decline", answered_at: new Date().toISOString() } } }, "customer");
      await slackPost(`↩️ お客様が別の案を見送りました [札幌] ${lb} / ${resId}（今の予約のまま）`);
      return json({ ok: true, answered: "decline" }, 200, origin);
    }
    // accept：値を差し替えて requested に戻し、スタッフ承認と同じ decide を内部で呼ぶ（反映＋承認通知）
    const nv = String(pr.value || "").trim();
    await sbPatch("mypage_changes", `id=eq.${encodeURIComponent(cid)}`, { status: "requested", ...(nv ? { new_value: pc.field === "ready" ? `返却準備完了(早め回収OK) 希望時間 ${nv}〜` : nv } : {}), ...(nv && pc.field === "ready" ? { note: `希望回収時間の目安 ${nv}〜` } : {}), payload: { ...ppl, ...(nv && pc.field !== "ready" ? { [pc.field]: nv } : {}), proposal: { ...pr, answer: "accept", answered_at: new Date().toISOString() } } }, "customer");
    const dr2 = await fetch(`${SB_URL}/functions/v1/handyman-mypage`, { method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, body: JSON.stringify({ action: "decide", admin_pin: Deno.env.get("ADMIN_PIN") || "", change_id: Number(cid) || cid, decision: "approved" }) });
    const dj: any = await dr2.json().catch(() => ({}));
    // 2026-11-08 内部 decide が反映まで成功した時だけ「確定」と返す（失敗時は依頼が requested のまま＝スタッフが確認。お客様には確定と見せない）
    if (!dr2.ok || !dj.ok) {
      console.error("[proposal accept]", dr2.status, JSON.stringify(dj));
      await slackPost(`⚠️ お客様が別の案にOKしましたが自動反映に失敗 [札幌] ${lb} / ${resId}${dj && dj.apply_failed ? "（何も変更していません：" + String(dj.error || "").slice(0, 200) + "）" : ""}（アクションタブで承認してください）`);
      return json({ ok: false, answered: "accept", pending: true, error: "ご返事を受け付けました。まだ確定していません。スタッフが確認のうえ、ご連絡いたします。" }, 200, origin);
    }
    await slackPost(`✅ お客様が別の案にOK → 確定しました [札幌] ${lb} / ${resId}：${pr.text || nv}`);
    return json({ ok: true, answered: "accept" }, 200, origin);
  }

  // ---- guide_log: スタッフ代理(staff=1)/お客様 の 免許アップ・時間/場所変更・依頼・受取 を時刻付き監査ログへ（RPC spk_guide_log が予約時刻(lend_time/return_time)をサーバ側でキャプチャ→来店/返却との相違に後から気づける）----
  if (action === "guide_log") {
    try {
      await fetch(`${SB_URL}/rest/v1/rpc/spk_guide_log`, { method: "POST", headers: H, body: JSON.stringify({
        p_token: token,
        p_action: String(p.gaction || "unknown").slice(0, 40),
        p_staff: !!p.staff,
        p_session: String(p.session || "").slice(0, 80),
        p_meta: (p.meta && typeof p.meta === "object") ? p.meta : {},
        p_device: String(p.device || "").slice(0, 120),
      }) });
    } catch (_) { /* ログ失敗で本処理を止めない */ }
    return json({ ok: true }, 200, origin);
  }

  // ---- license_uploaded: お客様がマイページから免許証をアップした完了通知（Slack） ----
  if (action === "license_uploaded") {
    const cnt = Math.max(1, Math.min(20, parseInt(String(p.count || 1), 10) || 1));
    const drivers = Math.max(1, Math.min(10, parseInt(String(p.drivers || 1), 10) || 1));
    const blocks = [
      { type: "header", text: { type: "plain_text", text: "🪪 免許証アップロード（お客様）", emoji: true } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*お客様:*\n${r.name || "-"}` },
        { type: "mrkdwn", text: `*予約番号:*\n${resId}` },
        { type: "mrkdwn", text: `*ご予約元:*\n${r.ota || "-"}` },
        { type: "mrkdwn", text: `*利用期間:*\n${r.lend_date || "-"} 〜 ${r.return_date || "-"}` },
        { type: "mrkdwn", text: `*車両クラス:*\n${r.vehicle || "-"}` },
        { type: "mrkdwn", text: `*アップ枚数:*\n${cnt}枚（運転者${drivers}名）` },
      ] },
      { type: "context", elements: [ { type: "mrkdwn", text: "Googleドライブに保存済み。貸渡手続きにご利用ください。" } ] },
    ];
    // OPシート「🪪免許OK」表示用にDB記録（upsert）
    try { await fetch(`${SB_URL}/rest/v1/license_uploads?on_conflict=reservation_id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ reservation_id: resId, store: "spk", cnt, drivers, last_at: new Date().toISOString() }) }); } catch (_) { /* noop */ }
    await slackPost(`🪪 免許証アップロード完了 [札幌] ${r.name || ""} / ${resId} / ${cnt}枚`, blocks);
    return json({ ok: true }, 200, origin);
  }

  // ---- lookup: マイページ表示（正本を1画面に集約）----
  if (action === "lookup") {
    // 開封記録（アクティブ/スルー可視化用）: 顧客がマイページを開いた＝lookup。RPCでupsert（応答をブロックしない・失敗無視）。
    sbPost("rpc/mypage_touch_view", { p_rid: resId, p_store: "spk" }).catch(() => {});
    // 傷チェック解禁: 出発日の8:00以降のみ（それ以前は準備中でぼかす）
    const today = nowJst().slice(0, 10);
    const hh = +nowJst().slice(11, 13);
    const damageReady = (!!r.lend_date && (r.lend_date < today || (r.lend_date === today && hh >= 8)));
    // ▼ 独立した3クエリを並列化（傷チェックURL解決・OPタスク・変更履歴）＝lookupの応答短縮
    const damageP: Promise<string | null> = damageReady ? (async () => {
      // fleet→vehicle_code→vehicles.plate→vehicle_twins.share_token（best-effort・内部は依存直列）
      try {
        const fl = await sbGet(store.fleet, `reservation_id=eq.${encodeURIComponent(resId)}&select=vehicle_code`);
        const code = fl[0]?.vehicle_code;
        if (!code) return null;
        // 🔴 2026-09-28根治: vehicle_code=vehicle_twins.id 完全一致(札幌21台全一致)を最優先。
        //   旧: plate_no→display_label ilike は、plate_noが短い車だと「その数字を含む全twin」に誤ヒットしlimit1で別車を拾う(那覇C260801412=ヴィッツ③plate"8"→アルファード②2878を誤表示した同型)。
        let tw = await sbGet("vehicle_twins", `id=eq.${encodeURIComponent(code)}&store=eq.sapporo&share_enabled=eq.true&select=share_token&limit=1`);
        if (!tw[0]) {
          const vs = await sbGet("vehicles", `code=eq.${encodeURIComponent(code)}&select=plate_no`);
          const plate = vs[0]?.plate_no;
          if (plate) tw = await sbGet("vehicle_twins", `display_label=ilike.*/ ${encodeURIComponent(plate)}&store=eq.sapporo&share_enabled=eq.true&select=share_token&limit=1`);
        }
        return tw[0]?.share_token ? `https://nosh2318.github.io/handyman-damage/v.html?t=${tw[0].share_token}&v=v3` : null;
      } catch (_) { return null; }
    })() : Promise.resolve(null);
    const opTasksP = sbGet(store.tasks, `reservation_id=eq.${encodeURIComponent(resId)}&deleted=not.is.true&select=_id,done,place,time,insurance,changed_json`);
    const chgP = sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&order=created_at.desc&limit=10&select=id,field,old_value,new_value,source,status,actor,created_at,payload`);
    // エルメ受付フォーム回答（予約番号完全一致）＝reservations/OPが空でも顧客の回答済み場所を表示
    const linkP = sbGet("spk_line_links", `resv_no=eq.${encodeURIComponent(resId)}&select=del_place,col_place,del_time,col_time&limit=1`);
    const licP = sbGet("license_uploads", `reservation_id=eq.${encodeURIComponent(resId)}&select=cnt,drivers`);
    // 2026-11-08 NOWCARD: 貸出直後カード用に車両のETC車載器位置・写真・燃料（vehicles.specs、管理APP車両マスタで登録）。読むだけ・失敗はnull
    const carP: Promise<any> = (async () => {
      try {
        const fl = await sbGet(store.fleet, `reservation_id=eq.${encodeURIComponent(resId)}&select=vehicle_code`);
        const code = fl[0]?.vehicle_code; if (!code) return null;
        const vs = await sbGet("vehicles", `code=eq.${encodeURIComponent(code)}&select=specs&limit=1`);
        const sp = (vs[0] && vs[0].specs) || {};
        return { etc_location: sp.etc_location || null, etc_image: sp.etc_image || null, fuel: sp.fuel || null };
      } catch (_) { return null; }
    })();
    const [damageUrl, opTasks, chg, links, licRows, carInfo] = await Promise.all([damageP, opTasksP, chgP, linkP, licP, carP]);
    const link = links[0] || {};
    const licCnt = (licRows[0] && licRows[0].cnt) || 0; const licDrivers = (licRows[0] && licRows[0].drivers) || 0;
    // 場所/時間/オプション/補償は OPタスク(d-/c-)も見て「実値のある方」を採用（reservations 側が空のことが多い）。
    const dTask = opTasks.find((t: any) => String(t._id || "").startsWith("d-"));
    const cTask = opTasks.find((t: any) => String(t._id || "").startsWith("c-"));
    // 🔴 顧客/スタッフが確定した「適用済み変更(applied)」を最優先。
    // 理由: マイページで変更しても、SSパトロールが tasks._ssPlace/_ssTime をフォーム値に戻すため、
    // resolveTask* だけだと変更が表示に反映されない（お客様に古い値が見える／OP時間も戻る）。
    // mypage_changes(applied) は変更の正本ログなので、これを表示の最優先にする。
    const appliedChg = (field: string): string | null => {
      const c = chg.find((x: any) => x.field === field && x.status === "applied"); // chgは created_at desc=最新が先頭
      return c && String(c.new_value || "").trim() ? String(c.new_value).trim() : null;
    };
    const delPlaceR = appliedChg("del_place") ?? (resolveTaskPlace(dTask) || (r.del_place || "") || String(link.del_place || "").trim());
    const colPlaceR = appliedChg("col_place") ?? (resolveTaskPlace(cTask) || (r.col_place || "") || String(link.col_place || "").trim());
    // 🔴 2026-10-05 再発根治(複製ドリフト): 時間はapplied変更履歴より先にタスク実効値(resolveTaskTime)を見る。
    //   受付フォーム(spk_line_links)での時間変更はmypage_changesに行を作らずタスク_ssTimeだけ更新するため、
    //   applied履歴(例9/8の17:00)が古いまま最新のフォーム値(17:30=OP実表示)を追い越していた。
    //   タスクは承認反映時にも_timeChangeが入るのでappliedChg優先は冗長かつ有害→削除し実効値を正本に統一。
    const lendTimeR = resolveTaskTime(dTask) || appliedChg("lend_time") || r.lend_time || r.del_time || String(link.del_time || "").trim();
    const returnTimeR = resolveTaskTime(cTask) || appliedChg("return_time") || r.return_time || r.col_time || String(link.col_time || "").trim();
    // オプション：reservations と tasks の大きい方（どちらかにしか入っていないケースを両方拾う）
    const optBR = Math.max(Number(r.opt_b) || 0, taskOptNum(dTask, "_optB"), taskOptNum(cTask, "_optB"));
    const optCR = Math.max(Number(r.opt_c) || 0, taskOptNum(dTask, "_optC"), taskOptNum(cTask, "_optC"));
    const optJR = Math.max(Number(r.opt_j) || 0, taskOptNum(dTask, "_optJ"), taskOptNum(cTask, "_optJ"));
    // 補償：reservations が空なら tasks.insurance にフォールバック
    const insR = String(r.insurance || "").trim() || String(dTask?.insurance || cTask?.insurance || "").trim();
    const pendingCancel = chg.some((c: any) => c.field === "cancel" && c.status === "requested");
    const readyPending = chg.some((c: any) => c.field === "ready" && c.status === "requested");
    const receivedDone = chg.some((c: any) => c.field === "received" && c.status === "applied");
    // 履歴：mypage_changes（依頼/承認/マイページ即時）＋ OPタスク由来（フォーム回答・担当編集の場所/時間）を統合。
    const history: any[] = [];
    for (const c of chg) history.push({ field: c.field, value: c.new_value, old: c.old_value, at: c.created_at, source: c.source === "staff" ? "staff" : "customer_mypage", status: c.status, actor: c.actor });
    const pushTaskHist = (task: any, placeField: string, timeField: string) => {
      if (!task) return;
      let cj: any = task.changed_json; if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch { cj = {}; } } cj = cj || {};
      const src = cj._placeSource === "manual" ? "staff" : (cj._placeSource === "customer" ? "customer_mypage" : "customer_form");
      // 場所（マイページ即時分=customerはmypage_changes側にあるので重複回避）
      if (src !== "customer_mypage") {
        const pv = cj._placeSource === "manual" ? (task.place || "") : (cj._ssPlace || task.place || "");
        const pat = cj._manualPlaceAt || cj._ssPlaceAt || "";
        if (pv && pat) history.push({ field: placeField, value: pv, at: pat, source: src, status: "applied" });
        const tv = cj._ssTime || task.time || "";
        const tat = cj._manualTimeAt || cj._ssTimeAt || "";
        if (tv && tat) history.push({ field: timeField, value: tv, at: tat, source: src, status: "applied" });
      }
    };
    pushTaskHist(dTask, "del_place", "lend_time");
    pushTaskHist(cTask, "col_place", "return_time");
    history.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    const historyTop = history.slice(0, 10);
    return json({
      ok: true, store: "spk", label: store.label,
      reservation: {
        id: r.id, vehicle: r.vehicle, lend_date: r.lend_date, return_date: r.return_date,
        lend_time: lendTimeR, return_time: returnTimeR,
        name: r.name, people: r.people, status: r.status, insurance: insR, ota: r.ota,
        del_place: delPlaceR, col_place: colPlaceR,
        del_lat: r.del_lat ?? null, del_lng: r.del_lng ?? null, col_lat: r.col_lat ?? null, col_lng: r.col_lng ?? null,
        opt_b: optBR, opt_c: optCR, opt_j: optJR, opt_usb: r.opt_usb || 0,
        kd_status: r.kd_status || null,
        price: Number(r.price || 0),  // 2026-10-21 オーナー指示: マイページのご予約内容に料金を表示
      },
      damage: { ready: damageReady, url: damageUrl },
      tracking: { active: r.kd_status === "delivering" || r.kd_status === "collecting", kd_status: r.kd_status || null, token: r.kd_track_token || null },
      license: { cnt: licCnt, drivers: licDrivers },
      car: carInfo,
      received: receivedDone,
      pendingCancel, readyPending, recentChanges: chg, history: historyTop,
      delLocked: delHandedOver(r, dTask, receivedDone),
    }, 200, origin);
  }

  const st = String(r.status || "");
  const cancelled = st === "cancelled" || st === "キャンセル" || st === "cancel";

  // ---- receive_done: お客様が「受け取り完了」を報告 → お届け(DEL)タスクを済(完了)にしてSlack通知 ----
  if (action === "receive_done") {
    if (cancelled) return json({ error: "キャンセル済みの予約です" }, 409, origin);
    const cAct = "customer:" + resId;
    // 二重報告ガード（既に受取完了なら何もせず成功を返す）
    const prev = await sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.received&status=eq.applied&select=id&limit=1`);
    if (prev[0]) return json({ ok: true, received: true, already: true }, 200, origin);
    // お届け(d-)タスクを済(完了)に。無ければ先頭タスク。
    const tks = await sbGet(store.tasks, `reservation_id=eq.${encodeURIComponent(resId)}&deleted=not.is.true&select=_id,done,place,changed_json`);
    const delT = tks.find((t: any) => String(t._id || "").startsWith("d-")) || tks[0];
    if (delT && delT.done !== true) await sbPatch(store.tasks, `_id=eq.${encodeURIComponent(String(delT._id))}`, { done: true }, cAct);
    // 受け取り場所（お届け場所）を解決：OPタスク→予約→受付フォーム(spk_line_links)の順
    const linkRD = await sbGet("spk_line_links", `resv_no=eq.${encodeURIComponent(resId)}&select=del_place&limit=1`);
    const recvPlace = resolveTaskPlace(delT) || String(r.del_place || "").trim() || String((linkRD[0] && linkRD[0].del_place) || "").trim() || "（未設定）";
    // 監査ログ（受取完了を正本記録）
    await sbPost("mypage_changes", { reservation_id: resId, store: "spk", field: "received", old_value: "", new_value: "受取完了", source: "customer", status: "applied", note: "お客様がマイページで受け取り完了を報告→お届けタスクを完了(済)化" }, cAct);
    // Slack通知（#sapporo_user_action）
    const blocks = [
      { type: "header", text: { type: "plain_text", text: "✅ お客様 受け取り完了（札幌）", emoji: true } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*お客様:*\n${r.name || "-"}` },
        { type: "mrkdwn", text: `*予約番号:*\n${resId}` },
        { type: "mrkdwn", text: `*ご予約元:*\n${r.ota || "-"}` },
        { type: "mrkdwn", text: `*利用期間:*\n${r.lend_date || "-"} 〜 ${r.return_date || "-"}` },
        { type: "mrkdwn", text: `*車両クラス:*\n${r.vehicle || "-"}` },
        { type: "mrkdwn", text: `*受け取り場所:*\n${recvPlace}` },
      ] },
      { type: "context", elements: [ { type: "mrkdwn", text: "お客様が車両の受け取り完了を報告。OPシートのお届けタスクを完了(済)にしました。" } ] },
    ];
    await slackPost(`✅ 受け取り完了 [札幌] ${r.name || ""} / ${resId}`, blocks);
    return json({ ok: true, received: true }, 200, origin);
  }

  // ---- update: 場所/時間のみ 即時反映（顧客が自分で確定できる低制約項目）----
  if (action === "update") {
    if (cancelled) return json({ error: "キャンセル済みの予約は変更できません" }, 409, origin);
    const has = (k: string) => Object.prototype.hasOwnProperty.call(p, k);
    const delPlace = has("del_place") ? String(p.del_place || "").trim() : null;
    const colPlace = has("col_place") ? String(p.col_place || "").trim() : null;
    const lendTime = has("lend_time") ? String(p.lend_time || "").trim() : null;
    const returnTime = has("return_time") ? String(p.return_time || "").trim() : null;
    // 24h判定は「お届け系＝お届け日時基準」「回収系＝回収日時基準」で別々に。
    // （本日お届けでも回収が数日後なら回収の変更は可能）
    const touchesDel = delPlace !== null || lendTime !== null;
    const touchesCol = colPlace !== null || returnTime !== null;
    if (delPlace !== null && delPlace.length < 2) return json({ error: "お届け場所が不正です" }, 400, origin);
    if (colPlace !== null && colPlace.length < 2) return json({ error: "回収場所が不正です" }, 400, origin);
    if (lendTime !== null && !validTime(lendTime)) return json({ error: "お届け時間は9:00〜19:00（30分刻み）で指定してください" }, 400, origin);
    if (returnTime !== null && !validTime(returnTime)) return json({ error: "回収時間は9:00〜19:00（30分刻み）で指定してください" }, 400, origin);
    if (delPlace === null && colPlace === null && lendTime === null && returnTime === null) return json({ error: "変更内容がありません" }, 400, origin);
    // 場所は札幌市内限定・新千歳空港不可（サーバー側で強制）
    { const dLat0 = (has("del_lat") && p.del_lat != null && p.del_lat !== "") ? Number(p.del_lat) : null; const dLng0 = (has("del_lng") && p.del_lng != null && p.del_lng !== "") ? Number(p.del_lng) : null;
      const cLat0 = (has("col_lat") && p.col_lat != null && p.col_lat !== "") ? Number(p.col_lat) : null; const cLng0 = (has("col_lng") && p.col_lng != null && p.col_lng !== "") ? Number(p.col_lng) : null;
      if (delPlace !== null) { const e = placeError(delPlace, dLat0, dLng0); if (e) return json({ error: e }, 400, origin); }
      if (colPlace !== null) { const e = placeError(colPlace, cLat0, cLng0); if (e) return json({ error: e }, 400, origin); } }

    // 受付ルール（オーナー確定 2026-08-21）:
    //  お届け/回収の【時間・場所変更は、時間制限に関係なく全て承認制】。
    //  お客様は自由に申請でき、スタッフが管理コンソール →「🔔変更依頼」で承認すると
    //  OPシート/タスクへ反映（spk_apply_mypage_change）＋お客様へLINE通知。即時反映はしない。
    // 締切（オーナー確定 2026-09-01・SPK）:
    //  お届け(DEL)の場所・時間変更は【貸出前日19:00（営業時間外）で受付終了】。
    //  以降（＝翌営業日1発目のタスク直前の変更）は申請不可→公式LINEへ誘導。
    //  ※回収(COL)は従来どおり承認制で時間制限なし。
    // 2026-11-07 nosh「全てマイページから申請し運営が可否→ユーザーに戻る」：期限（お届け＝出発24時間前）は目安。期限後も申請を受け付け、公式LINEへは誘導しない。
    const num = (k: string) => (has(k) && p[k] != null && p[k] !== "") ? Number(p[k]) : null;
    const dLat = num("del_lat"), dLng = num("del_lng"), cLat = num("col_lat"), cLng = num("col_lng");
    const cAct = "customer:" + resId;
    // 🔴 変更前(old_value)＆Slack通知は「OPシート/マイページと同じ実効値」を使う。
    //   予約の生値 r.return_time は当初値(例17:00)で古く、OP/マイページの実表示は resolveTaskTime(例16:00)。
    //   lookup(649-652)と同じ解決順： applied変更 > OPタスク(resolveTask*) > 予約生値 > (未設定)。
    const _uTasks = await sbGet(store.tasks, `reservation_id=eq.${encodeURIComponent(resId)}&deleted=not.is.true&select=_id,done,place,time,insurance,changed_json`);
    const _uChg = await sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&status=eq.applied&order=created_at.desc&limit=10&select=field,new_value`);
    const _uApplied = (f: string): string => { const c = _uChg.find((x: any) => x.field === f); return c && String(c.new_value || "").trim() ? String(c.new_value).trim() : ""; };
    const _dT = _uTasks.find((t: any) => String(t._id || "").startsWith("d-"));
    const _cT = _uTasks.find((t: any) => String(t._id || "").startsWith("c-"));
    if (touchesDel) {
      const _rcv = await sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.received&status=eq.applied&select=id&limit=1`);
      if (delHandedOver(r, _dT, !!_rcv[0])) return json({ error: "お車のお届けが済んでいるため、お届け場所・お届け時間は変更できません。回収の場所・時間は変更できます。", delLocked: true }, 409, origin);
    }
    const curDelPlace = _uApplied("del_place") || resolveTaskPlace(_dT) || String(r.del_place || "").trim();
    const curColPlace = _uApplied("col_place") || resolveTaskPlace(_cT) || String(r.col_place || "").trim();
    // 🔴 2026-10-05 再発根治(複製ドリフト): 時間はapplied変更履歴より先にタスク実効値を見る(lookupと統一)。
    //   受付フォーム経由の時間変更はmypage_changesに残らずタスク_ssTimeだけ更新するため、古いapplied履歴が最新を追い越していた。
    const curLendTime = resolveTaskTime(_dT) || _uApplied("lend_time") || r.lend_time || r.del_time || "";
    const curReturnTime = resolveTaskTime(_cT) || _uApplied("return_time") || r.return_time || r.col_time || "";
    const oldOf = (f: string) => String((f === "del_place" ? curDelPlace : f === "col_place" ? curColPlace : f === "lend_time" ? curLendTime : curReturnTime) ?? "");
    const noteOf = (f: string) => f === "del_place" ? "お届け場所変更（承認制）" : f === "col_place" ? "回収場所変更（承認制）" : f === "lend_time" ? "お届け時間変更（承認制）" : "回収時間変更（承認制）";
    const mkReq = async (field: string, newV: string, payload: any) => {
      const ex = await sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.${field}&status=eq.requested&select=id&limit=1`);
      if (ex[0]) await sbPatch("mypage_changes", `id=eq.${ex[0].id}`, { new_value: newV, payload }, cAct);
      else await sbPost("mypage_changes", { reservation_id: resId, store: "spk", field, old_value: oldOf(field), new_value: newV, source: "customer", status: "requested", note: noteOf(field), payload }, cAct);
    };
    const reqLabels: string[] = [];
    if (delPlace !== null) { await mkReq("del_place", delPlace, { del_place: delPlace, ...(dLat != null && dLng != null ? { del_lat: dLat, del_lng: dLng } : {}) }); reqLabels.push("お届け場所"); }
    if (lendTime !== null) { await mkReq("lend_time", lendTime, { lend_time: lendTime }); reqLabels.push("お届け時間"); }
    if (colPlace !== null) { await mkReq("col_place", colPlace, { col_place: colPlace, ...(cLat != null && cLng != null ? { col_lat: cLat, col_lng: cLng } : {}) }); reqLabels.push("回収場所"); }
    if (returnTime !== null) { await mkReq("return_time", returnTime, { return_time: returnTime }); reqLabels.push("回収時間"); }
    const aLines: string[] = [];
    if (delPlace !== null) aLines.push(`📍 *お届け先*（希望）　${curDelPlace || "（未設定）"} → *${delPlace}*`);
    if (lendTime !== null) aLines.push(`🕐 *お届け時間*（希望）　${curLendTime || "（未設定）"} → *${lendTime}*`);
    if (colPlace !== null) aLines.push(`📍 *回収先*（希望）　${curColPlace || "（未設定）"} → *${colPlace}*`);
    if (returnTime !== null) aLines.push(`🕐 *回収時間*（希望）　${curReturnTime || "（未設定）"} → *${returnTime}*`);
    await notifySlackCard({ emoji: "🟡", title: "場所・時間変更の承認待ち", name: r.name, resId, ota: r.ota, period: `${r.lend_date}〜${r.return_date}`, vehicle: r.vehicle, lines: aLines, action: "⚠️ *要承認*：管理コンソール →「🔔変更依頼」で承認（承認で反映＋顧客へLINE通知）" });
    return json({ ok: true, pendingApproval: true, requested: reqLabels }, 200, origin);
  }

  // ---- request: 承認制の依頼（有料オプション/シート類・貸出返却方法(区分)変更）。即反映しない ----
  if (action === "request") {
    if (cancelled) return json({ error: "キャンセル済みの予約は変更できません" }, 409, origin);
    const reqType = String(p.req_type || "").trim(); // "option" | "method" | "insurance"
    const detail = String(p.detail || "").trim().slice(0, 300);
    const map: Record<string, string> = { option: "有料オプション(シート類)変更", method: "貸出/返却方法(区分)変更", insurance: "補償(免責)変更" };
    if (!map[reqType]) return json({ error: "リクエスト種別が不正です" }, 400, origin);
    if (detail.length < 1) return json({ error: "変更内容を入力してください" }, 400, origin);
    // 受付期限（種別ごと）: option=貸出前日19:00 / insurance=貸出前まで / method=出発2時間前
    // 2026-11-07 nosh：期限（オプション＝貸出前日19:00・方法＝出発24時間前）は目安。期限後も申請を受け付け、運営が可否を返す（公式LINEへは誘導しない）。
    // 補償だけは貸出開始後に変えられないため止める（当日はお渡しの際に変更可）。
    if (reqType === "insurance" && pastInsDeadline(r.lend_date, r.lend_time || r.del_time || ""))
      return json({ error: "ご利用開始後は、補償プランを変更できません。" }, 409, origin);
    const already = await sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.${reqType}&status=eq.requested&select=id&limit=1`);
    if (already[0]) return json({ ok: true, alreadyRequested: true, message: "同じ内容の依頼を受付済みです" }, 200, origin);
    // 構造化ターゲット（承認時に自動反映するための値）: insurance={insurance:"NOC"} / option={opt_c:1,opt_j:0,...}
    const payload = (p.target && typeof p.target === "object") ? p.target : null;
    await sbPost("mypage_changes", { reservation_id: resId, store: "spk", field: reqType, old_value: "", new_value: detail, source: "customer", status: "requested", note: map[reqType], payload }, "customer:" + resId);
    await notifySlackCard({ emoji: "🟡", title: `${map[reqType]}の依頼（承認待ち）`, name: r.name, resId, ota: r.ota, period: `${r.lend_date}〜${r.return_date}`, vehicle: r.vehicle, lines: [`📝 *依頼内容*\n${detail}`], action: "⚠️ *要対応*：管理コンソール →「🔔変更依頼」で承認/却下（即時反映されていません）" });
    return json({ ok: true, requested: true, kind: map[reqType] }, 200, origin);
  }

  // ---- cancel_request: キャンセル依頼（即削除しない＝OTA予約の安全側。スタッフ承認制）----
  if (action === "cancel_request") {
    if (cancelled) return json({ ok: true, alreadyCancelled: true }, 200, origin);
    const reason = String(p.reason || "").trim().slice(0, 200);
    const already = await sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.cancel&status=eq.requested&select=id&limit=1`);
    if (already[0]) return json({ ok: true, alreadyRequested: true }, 200, origin);
    await sbPost("mypage_changes", { reservation_id: resId, store: "spk", field: "cancel", old_value: st, new_value: "キャンセル依頼", source: "customer", status: "requested", note: reason }, "customer:" + resId);
    await notifySlackCard({ emoji: "🔴", title: "キャンセル申請（承認待ち）", name: r.name, resId, ota: r.ota, period: `${r.lend_date}〜${r.return_date}`, vehicle: r.vehicle, lines: [`📝 *理由*\n${reason || "（記載なし）"}`], action: "⚠️ *要対応*：管理コンソール →「🔔変更依頼」で承認/却下（承認でキャンセル確定＋配車解除＋顧客LINE）" });
    { const _nw = isNewSite(r.ota, resId);
    await slackResv(`🔴 キャンセル申請（承認待ち）[札幌]${_nw ? "（🆕NEW リニューアル公式サイト rent-handyman.com）" : ""} ${r.name || ""} / ${resId}`, [
      { type: "header", text: { type: "plain_text", text: `🔴 キャンセル申請（承認待ち）[札幌]${_nw ? " 🆕NEW" : ""}`, emoji: true } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*お客様:*\n${r.name || "-"} 様` }, { type: "mrkdwn", text: `*予約番号:*\n${resId}` },
        { type: "mrkdwn", text: `*ご予約元:*\n${otaJp(r.ota)}` }, { type: "mrkdwn", text: `*利用期間:*\n${r.lend_date || "-"} 〜 ${r.return_date || "-"}` },
        { type: "mrkdwn", text: `*車両:*\n${r.vehicle || "-"}` }, { type: "mrkdwn", text: `*金額:*\n¥${Number(r.price || 0).toLocaleString()}` },
      ] },
      { type: "section", text: { type: "mrkdwn", text: `*理由:*\n${reason || "（記載なし）"}` } },
      { type: "actions", elements: [ { type: "button", text: { type: "plain_text", text: "✅ キャンセル処理を開く", emoji: true }, style: "primary", url: actUrl(resId) } ] },
      { type: "context", elements: [ { type: "mrkdwn", text: "⚠️ 承認制です。上のボタンでこの予約の承認/却下画面が開きます（承認＝キャンセル確定＋配車解除＋お客様へLINE。返金は規定に沿って手動Square返金）。" } ] },
    ]); }
    return json({ ok: true, requested: true }, 200, origin);
  }

  // ---- ready: 返却準備完了（予定より早く回収してOKの合図）。スケジュールに余裕があれば早める判断材料。----
  if (action === "ready") {
    if (cancelled) return json({ error: "キャンセル済みの予約です" }, 409, origin);
    const already = await sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.ready&status=eq.requested&select=id&limit=1`);
    if (already[0]) return json({ ok: true, alreadyRequested: true }, 200, origin);
    const rdyTime = (typeof p.time === "string" && /^\d{1,2}:\d{2}$/.test(p.time.trim())) ? p.time.trim() : "";
    const newVal = rdyTime ? `返却準備完了(早め回収OK) 希望時間 ${rdyTime}〜` : "返却準備完了(早め回収OK)";
    await sbPost("mypage_changes", { reservation_id: resId, store: "spk", field: "ready", old_value: "", new_value: newVal, source: "customer", status: "requested", note: rdyTime ? `希望回収時間の目安 ${rdyTime}〜` : "予定時間より早い回収OK" }, "customer:" + resId);
    // 予定回収はOP/マイページと同じ resolveTaskTime(回収タスク) 優先（予約生値 return_time/col_time 直読みだと食い違う）
    const rdyTasks = await sbGet(store.tasks, `reservation_id=eq.${encodeURIComponent(resId)}&deleted=not.is.true&select=_id,place,time,insurance,changed_json`);
    const rdyCTask = rdyTasks.find((t: any) => String(t._id || "").startsWith("c-"));
    const schedCol = resolveTaskTime(rdyCTask) || r.return_time || r.col_time || "-";
    await notifySlackCard({ emoji: "🟢", title: "早め回収OK（返却準備完了）", name: r.name, resId, ota: r.ota, period: `${r.lend_date}〜${r.return_date}`, vehicle: r.vehicle, lines: [`🕐 *予定回収*　${schedCol}`, `🕒 *お客様の希望*　${rdyTime ? `*${rdyTime}〜*` : "指定なし"}`], action: "💡 スケジュールに余裕があれば早めに回収をご検討ください（お客様には「確認中」と表示中）" });
    return json({ ok: true, requested: true }, 200, origin);
  }

  return json({ error: "unknown action" }, 400, origin);
});
