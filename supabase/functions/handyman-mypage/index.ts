// ============================================================
// handyman-mypage : HANDYMAN 統合マイページ（全予約ユニークURL・token認証）
// 2026-07-03 / omni  ※札幌(spk)先行。那覇(nha)は後追いで STORES に追加。
// 設計思想:
//  ・token(=mypage_token) 所持＝本人（URLはLINE個別送信のみ・非公開）。KEYDROP追跡URLと同じ信頼モデル。
//  ・変更は必ず mypage_changes に追記（上書き・消失しても検出&復元できる保険）。
//  ・確定項目は reservations.mypage_locked に印を付ける → GAS再取込/タスク自動生成は上書きしない(protect相乗り)。
//  ・危険な変更(出発24h以内/キャンセル)は自動確定せず「申請→スタッフ承認」or「公式LINE」にフォールバック。
//  ・service_role は関数内のみ。deploy: --no-verify-jwt
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };

const ALLOWED = ["https://nosh2318.github.io", "https://keydrop.jp"];
function cors(o: string | null) {
  const allow = o && ALLOWED.includes(o) ? o : ALLOWED[0];
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
// 予約もと（OTA）ラベル
const OTA_JP: Record<string, string> = { J: "じゃらん", R: "楽天", S: "skyticket", O: "エアトリ", RC: "レンタカーcom", G: "GoGoOut", HP: "オフィシャル(HP)", SP: "オフィシャル(HP)", direct: "直販", KEYDROP: "KEYDROP" };
function otaJp(o?: string): string { const k = String(o || ""); return OTA_JP[k] || k || "—"; }
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

// tasks を protect merge で同期（顧客入力を優先・memoに✅変更済マーカー）
// 札幌tasks: PK=_id（d-/c-/w-接頭辞で種別）・reservation_id列で予約紐付け。
async function patchTasksSpk(store: any, resId: string, delPlace: string | null, colPlace: string | null, lendTime: string | null, returnTime: string | null, labels: string[], actor?: string): Promise<void> {
  const tasks = await sbGet(store.tasks, `reservation_id=eq.${encodeURIComponent(resId)}&select=_id,place,col_place,time,memo,changed_json`);
  const stamp = nowJst(true);
  const marker = `✅変更済(${stamp}):${labels.join("・")}`;
  for (const t of tasks) {
    const tp = String(t._id || "");
    const patch: Record<string, unknown> = {};
    const cj = (t.changed_json && typeof t.changed_json === "object") ? { ...t.changed_json } : {};
    const isDel = tp.startsWith("d-");
    const isCol = tp.startsWith("c-");
    if (delPlace !== null && isDel) { patch.place = delPlace; cj._ssPlace = delPlace; cj._placeSource = "customer"; }
    if (colPlace !== null && isCol) { patch.place = colPlace; cj._ssPlace = colPlace; cj._placeSource = "customer"; }
    if (colPlace !== null && isDel) { patch.col_place = colPlace; }
    // 🔴 _timeChange も立てる：OPシート表示は timeChange||_ssTime||time の優先順で、_timeChangeが最優先。
    // かつSSパトロールは「!t.timeChange のときだけ _ssTime を上書き」する＝これで顧客の時間変更がパトロールに戻されない（OPシートもマイページも新値のまま）。
    if (lendTime !== null && isDel) { patch.time = lendTime; cj._ssTime = lendTime; cj._timeChange = lendTime; }
    if (returnTime !== null && isCol) { patch.time = returnTime; cj._ssTime = returnTime; cj._timeChange = returnTime; }
    let m = String(t.memo || ""); if (!m.includes(marker)) m = m ? `${m} ${marker}` : marker; patch.memo = m; patch.changed_json = cj;
    if (Object.keys(patch).length) await sbPatch(store.tasks, `_id=eq.${encodeURIComponent(String(t._id))}`, patch, actor);
  }
}

// 場所/時間を即時反映（reservations＋mypage_locked＋監査ログ(applied)＋tasks同期）。labels配列、失敗はnull。
async function applyPlaceTime(store: any, r: any, resId: string, delPlace: string | null, colPlace: string | null, lendTime: string | null, returnTime: string | null, dLat: number | null, dLng: number | null, cLat: number | null, cLng: number | null, actor?: string): Promise<string[] | null> {
  const rPatch: Record<string, unknown> = {};
  const locked = (r.mypage_locked && typeof r.mypage_locked === "object") ? { ...r.mypage_locked } : {};
  const changes: any[] = []; const labels: string[] = [];
  const mark = (f: string, oldV: any, newV: any) => { locked[f] = { at: nowJst(), by: "customer" }; changes.push({ reservation_id: resId, store: "spk", field: f, old_value: String(oldV ?? ""), new_value: String(newV ?? ""), source: "customer", status: "applied" }); };
  if (delPlace != null) { rPatch.del_place = delPlace; if (dLat != null && dLng != null) { rPatch.del_lat = dLat; rPatch.del_lng = dLng; } mark("del_place", r.del_place, delPlace); labels.push("お届け場所"); }
  if (colPlace != null) { rPatch.col_place = colPlace; if (cLat != null && cLng != null) { rPatch.col_lat = cLat; rPatch.col_lng = cLng; } mark("col_place", r.col_place, colPlace); labels.push("回収場所"); }
  if (lendTime != null) { rPatch[store.lendTimeCol] = lendTime; rPatch.del_time = lendTime; mark("lend_time", r.lend_time, lendTime); labels.push("お届け時間"); }
  if (returnTime != null) { rPatch[store.returnTimeCol] = returnTime; rPatch.col_time = returnTime; mark("return_time", r.return_time, returnTime); labels.push("回収時間"); }
  if (!labels.length) return [];
  rPatch.mypage_locked = locked;
  const ok = await sbPatch(store.resv, `id=eq.${encodeURIComponent(resId)}`, rPatch, actor);
  if (!ok) return null;
  for (const c of changes) await sbPost("mypage_changes", c, actor);
  await patchTasksSpk(store, resId, delPlace, colPlace, lendTime, returnTime, labels, actor);
  return labels;
}

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
      const who = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${staffToken}` } });
      if (!who.ok) return json({ error: "認証に失敗しました" }, 401, origin);
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
    const who = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${String(p.staff_token || "").trim()}` } });
    if (!who.ok) return json({ error: "unauthorized" }, 401, origin);
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
    const staffToken = String(p.staff_token || "").trim();
    if (!staffToken) return json({ error: "スタッフ認証がありません" }, 401, origin);
    const who = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${staffToken}` } });
    if (!who.ok) return json({ error: "スタッフ認証に失敗しました" }, 401, origin);
    const user = await who.json().catch(() => ({}));
    const actor = String(user?.email || user?.id || "staff");
    const sAct = "staff:" + actor; // 監査ログ用（誰が＝担当個人）
    const changeId = p.change_id;
    const decision = String(p.decision || "").trim(); // approved | rejected
    if (!changeId || (decision !== "approved" && decision !== "rejected")) return json({ error: "パラメータ不正" }, 400, origin);
    const st0 = STORES.spk;
    const cRows = await sbGet("mypage_changes", `id=eq.${encodeURIComponent(String(changeId))}&select=id,reservation_id,field,new_value,note,status,payload`);
    const c = cRows[0];
    if (!c) return json({ error: "依頼が見つかりません" }, 404, origin);
    if (c.status !== "requested") return json({ error: "この依頼は既に処理済みです" }, 409, origin);
    const resId2 = String(c.reservation_id);
    const rr = (await sbGet(st0.resv, `id=eq.${encodeURIComponent(resId2)}&select=id,name,ota,vehicle,lend_date,return_date,lend_time,return_time,del_place,col_place,insurance,opt_b,opt_c,opt_j,mypage_locked,mypage_token`))[0] || {};
    const myUrl = rr.mypage_token ? `https://nosh2318.github.io/spk-task/my.html?t=${rr.mypage_token}` : "";
    const kindJp: Record<string, string> = { option: "オプション", insurance: "補償", method: "受渡方法", cancel: "キャンセル", del_place: "お届け場所", col_place: "回収場所", lend_time: "お届け時間", return_time: "回収時間", ready: "早め回収(返却準備)" };
    const label = kindJp[c.field] || c.field;
    const pl = (c.payload && typeof c.payload === "object") ? c.payload : {};

    // 顧客へLINE通知は「予約が有効なうち」に先に送る（キャンセル確定で cancelled になる前）
    let msg: string;
    if (decision === "approved") {
      if (c.field === "cancel") msg = `【HANDYMAN 札幌デリバリー】ご予約 ${resId2} のキャンセルを承りました。\n担当より別途ご連絡いたします。ご利用ありがとうございました。`;
      else if (c.field === "ready") msg = `【HANDYMAN 札幌デリバリー】早めのご返却（回収）を承りました。\nスケジュールを調整し、回収時間が早まる場合は改めてご連絡いたします。`;
      else msg = `【HANDYMAN 札幌デリバリー】ご依頼の${label}変更を承り、反映いたしました。\nマイページよりご確認ください。\n${myUrl}`;
    } else {
      if (c.field === "ready") msg = `【HANDYMAN 札幌デリバリー】ご連絡ありがとうございます。今回は予定のお時間での回収を予定しております。何卒よろしくお願いいたします。`;
      else msg = `【HANDYMAN 札幌デリバリー】ご依頼いただいた${label}${c.field === "cancel" ? "申請" : "変更"}につきまして、恐れ入りますが今回はお受けいたしかねます。\n詳細は公式LINEにてご連絡いたします。`;
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
      } else if (c.field === "del_place" || c.field === "col_place" || c.field === "lend_time" || c.field === "return_time") {
        // お届け24h以内の場所/時間 承認 → 即時反映と同じ経路で適用
        await applyPlaceTime(st0, rr, resId2,
          c.field === "del_place" ? (pl.del_place ?? null) : null,
          c.field === "col_place" ? (pl.col_place ?? null) : null,
          c.field === "lend_time" ? (pl.lend_time ?? null) : null,
          c.field === "return_time" ? (pl.return_time ?? null) : null,
          pl.del_lat ?? null, pl.del_lng ?? null, pl.col_lat ?? null, pl.col_lng ?? null, sAct);
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

    await sbPatch("mypage_changes", `id=eq.${encodeURIComponent(String(changeId))}`, { status: decision, actor }, sAct);
    await notifySlackCard({
      emoji: decision === "approved" ? "✅" : "🚫",
      title: decision === "approved" ? `承認して反映しました（${label}）` : `却下しました（${label}）`,
      name: rr.name || "", resId: resId2, ota: rr.ota,
      period: (rr.lend_date ? `${rr.lend_date}〜${rr.return_date}` : undefined),
      vehicle: rr.vehicle,
      lines: [`📝 *内容*　${c.note || c.new_value || "-"}`, `👤 *担当*　${actor}`, ...(extraLine ? [extraLine] : [])],
      action: decision === "approved"
        ? `✅ 顧客へLINE通知済み${c.field === "cancel" ? "＋キャンセル確定・配車解除" : "・予約に反映済み"}`
        : "✅ 顧客へLINE通知済み（見送り）",
    });
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
      const who = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${staffToken}` } });
      if (!who.ok) return json({ error: "スタッフ認証に失敗しました" }, 401, origin);
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
      await slackPost(`🔍 *マイページ整合アラート* [札幌]\n照合${checked}件 → 一致${okCount} / *要対応 ${conflicts.length}件*\n${lines}${conflicts.length > 15 ? `\n…他${conflicts.length - 15}件` : ""}\n\n👉 *対応はこちら（1画面で確認→ボタンで統一）*\nhttps://nosh2318.github.io/spk-task/my-admin.html の「🛠 対応」タブ`);
    } else if (bySecret) {
      await slackPost(`🟢 *マイページ整合パトロール* [札幌] 照合${checked}件すべて一致（予約情報＝マイページ＝OPシート）。`);
    }
    return json(report, 200, origin);
  }

  // ==== resolve: 整合相違を「どちらかの値で統一」して解消（対応タブから）====
  if (action === "resolve") {
    const staffToken = String(p.staff_token || "").trim();
    if (!staffToken) return json({ error: "スタッフ認証がありません" }, 401, origin);
    const who = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${staffToken}` } });
    if (!who.ok) return json({ error: "スタッフ認証に失敗しました" }, 401, origin);
    const user = await who.json().catch(() => ({})); const actor = String(user?.email || "staff");
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
    if (target === "resv") {
      const rp: Record<string, unknown> = {};
      if (field === "lend_time") { rp.lend_time = value; rp.del_time = value; }
      else if (field === "return_time") { rp.return_time = value; rp.col_time = value; }
      else if (field.startsWith("opt")) rp[field] = Number(value) || 0;
      else rp[field] = value;
      await sbPatch(st0.resv, `id=eq.${encodeURIComponent(rid)}`, rp, sAct);
    } else { // op: tasksへ書いて予約情報側の値をOP/マイページに反映
      if (field === "del_place") await patchTasksSpk(st0, rid, value, null, null, null, ["お届け場所"], sAct);
      else if (field === "col_place") await patchTasksSpk(st0, rid, null, value, null, null, ["回収場所"], sAct);
      else if (field === "lend_time") await patchTasksSpk(st0, rid, null, null, value, null, ["お届け時間"], sAct);
      else if (field === "return_time") await patchTasksSpk(st0, rid, null, null, null, value, ["回収時間"], sAct);
      else if (field === "insurance") { const its = await sbGet(st0.tasks, `reservation_id=eq.${encodeURIComponent(rid)}&deleted=not.is.true&select=_id`); for (const t of its) await sbPatch(st0.tasks, `_id=eq.${encodeURIComponent(String(t._id))}`, { insurance: value }, sAct); }
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
        const vs = await sbGet("vehicles", `code=eq.${encodeURIComponent(code)}&select=plate_no`);
        const plate = vs[0]?.plate_no;
        if (!plate) return null;
        const tw = await sbGet("vehicle_twins", `display_label=ilike.*${encodeURIComponent(plate)}*&share_enabled=eq.true&select=share_token&limit=1`);
        return tw[0]?.share_token ? `https://nosh2318.github.io/handyman-damage/v.html?t=${tw[0].share_token}&v=v3` : null;
      } catch (_) { return null; }
    })() : Promise.resolve(null);
    const opTasksP = sbGet(store.tasks, `reservation_id=eq.${encodeURIComponent(resId)}&deleted=not.is.true&select=_id,place,time,insurance,changed_json`);
    const chgP = sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&order=created_at.desc&limit=10&select=field,old_value,new_value,source,status,actor,created_at`);
    // エルメ受付フォーム回答（予約番号完全一致）＝reservations/OPが空でも顧客の回答済み場所を表示
    const linkP = sbGet("spk_line_links", `resv_no=eq.${encodeURIComponent(resId)}&select=del_place,col_place,del_time,col_time&limit=1`);
    const [damageUrl, opTasks, chg, links] = await Promise.all([damageP, opTasksP, chgP, linkP]);
    const link = links[0] || {};
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
    const lendTimeR = appliedChg("lend_time") ?? (resolveTaskTime(dTask) || r.lend_time || r.del_time || String(link.del_time || "").trim());
    const returnTimeR = appliedChg("return_time") ?? (resolveTaskTime(cTask) || r.return_time || r.col_time || String(link.col_time || "").trim());
    // オプション：reservations と tasks の大きい方（どちらかにしか入っていないケースを両方拾う）
    const optBR = Math.max(Number(r.opt_b) || 0, taskOptNum(dTask, "_optB"), taskOptNum(cTask, "_optB"));
    const optCR = Math.max(Number(r.opt_c) || 0, taskOptNum(dTask, "_optC"), taskOptNum(cTask, "_optC"));
    const optJR = Math.max(Number(r.opt_j) || 0, taskOptNum(dTask, "_optJ"), taskOptNum(cTask, "_optJ"));
    // 補償：reservations が空なら tasks.insurance にフォールバック
    const insR = String(r.insurance || "").trim() || String(dTask?.insurance || cTask?.insurance || "").trim();
    const pendingCancel = chg.some((c: any) => c.field === "cancel" && c.status === "requested");
    const readyPending = chg.some((c: any) => c.field === "ready" && c.status === "requested");
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
      },
      damage: { ready: damageReady, url: damageUrl },
      tracking: { active: r.kd_status === "delivering" || r.kd_status === "collecting", kd_status: r.kd_status || null, token: r.kd_track_token || null },
      pendingCancel, readyPending, recentChanges: chg, history: historyTop,
    }, 200, origin);
  }

  const st = String(r.status || "");
  const cancelled = st === "cancelled" || st === "キャンセル" || st === "cancel";

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

    // 受付ルール（ユーザー主導での時間・場所変更・オーナー確定）:
    //  DEL(お届け): 24時間前まで即時。24時間以内は「承認制」(依頼→スタッフ承認で反映)。
    //  COL(回収):   2時間前まで即時。2時間以内は受付終了(公式LINE)。
    const num = (k: string) => (has(k) && p[k] != null && p[k] !== "") ? Number(p[k]) : null;
    const dLat = num("del_lat"), dLng = num("del_lng"), cLat = num("col_lat"), cLng = num("col_lng");
    const delApproval = touchesDel && within24h(r.lend_date, r.lend_time || r.del_time || "");
    if (touchesCol && withinHours(r.return_date, r.return_time || r.col_time || "", 2))
      return json({ error: "回収の2時間前を過ぎているため、回収の変更は公式LINEにて承ります", lineOnly: true }, 409, origin);

    // ---- DEL が24時間以内 → 承認制（依頼として記録・即反映しない）----
    if (delApproval) {
      const cAct = "customer:" + resId;
      const mkReq = async (field: string, newV: string, payload: any) => {
        const ex = await sbGet("mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.${field}&status=eq.requested&select=id&limit=1`);
        if (ex[0]) await sbPatch("mypage_changes", `id=eq.${ex[0].id}`, { new_value: newV, payload }, cAct);
        else await sbPost("mypage_changes", { reservation_id: resId, store: "spk", field, old_value: String((field === "del_place" ? r.del_place : r.lend_time) ?? ""), new_value: newV, source: "customer", status: "requested", note: field === "del_place" ? "お届け場所変更(24h以内)" : "お届け時間変更(24h以内)", payload }, cAct);
      };
      const reqLabels: string[] = [];
      if (delPlace !== null) { await mkReq("del_place", delPlace, { del_place: delPlace, ...(dLat != null && dLng != null ? { del_lat: dLat, del_lng: dLng } : {}) }); reqLabels.push("お届け場所"); }
      if (lendTime !== null) { await mkReq("lend_time", lendTime, { lend_time: lendTime }); reqLabels.push("お届け時間"); }
      let colLabels: string[] = [];
      if (touchesCol) colLabels = (await applyPlaceTime(store, r, resId, null, colPlace, null, returnTime, null, null, cLat, cLng, cAct)) || [];
      const aLines: string[] = [];
      if (delPlace !== null) aLines.push(`📍 *お届け先*（希望）　${r.del_place || "（未設定）"} → *${delPlace}*`);
      if (lendTime !== null) aLines.push(`🕐 *お届け時間*（希望）　${r.lend_time || "（未設定）"} → *${lendTime}*`);
      if (colLabels.length) aLines.push(`↳ 回収側（${colLabels.join("・")}）は即時反映済み`);
      await notifySlackCard({ emoji: "🟡", title: "お届け変更の承認待ち（お届け24時間以内）", name: r.name, resId, ota: r.ota, period: `${r.lend_date}〜${r.return_date}`, vehicle: r.vehicle, lines: aLines, action: "⚠️ *要承認*：管理コンソール →「🔔変更依頼」で承認（承認で反映＋顧客へLINE通知）" });
      return json({ ok: true, pendingApproval: true, requested: reqLabels, updated: colLabels }, 200, origin);
    }

    // ---- 即時反映（DELは24h超 / COLは2h超）----
    const labels = await applyPlaceTime(store, r, resId, delPlace, colPlace, lendTime, returnTime, dLat, dLng, cLat, cLng, "customer:" + resId);
    if (labels === null) return json({ error: "変更の保存に失敗しました" }, 500, origin);
    // 変更されたフィールドだけを 変更前→変更後 で表示（4項目まとめ表示のノイズを排除）
    const chLines: string[] = [];
    if (delPlace !== null) chLines.push(`📍 *お届け先*　${r.del_place || "（未設定）"} → *${delPlace}*`);
    if (lendTime !== null) chLines.push(`🕐 *お届け時間*　${r.lend_time || "（未設定）"} → *${lendTime}*`);
    if (colPlace !== null) chLines.push(`📍 *回収先*　${r.col_place || "（未設定）"} → *${colPlace}*`);
    if (returnTime !== null) chLines.push(`🕐 *回収時間*　${r.return_time || "（未設定）"} → *${returnTime}*`);
    await notifySlackCard({ emoji: "✏️", title: "マイページで変更（即時反映済）", name: r.name, resId, ota: r.ota, period: `${r.lend_date}〜${r.return_date}`, vehicle: r.vehicle, lines: chLines, action: "✅ OPシートに反映済み・*対応不要*（内容をご確認ください／🕘履歴にも記録）" });
    return json({ ok: true, updated: labels }, 200, origin);
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
    if (reqType === "option" && pastOptionDeadline(r.lend_date))
      return json({ error: "オプション（シート類）の受付は貸出前日の19:00までです。以降は公式LINEにて承ります", lineOnly: true }, 409, origin);
    if (reqType === "insurance" && pastInsDeadline(r.lend_date, r.lend_time || r.del_time || ""))
      return json({ error: "補償プランの変更は貸出前まで（貸出開始後は変更できません）。公式LINEにてご相談ください", lineOnly: true }, 409, origin);
    if (reqType === "method" && withinHours(r.lend_date, r.lend_time || r.del_time || "", 2))
      return json({ error: "出発の2時間前を過ぎているため、変更のご依頼は公式LINEにて承ります", lineOnly: true }, 409, origin);
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
    await notifySlackCard({ emoji: "🟢", title: "早め回収OK（返却準備完了）", name: r.name, resId, ota: r.ota, period: `${r.lend_date}〜${r.return_date}`, vehicle: r.vehicle, lines: [`🕐 *予定回収*　${r.return_time || r.col_time || "-"}`, `🕒 *お客様の希望*　${rdyTime ? `*${rdyTime}〜*` : "指定なし"}`], action: "💡 スケジュールに余裕があれば早めに回収をご検討ください（お客様には「確認中」と表示中）" });
    return json({ ok: true, requested: true }, 200, origin);
  }

  return json({ error: "unknown action" }, 400, origin);
});
