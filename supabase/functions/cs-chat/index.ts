// CS チャット（マイページ⇄CS部 直接コミュニケーション）
// お客様: cust_open / cust_send / cust_poll（mypage_token で本人認証＝予約に自動紐付け）
// スタッフ: staff_list / staff_thread / staff_send（本体ログインJWTで認証）
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const CH = { spk: "C0BER0YC6AK", nha: "C06L91W6T08" } as Record<string, string>; // 札幌=#sapporo_user_action / 沖縄=#okinawa_operations-team
const RESV = { spk: "reservations", nha: "nha_reservations" } as Record<string, string>;
const ADMIN_URL = "https://nosh2318.github.io/spk-task/cs-chat-admin.html";

function cors(o: string | null) {
  return { "Access-Control-Allow-Origin": o || "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization" };
}
function json(b: unknown, s: number, o: string | null) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "content-type": "application/json" } });
}
async function sbGet(table: string, query: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) return [];
  return await r.json().catch(() => []);
}
async function sbInsert(table: string, body: unknown): Promise<any | null> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) });
  if (!r.ok) { console.error(`INSERT ${table}:`, await r.text()); return null; }
  const d = await r.json().catch(() => []);
  return Array.isArray(d) ? d[0] : d;
}
async function sbPatch(table: string, query: string, body: unknown): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { method: "PATCH", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function sbRpc(fn: string, body: unknown): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.ok ? await r.json().catch(() => null) : null;
}
async function slack(channel: string, text: string, blocks?: unknown) {
  if (!SLACK_TOKEN || !channel) return;
  try { await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel, text, blocks }) }); }
  catch (e) { console.error("slack", String(e)); }
}
async function verifyStaff(token: string): Promise<boolean> {
  if (!token) return false;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  return r.ok;
}
const S = (v: unknown) => String(v ?? "").trim().slice(0, 4000);
const st = (s: string) => (s === "nha" ? "nha" : "spk");

// mypage_token → 予約(id,name) を解決
async function resolveResv(store: string, token: string): Promise<any | null> {
  if (!token) return null;
  const tbl = RESV[store]; if (!tbl) return null;
  const rows = await sbGet(tbl, `mypage_token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
  return rows[0] || null;
}
// 予約に対応するスレッドを取得（create=true の時だけ無ければ作成）。開いただけで空スレッドを作らない
async function getThread(store: string, resv: any, create = false): Promise<any | null> {
  const ex = await sbGet("cs_chat_threads", `store=eq.${store}&reservation_id=eq.${encodeURIComponent(resv.id)}&limit=1`);
  if (ex[0]) return ex[0];
  if (!create) return null;
  const row = await sbInsert("cs_chat_threads", { store, reservation_id: resv.id, source: "mypage", cust_name: resv.name || "", status: "open", unread_staff: 0, unread_cust: 0 });
  return row;
}
async function msgs(threadId: string): Promise<any[]> {
  return await sbGet("cs_chat_messages", `thread_id=eq.${threadId}&order=id.asc&select=id,sender,body,image_url,created_at`);
}
// 画像(dataURL)を cs-chat バケットにアップロード→公開URLを返す（失敗時null）
async function uploadImage(threadId: string, dataUrl: string): Promise<string | null> {
  try {
    const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/i.exec(dataUrl || "");
    if (!m) return null;
    const ext = m[2].toLowerCase() === "jpeg" ? "jpg" : m[2].toLowerCase();
    const bin = Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0));
    if (bin.length > 6_000_000) return null; // 6MB上限
    const path = `${threadId}/${Date.now()}.${ext}`;
    const r = await fetch(`${SB_URL}/storage/v1/object/cs-chat/${path}`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": m[1], "x-upsert": "true" },
      body: bin,
    });
    if (!r.ok) { console.error("upload", await r.text()); return null; }
    return `${SB_URL}/storage/v1/object/public/cs-chat/${path}`;
  } catch (e) { console.error("uploadImage", String(e)); return null; }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  let p: any = {};
  try { p = await req.json(); } catch { return json({ error: "invalid json" }, 400, origin); }
  const action = String(p.action || "");
  const store = st(S(p.store));

  // ── お客様: スレッドを開く（予約に自動紐付け） ──
  if (action === "cust_open" || action === "cust_poll") {
    const resv = await resolveResv(store, S(p.mypage_token));
    if (!resv) return json({ ok: false, error: "予約が見つかりません" }, 200, origin);
    const th = await getThread(store, resv); // create=false：開いただけで空スレッドを作らない
    if (!th) return json({ ok: true, thread_id: null, cust_name: resv.name || "", messages: [] }, 200, origin); // まだ会話なし
    await sbPatch("cs_chat_threads", `id=eq.${th.id}`, { unread_cust: 0 }); // お客様は既読
    return json({ ok: true, thread_id: th.id, cust_name: resv.name || "", messages: await msgs(th.id) }, 200, origin);
  }

  // ── お客様: メッセージ送信（画像可） ──
  if (action === "cust_send") {
    const body = S(p.body); const hasImg = typeof p.image === "string" && p.image.startsWith("data:image/");
    if (!body && !hasImg) return json({ ok: false, error: "メッセージを入力してください" }, 400, origin);
    const resv = await resolveResv(store, S(p.mypage_token));
    if (!resv) return json({ ok: false, error: "予約が見つかりません" }, 200, origin);
    const th = await getThread(store, resv, true); // 送信時のみスレッド作成
    if (!th) return json({ ok: false, error: "送信に失敗" }, 500, origin);
    const imgUrl = hasImg ? await uploadImage(th.id, p.image) : null;
    if (hasImg && !imgUrl) return json({ ok: false, error: "画像の送信に失敗しました" }, 200, origin);
    await sbInsert("cs_chat_messages", { thread_id: th.id, sender: "customer", body, image_url: imgUrl });
    const last = body ? body.slice(0, 120) : "📷 画像";
    await sbPatch("cs_chat_threads", `id=eq.${th.id}`, { unread_staff: (th.unread_staff || 0) + 1, unread_cust: 0, status: "open", work_status: "未対応", last_msg: last, last_msg_at: new Date().toISOString() });
    // ★初動＝スレッド最初のメッセージなら全店共通の定型文を自動返信（対応状況は「未対応」のまま＝スタッフの対応を促す）
    if ((await msgs(th.id)).length === 1) {
      await sbInsert("cs_chat_messages", { thread_id: th.id, sender: "staff", body: "ご連絡ありがとうございます！AI・HANDYMANが対応させていただきますので暫しお待ちください！", image_url: null });
    }
    const areaJp = store === "nha" ? "那覇" : "札幌";
    await slack(CH[store], `💬 CSチャット新着［${areaJp}］ ${resv.name || ""}様`, [
      { type: "header", text: { type: "plain_text", text: `💬 CSチャット新着（${areaJp}）`, emoji: true } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*お客様*\n${resv.name || "-"}様` },
        { type: "mrkdwn", text: `*予約番号*\n${resv.id}` },
        { type: "mrkdwn", text: `*ご予約元*\n${resv.ota || "-"}` },
        { type: "mrkdwn", text: `*車両*\n${resv.vehicle || resv.vehicle_class || "-"}` },
      ] },
      { type: "section", text: { type: "mrkdwn", text: `*内容*\n${body ? body.slice(0, 500) : "📷 画像が送信されました（管理画面でご確認ください）"}` } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "💬 このお客様に返信", emoji: true }, url: `${ADMIN_URL}?store=${store}&id=${th.id}`, style: "primary" }] },
      { type: "divider" },
    ]);
    return json({ ok: true, thread_id: th.id, messages: await msgs(th.id) }, 200, origin);
  }

  // ── スタッフ: 未対応スレッド一覧 ──
  if (action === "staff_list") {
    if (!await verifyStaff(S(p.staff_token))) return json({ ok: false, error: "認証が必要です" }, 401, origin);
    const scope = store; const onlyUnread = p.only_unread !== false;
    const box = S(p.box) || "active";
    const cols = "id,store,reservation_id,cust_name,unread_staff,last_msg,last_msg_at,status,work_status";
    // ★2026-09-06 完了BOX: 完了チャットは消さず別管理で見返せる（また連絡が来たら顧客送信で自動再オープン）
    if (box === "done") {
      const q = `store=eq.${scope}&work_status=eq.${encodeURIComponent("完了")}&order=last_msg_at.desc&select=${cols}&limit=300`;
      const list = await sbGet("cs_chat_threads", q);
      return json({ ok: true, threads: list, box: "done" }, 200, origin);
    }
    let q = `store=eq.${scope}&status=eq.open&order=last_msg_at.desc&select=${cols}&limit=200`;
    let list = await sbGet("cs_chat_threads", q);
    if (onlyUnread) list = list.filter((t: any) => t.work_status === "未対応" || t.work_status === "対応中");
    return json({ ok: true, threads: list, box: "active" }, 200, origin);
  }

  // ── スタッフ: スレッド取得（既読化＋予約詳細） ──
  if (action === "staff_thread") {
    if (!await verifyStaff(S(p.staff_token))) return json({ ok: false, error: "認証が必要です" }, 401, origin);
    const tid = S(p.thread_id); if (!tid) return json({ ok: false, error: "thread_id" }, 400, origin);
    const th = (await sbGet("cs_chat_threads", `id=eq.${tid}&limit=1`))[0];
    if (!th) return json({ ok: false, error: "スレッドが見つかりません" }, 200, origin);
    // ★開いただけでは「対応済」にしない（未対応のまま）。対応済はチェックボックス(staff_mark)のみ。
    let resv: any = null;
    if (th.reservation_id) { const rows = await sbGet(RESV[th.store], `id=eq.${encodeURIComponent(th.reservation_id)}&select=*&limit=1`); resv = rows[0] || null; }
    return json({ ok: true, thread: th, reservation: resv, messages: await msgs(tid) }, 200, origin);
  }

  // ── スタッフ: 返信送信 ──
  if (action === "staff_send") {
    if (!await verifyStaff(S(p.staff_token))) return json({ ok: false, error: "認証が必要です" }, 401, origin);
    const tid = S(p.thread_id); const body = S(p.body);
    const hasImg = typeof p.image === "string" && p.image.startsWith("data:image/");
    if (!tid || (!body && !hasImg)) return json({ ok: false, error: "内容が空です" }, 400, origin);
    const th = (await sbGet("cs_chat_threads", `id=eq.${tid}&limit=1`))[0];
    if (!th) return json({ ok: false, error: "スレッドが見つかりません" }, 200, origin);
    const imgUrl = hasImg ? await uploadImage(tid, p.image) : null;
    if (hasImg && !imgUrl) return json({ ok: false, error: "画像の送信に失敗しました" }, 200, origin);
    await sbInsert("cs_chat_messages", { thread_id: tid, sender: "staff", body, image_url: imgUrl });
    // ★返信しても自動で「対応済」にしない（未対応のまま・対応済はチェックボックスのみ）
    await sbPatch("cs_chat_threads", `id=eq.${tid}`, { unread_cust: (th.unread_cust || 0) + 1, last_msg: body ? body.slice(0, 120) : "📷 画像", last_msg_at: new Date().toISOString() });
    return json({ ok: true, messages: await msgs(tid) }, 200, origin);
  }

  // ── スタッフ: 対応ステータス設定（4状態: 未対応/対応中/対応済み/完了）──
  //   未対応・対応中＝アラート対象。完了＝スレッドをクローズ(一覧から外れる)。
  if (action === "staff_mark") {
    if (!await verifyStaff(S(p.staff_token))) return json({ ok: false, error: "認証が必要です" }, 401, origin);
    const tid = S(p.thread_id); if (!tid) return json({ ok: false, error: "thread_id" }, 400, origin);
    const VALID = ["未対応", "対応中", "完了"];
    let ws = S(p.work_status);
    if (!ws) ws = (p.handled !== false) ? "完了" : "未対応"; // 旧checkbox互換
    if (!VALID.includes(ws)) return json({ ok: false, error: "不正なステータス" }, 400, origin);
    const patch: any = { work_status: ws, unread_staff: ws === "未対応" ? 1 : 0, status: ws === "完了" ? "closed" : "open" };
    await sbPatch("cs_chat_threads", `id=eq.${tid}`, patch);
    return json({ ok: true, work_status: ws }, 200, origin);
  }

  // ── スタッフ: クローズ（=完了）──
  if (action === "staff_close") {
    if (!await verifyStaff(S(p.staff_token))) return json({ ok: false, error: "認証が必要です" }, 401, origin);
    const tid = S(p.thread_id); if (!tid) return json({ ok: false, error: "thread_id" }, 400, origin);
    await sbPatch("cs_chat_threads", `id=eq.${tid}`, { status: "closed", work_status: "完了", unread_staff: 0 });
    return json({ ok: true }, 200, origin);
  }

  return json({ error: "unknown action" }, 400, origin);
});
