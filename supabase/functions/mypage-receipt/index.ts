// mypage-receipt : マイページから領収書PDFを発行する（2026-11-08 nosh「本番に入れてOK」・HDM 那覇/札幌/高松 共通）
// 決まり（nosh 11/8）：じゃらん・公式サイトの予約だけ／お支払い済みだけ／お客様が入れるのは宛名だけ（金額・但し書きは予約データで固定）
//   発行は1予約1回。2回目以降は同じ番号・同じ内容のPDFを再表示するだけ。宛名などの修正は運営へ依頼 → スタッフが出し直す（古い番号は無効）。
// POST {action:"status", store:"nha"|"spk"|"tkm", token}            → {ok, eligible, reason, amount, receipt:{no,addressee,issued_at}|null}
// POST {action:"issue",  store, token, addressee}                    → {ok, receipt}（すでに発行済みなら 409 と既存の receipt）
// POST {action:"pdf",    store, token}                               → application/pdf（発行済みの内容を再表示）
// POST {action:"admin_reissue", pin, store, reservation_id, addressee, reason} → 古い番号を無効にして出し直す（スタッフ用）
// POST {action:"admin_list", pin, store?, reservation_id?}           → 発行の記録
// 表 public.mypage_receipts（service_role のみ）。PDF は pdf-lib + IPAゴシック（spk-task の GitHub Pages に置いたフォント）。
// deploy: functions deploy mypage-receipt --no-verify-jwt（secrets は既存の BT_URL / BT_SERVICE_KEY / SLACK_BOT_TOKEN / ADMIN_PIN を使う）
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

function __newKey(env: string, name: string): string { try { return (JSON.parse(Deno.env.get(env) || "{}") as Record<string, string>)[name] || ""; } catch { return ""; } }
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = (__newKey("SUPABASE_SECRET_KEYS", "edge") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };
const BT_URL = Deno.env.get("BT_URL") || "", BT_KEY = Deno.env.get("BT_SERVICE_KEY") || "";
const BH = { apikey: BT_KEY, Authorization: `Bearer ${BT_KEY}`, "content-type": "application/json" };
const ADMIN_PIN = Deno.env.get("ADMIN_PIN") || "";
const FONT_URL = Deno.env.get("RECEIPT_FONT_URL") || "https://nosh2318.github.io/spk-task/fonts/ipag.ttf";
const TNO = Deno.env.get("RECEIPT_TNO") || ""; // インボイス登録番号（T＋13桁）。未設定なら行ごと出さない
const ALLOWED = ["https://nosh2318.github.io", "https://rent-handyman.com", "https://hdm-rentacar.jp"];
function cors(o: string | null) {
  const allow = o && ALLOWED.includes(o) ? o : ALLOWED[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Access-Control-Expose-Headers": "content-disposition", "Vary": "Origin" };
}
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "content-type": "application/json" } });

const STORE_JP: Record<string, string> = { nha: "HANDYMAN 那覇空港店", spk: "HANDYMAN 札幌店", tkm: "HANDYMAN 高松空港店" };
const PREFIX: Record<string, string> = { nha: "NHA", spk: "SPK", tkm: "TKM" };
const SLACK_CH: Record<string, string> = { spk: Deno.env.get("SLACK_MYPAGE_CHANNEL") || "C0BER0YC6AK", nha: Deno.env.get("SLACK_NHA_USER_CHANNEL") || "C06L91W6T08", tkm: Deno.env.get("SLACK_TKM_CHANNEL") || "C0BFMBLEJGZ" };

type Info = { found: boolean; rid?: string; eligible?: boolean; reason?: string; amount?: number; detail?: Record<string, string>; name?: string };

const isCancel = (s: unknown) => /cancel|キャンセル/i.test(String(s || ""));
const hm = (t: unknown) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""; };
function jpDate(d: unknown) { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[1]}年${+m[2]}月${+m[3]}日` : ""; }
function jpDateTs(ts: unknown) { if (!ts) return ""; const t = new Date(String(ts)); if (isNaN(+t)) return ""; const j = new Date(+t + 9 * 3600e3); return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月${j.getUTCDate()}日`; }
function period(sd: unknown, st: unknown, ed: unknown, et: unknown) {
  const a = jpDate(sd), b = jpDate(ed); if (!a) return "";
  const sameY = String(sd).slice(0, 4) === String(ed).slice(0, 4);
  return `${a}${hm(st) ? " " + hm(st) : ""} 〜 ${b ? (sameY ? b.replace(/^\d{4}年/, "") : b) : ""}${hm(et) ? " " + hm(et) : ""}`;
}
const otaJP = (o: string, id: string) => /^(J|じゃらん)$/.test(o) ? "じゃらん" : (/^HANDYMAN$/i.test(o) || /^HDM/.test(id)) ? "公式サイト" : o;

async function getRows(url: string, h: Record<string, string>): Promise<any[]> { const r = await fetch(url, { headers: h }); return r.ok ? await r.json() : []; }

// 予約・支払いから「発行できるか」と金額を決める（金額はお支払い済みの額。じゃらんはポイント等を引いた決済額）
async function info(store: string, token: string): Promise<Info> {
  if (store === "tkm") {
    if (!BT_URL || !BT_KEY) return { found: false };
    const v = (await getRows(`${BT_URL}/rest/v1/bt_reservations?mypage_token=eq.${encodeURIComponent(token)}&select=id,name,ota,status,start_date,start_time,end_date,end_time,vehicle_class,price,payment,paid,booked_at,created_at&limit=1`, BH))[0];
    if (!v) return { found: false };
    const id = String(v.id), ota = String(v.ota || ""), pm = String(v.payment || "");
    const base = { found: true, rid: id, name: v.name, detail: { rid: `${id}（${otaJP(ota, id)}）`, period: period(v.start_date, v.start_time, v.end_date, v.end_time), car: String(v.vehicle_class || "") } as Record<string, string> };
    if (isCancel(v.status)) return { ...base, eligible: false, reason: "cancel" };
    if (/じゃらん|^J$/.test(ota)) {
      if (/現地/.test(pm)) return { ...base, eligible: false, reason: "onsite" };
      const jp = (await getRows(`${BT_URL}/rest/v1/bt_jalan_payments?reservation_id=eq.${encodeURIComponent(id)}&select=amount,status,paid_at&order=created_at.desc&limit=1`, BH))[0];
      if (jp && jp.status === "paid" && Number(jp.amount) > 0) return { ...base, eligible: true, amount: Number(jp.amount), detail: { ...base.detail, method: "クレジットカード（オンライン決済）", paid: jpDateTs(jp.paid_at) } };
      if (/支払済/.test(pm) && Number(v.price) > 0) return { ...base, eligible: true, amount: Number(v.price), detail: { ...base.detail, method: "クレジットカード（事前決済）", paid: "" } };
      return { ...base, eligible: false, reason: "unpaid" };
    }
    if (/^HANDYMAN$/i.test(ota) || /^HDM/.test(id)) {
      if (/現地/.test(pm)) return { ...base, eligible: false, reason: "onsite" };
      if (Number(v.price) > 0) return { ...base, eligible: true, amount: Number(v.price), detail: { ...base.detail, method: "クレジットカード（公式サイト決済）", paid: jpDateTs(v.booked_at || v.created_at) } };
      return { ...base, eligible: false, reason: "unpaid" };
    }
    return { ...base, eligible: false, reason: "other_site" };
  }
  const T = store === "nha" ? "nha_reservations" : "reservations";
  const sel = store === "nha" ? "id,name,ota,status,start_date,start_time,end_date,end_time,vehicle_class,price,booked_at,created_at" : "id,name,ota,status,lend_date,lend_time,return_date,return_time,vehicle,price,created_at";
  const v = (await getRows(`${SB_URL}/rest/v1/${T}?mypage_token=eq.${encodeURIComponent(token)}&select=${sel}&limit=1`, H))[0];
  if (!v) return { found: false };
  const id = String(v.id), ota = String(v.ota || "");
  const per = store === "nha" ? period(v.start_date, v.start_time, v.end_date, v.end_time) : period(v.lend_date, v.lend_time, v.return_date, v.return_time);
  const base = { found: true, rid: id, name: v.name, detail: { rid: `${id}（${otaJP(ota, id)}）`, period: per, car: String((store === "nha" ? v.vehicle_class : v.vehicle) || "") } as Record<string, string> };
  if (isCancel(v.status)) return { ...base, eligible: false, reason: "cancel" };
  let amt = 0, method = "", paid = "";
  if (ota === "J") {
    const JT = store === "nha" ? "nha_jalan_payments" : "jalan_payments";
    const jp = (await getRows(`${SB_URL}/rest/v1/${JT}?reservation_id=eq.${encodeURIComponent(id)}&select=amount,status,paid_at&order=created_at.desc&limit=1`, H))[0];
    if (!jp) return { ...base, eligible: false, reason: "unpaid" };
    if (jp.status === "local_payment") return { ...base, eligible: false, reason: "onsite" };
    if (jp.status !== "paid" || !(Number(jp.amount) > 0)) return { ...base, eligible: false, reason: "unpaid" };
    amt = Number(jp.amount); method = "クレジットカード（オンライン決済）"; paid = jpDateTs(jp.paid_at);
  } else if (ota === "HANDYMAN" || /^HDM/.test(id)) {
    if (!(Number(v.price) > 0)) return { ...base, eligible: false, reason: "unpaid" };
    amt = Number(v.price); method = "クレジットカード（公式サイト決済）"; paid = jpDateTs(v.booked_at || v.created_at);
  } else return { ...base, eligible: false, reason: "other_site" };
  // マイページの変更で発生した追加料金：未払いが残っていれば発行しない（金額が確定していない）。支払い済みは足す
  const ex = await getRows(`${SB_URL}/rest/v1/mypage_extra_payments?store=eq.${store}&reservation_id=eq.${encodeURIComponent(id)}&select=amount,status,direction`, H);
  for (const x of ex) {
    if (x.status === "cancelled") continue;
    const refund = String(x.direction || "charge") === "refund";
    if (!refund && x.status !== "paid") return { ...base, eligible: false, reason: "unpaid" };
    if (x.status === "paid" || (refund && /refund/.test(String(x.status)))) amt += (refund ? -1 : 1) * (Number(x.amount) || 0);
  }
  return { ...base, eligible: amt > 0, reason: amt > 0 ? undefined : "unpaid", amount: amt, detail: { ...base.detail, method, paid } };
}

function honorific(name: string) {
  return /(株式会社|有限会社|合同会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|医療法人|社会福祉法人|学校法人|宗教法人|協同組合|Inc\.|LLC|Ltd\.|Corp\.|御中)/.test(name) ? "御中" : "様";
}
function cleanName(s: unknown) { return String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").replace(/\s*(様|御中)\s*$/, "").trim().slice(0, 40); }

let FONT: Uint8Array | null = null;
async function font(): Promise<Uint8Array> { if (!FONT) { const r = await fetch(FONT_URL); if (!r.ok) throw new Error("font " + r.status); FONT = new Uint8Array(await r.arrayBuffer()); } return FONT; }

// 見本（nosh OK 11/8）と同じ並び：題・番号/発行日・宛名・金額・但し書き・内訳・ご利用内容・発行元・注意書き
async function renderPDF(rc: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const f = await doc.embedFont(await font(), { subset: true });
  doc.setTitle(`領収書 No.${rc.receipt_no}`); doc.setAuthor("株式会社グローバルラインズ"); doc.setCreator("HANDYMAN マイページ");
  const W = 595.28, Hh = 841.89, L = 50, R = W - 50; const p = doc.addPage([W, Hh]);
  const ink = rgb(0.1, 0.1, 0.1), gray = rgb(0.4, 0.4, 0.4), line = rgb(0.8, 0.8, 0.8), red = rgb(0.75, 0, 0);
  const tx = (s: string, x: number, y: number, size: number, color = ink) => p.drawText(s, { x, y, size, font: f, color });
  const tw = (s: string, size: number) => f.widthOfTextAtSize(s, size);
  const rt = (s: string, x: number, y: number, size: number, color = gray) => tx(s, x - tw(s, size), y, size, color);
  const ct = (s: string, x: number, y: number, size: number, color = ink) => tx(s, x - tw(s, size) / 2, y, size, color);
  const top = (y: number) => Hh - y;
  if (rc.reissue_of) tx(`再発行（No.${rc.reissue_of} は無効）`, L, top(40), 10, red);
  ct("領 収 書", W / 2, top(90), 30);
  rt(`No. ${rc.receipt_no}`, R, top(125), 9.5); rt(`発行日 ${jpDateTs(rc.issued_at)}`, R, top(140), 9.5);
  let nm = rc.addressee as string, ns = 18; while (tw(nm, ns) > 270 && ns > 10) ns -= 1;
  tx(nm, L, top(185), ns); tx(rc.honorific, L + 280, top(185), 14);
  p.drawLine({ start: { x: L, y: top(192) }, end: { x: L + 310, y: top(192) }, thickness: 1, color: ink });
  p.drawRectangle({ x: L, y: top(280), width: R - L, height: 56, color: rgb(0.953, 0.965, 0.98) });
  tx("金額", L + 16, top(258), 12); ct(`¥ ${Number(rc.amount).toLocaleString("ja-JP")} −`, W / 2 + 20, top(262), 28); rt("（税込）", R - 12, top(272), 9.5, ink);
  tx(`但し　${rc.purpose}`, L, top(305), 11); tx("上記正に領収いたしました。", L, top(325), 11);
  tx(`内訳　10%対象 ¥${Number(rc.amount).toLocaleString("ja-JP")}（うち消費税 ¥${Number(rc.tax).toLocaleString("ja-JP")}）`, L, top(345), 9.5, gray);
  let y = 385; tx("ご利用内容", L, top(y), 11); y += 8; p.drawLine({ start: { x: L, y: top(y) }, end: { x: R, y: top(y) }, thickness: 0.7, color: line });
  const d = rc.detail || {};
  const rows: [string, string][] = [["予約番号", d.rid], ["店舗", STORE_JP[rc.store] || ""], ["ご利用期間", d.period], ["車両クラス", d.car], ["お支払い方法", d.method], ["お支払い日", d.paid]];
  for (const [k, v] of rows) { if (!v) continue; y += 20; tx(k, L + 4, top(y), 10, gray); let s = String(v), z = 10; while (tw(s, z) > R - L - 115 && z > 7) z -= 0.5; tx(s, L + 110, top(y), z); p.drawLine({ start: { x: L, y: top(y + 7) }, end: { x: R, y: top(y + 7) }, thickness: 0.7, color: line }); }
  y += 55; tx("発行元", L, top(y), 11); tx("株式会社グローバルラインズ", L, top(y + 22), 13);
  const iss = ["HANDYMAN RENTCAR", "〒901-0223 沖縄県豊見城市翁長854-1 MEGAドン・キホーテ豊見城店内6F", "TEL 050-1724-6197"]; if (TNO) iss.push(`登録番号 ${TNO}`);
  iss.forEach((s, i) => tx(s, L, top(y + 40 + i * 15), 9.5, gray));
  p.drawCircle({ x: R - 55, y: top(y + 45), size: 30, borderColor: red, borderWidth: 1.5 });
  ct("グローバル", R - 55, top(y + 42), 9, red); ct("ラインズ", R - 55, top(y + 54), 9, red);
  tx("※ 本領収書はマイページから電子発行されたものです（電子発行のため収入印紙は不要です）。", L, 70, 8.5, gray);
  tx("※ 発行は1回限りです。宛名・内容の修正はマイページの「運営に依頼」からお申し付けください。", L, 56, 8.5, gray);
  tx("※ 同じ番号の領収書はマイページから再表示できます（内容は変わりません）。", L, 42, 8.5, gray);
  return await doc.save();
}

async function current(store: string, rid: string) {
  return (await getRows(`${SB_URL}/rest/v1/mypage_receipts?store=eq.${store}&reservation_id=eq.${encodeURIComponent(rid)}&status=eq.issued&select=*&limit=1`, H))[0] || null;
}
const pub = (rc: any) => rc ? { no: rc.receipt_no, addressee: rc.addressee, honorific: rc.honorific, amount: rc.amount, issued_at: rc.issued_at, reissue_of: rc.reissue_of || null } : null;

async function insertReceipt(store: string, inf: Info, addressee: string, by: string, reissueOf: string | null): Promise<any> {
  const amount = inf.amount!; const tax = Math.floor(amount * 10 / 110);
  const row = { store, reservation_id: inf.rid, addressee, honorific: honorific(addressee), amount, tax, purpose: "レンタカーご利用料金として", detail: inf.detail, issued_by: by, reissue_of: reissueOf };
  const r = await fetch(`${SB_URL}/rest/v1/mypage_receipts`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!r.ok) { const t = await r.text(); if (/duplicate|unique/i.test(t)) return { dup: true }; throw new Error("insert " + r.status + " " + t); }
  return (await r.json())[0]; // receipt_no は DB が id から作る（NHA-000001 など）
}

async function slack(store: string, text: string) {
  try {
    if (store === "tkm") { await fetch(`${SB_URL}/rest/v1/rpc/mpremind_slack_post_buddica`, { method: "POST", headers: H, body: JSON.stringify({ p_channel: SLACK_CH.tkm, p_text: text }) }); return; }
    const token = Deno.env.get("SLACK_BOT_TOKEN"); if (!token) return;
    await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: SLACK_CH[store], text }) });
  } catch (e) { console.error("[slack]", String(e)); }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  let p: any;
  if (req.method === "GET") { // 「領収書を開く」リンク用（LINEのブラウザでもPDFがそのまま開くように GET で受ける）。pdf だけ
    const q = new URL(req.url).searchParams; p = { action: "pdf", store: q.get("store"), token: q.get("token") };
  } else if (req.method === "POST") { try { p = await req.json(); } catch { return json({ error: "bad json" }, 400, origin); } }
  else return json({ error: "POST only" }, 405, origin);
  const action = String(p.action || "status"), store = String(p.store || "");
  if (!STORE_JP[store]) return json({ error: "store不正" }, 400, origin);
  try {
    if (action === "admin_list" || action === "admin_reissue") {
      if (!ADMIN_PIN || String(p.pin || "") !== ADMIN_PIN) return json({ error: "PINが違います" }, 401, origin);
      const rid = String(p.reservation_id || "").trim();
      if (action === "admin_list") return json({ ok: true, list: await getRows(`${SB_URL}/rest/v1/mypage_receipts?store=eq.${store}${rid ? `&reservation_id=eq.${encodeURIComponent(rid)}` : ""}&select=receipt_no,reservation_id,addressee,amount,status,issued_at,issued_by,reissue_of,void_reason&order=id.desc&limit=100`, H) }, 200, origin);
      const old = await current(store, rid); if (!old) return json({ error: "この予約の領収書はまだ発行されていません" }, 404, origin);
      const addressee = cleanName(p.addressee) || old.addressee;
      await fetch(`${SB_URL}/rest/v1/mypage_receipts?id=eq.${old.id}&status=eq.issued`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "void", voided_at: new Date().toISOString(), void_reason: String(p.reason || "修正依頼").slice(0, 200) }) });
      const rc = await insertReceipt(store, { found: true, rid, amount: Number(p.amount) > 0 ? Number(p.amount) : old.amount, detail: old.detail }, addressee, "staff", old.receipt_no);
      return json({ ok: true, receipt: pub(rc) }, 200, origin);
    }
    const token = String(p.token || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "アクセスキーが不正です" }, 400, origin);
    const inf = await info(store, token);
    if (!inf.found) return json({ error: "予約が見つかりません" }, 404, origin);
    const have = await current(store, inf.rid!);
    if (action === "status") return json({ ok: true, eligible: !!inf.eligible, reason: inf.reason || null, amount: inf.amount ?? null, receipt: pub(have) }, 200, origin);
    if (action === "pdf") {
      if (!have) return json({ error: "まだ発行されていません" }, 404, origin);
      const pdf = await renderPDF(have);
      fetch(`${SB_URL}/rest/v1/rpc/mypage_receipt_viewed`, { method: "POST", headers: H, body: JSON.stringify({ p_id: have.id }) }).catch(() => {});
      return new Response(pdf, { status: 200, headers: { ...cors(origin), "content-type": "application/pdf", "content-disposition": `inline; filename="receipt_${have.receipt_no}.pdf"` } });
    }
    if (action === "issue") {
      if (have) return json({ error: "この予約の領収書は発行済みです。修正は運営へご依頼ください。", receipt: pub(have) }, 409, origin);
      if (!inf.eligible) return json({ error: "発行できません", reason: inf.reason }, 400, origin);
      const addressee = cleanName(p.addressee);
      if (!addressee) return json({ error: "宛名を入れてください" }, 400, origin);
      const rc = await insertReceipt(store, inf, addressee, "guest", null);
      if (rc.dup) return json({ error: "この予約の領収書は発行済みです。修正は運営へご依頼ください。", receipt: pub(await current(store, inf.rid!)) }, 409, origin);
      await slack(store, `🧾 マイページで領収書が発行されました（${STORE_JP[store].replace("HANDYMAN ", "HDM ")}）\nNo.${rc.receipt_no}・${inf.rid}・${rc.addressee} ${rc.honorific}・¥${Number(rc.amount).toLocaleString("ja-JP")}\n修正の依頼が来たら 👉 <https://nosh2318.github.io/spk-task/receipt-admin.html?store=${store}&rid=${encodeURIComponent(inf.rid!)}|出し直す>（古い番号は無効になります）`);
      return json({ ok: true, receipt: pub(rc) }, 200, origin);
    }
    return json({ error: "action不正" }, 400, origin);
  } catch (e) { console.error("[receipt]", String(e)); return json({ error: "処理に失敗しました" }, 500, origin); }
});
