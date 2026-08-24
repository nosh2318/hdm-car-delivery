// 代車リクエスト（KEYDROP札幌・提案/チャット型）
// お客様: create(リクエスト作成) / thread(スレッド取得) / send(メッセージ送信)
// スタッフ: staff_list / staff_thread / staff_send / staff_status（本体ログインJWTで認証）
// メール不要・トークン(=request id uuid)でチャット継続＝離脱回避。
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const SLACK_CH_SPK = Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36"; // #sapporo_reservation
const SLACK_CH_NHA = Deno.env.get("SLACK_KEYDROP_CHANNEL_NAHA") || "C06KZ56NTDF"; // #okinawa_reservation_notification
const chOf = (store: string) => (store === "nha" ? SLACK_CH_NHA : SLACK_CH_SPK);

function cors(o: string | null) {
  return {
    "Access-Control-Allow-Origin": o || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization",
  };
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
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { console.error(`INSERT ${table}:`, await r.text()); return null; }
  const d = await r.json().catch(() => []);
  return Array.isArray(d) ? d[0] : d;
}
async function sbPatch(table: string, query: string, body: unknown): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function slack(channel: string, text: string, blocks?: unknown) {
  if (!SLACK_TOKEN) return;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, blocks }),
    });
  } catch (e) { console.error("slack", String(e)); }
}
async function verifyStaff(token: string): Promise<boolean> {
  if (!token) return false;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  return r.ok;
}
const S = (v: unknown) => String(v ?? "").trim().slice(0, 2000);
const UC: Record<string, string> = { accident: "事故の代車", repair: "車検・修理の代車", long: "長期のご利用", other: "その他" };

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  let p: any = {};
  try { p = await req.json(); } catch { return json({ error: "invalid json" }, 400, origin); }
  const action = String(p.action || "");

  // ─── お客様: リクエスト作成 ───
  if (action === "create") {
    const name = S(p.name);
    if (!name) return json({ error: "お名前を入力してください" }, 400, origin);
    if (!S(p.tel) && !S(p.email)) return json({ error: "電話番号かメールのいずれかを入力してください" }, 400, origin);
    if (!S(p.choice1)) return json({ error: "第1希望の車両を選択してください" }, 400, origin);
    const store = S(p.store) === "nha" ? "nha" : "spk";
    const row = await sbInsert("daisha_requests", {
      store,
      use_case: S(p.use_case), start_date: S(p.start_date), end_date: S(p.end_date), period_note: S(p.period_note),
      del_place: S(p.del_place), col_place: S(p.col_place), same_col: p.same_col !== false,
      cust_type: S(p.cust_type) || "individual", company: S(p.company),
      name, tel: S(p.tel), email: S(p.email),
      choice1: S(p.choice1), choice2: S(p.choice2), choice3: S(p.choice3), memo: S(p.memo),
    });
    if (!row) return json({ error: "保存に失敗しました。時間をおいて再度お試しください" }, 500, origin);
    // 初回のシステムメッセージ（チャットの起点）
    await sbInsert("daisha_messages", { request_id: row.id, sender: "system", body: "代車のリクエストを受け付けました。担当が在庫を確認し、実際にお出しできる車両をこのチャットでご提案します。少々お待ちください。", read_by_staff: true });
    // スタッフへSlack通知（カード）
    const period = row.start_date ? `${row.start_date}〜${row.end_date || "未定"}${row.period_note ? `（${row.period_note}）` : ""}` : (row.period_note || "未定");
    const choices = [row.choice1, row.choice2, row.choice3].filter(Boolean).map((c: string, i: number) => `第${i + 1}希望：${c}`).join(" / ");
    const areaJp = store === "nha" ? "那覇" : "札幌";
    await slack(chOf(store), `🚗 代車リクエスト［${areaJp}］ ${name}様`, [
      { type: "header", text: { type: "plain_text", text: `🚗 代車リクエスト（${areaJp}・要提案）`, emoji: true } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*お客様*\n${name}様${row.company ? `（${row.company}）` : ""}` },
        { type: "mrkdwn", text: `*区分*\n${row.cust_type === "business" ? "事業者" : "個人"}` },
        { type: "mrkdwn", text: `*用途*\n${UC[row.use_case] || row.use_case || "-"}` },
        { type: "mrkdwn", text: `*希望期間*\n${period}` },
        { type: "mrkdwn", text: `*お届け先*\n${row.del_place || "-"}` },
        { type: "mrkdwn", text: `*回収先*\n${row.same_col ? "お届けと同じ" : (row.col_place || "-")}` },
      ] },
      { type: "section", text: { type: "mrkdwn", text: `*車両ご希望*\n${choices || "-"}${row.memo ? `\n*メモ*\n${row.memo}` : ""}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `📞 ${row.tel || "-"} ／ ✉️ ${row.email || "-"}` }] },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "🔧 このリクエストに回答する", emoji: true }, url: `https://keydrop.jp/daisha-admin.html?id=${row.id}&store=${store}`, style: "primary" }] },
      { type: "divider" },
    ]);
    return json({ ok: true, token: row.id }, 200, origin);
  }

  // ─── お客様: スレッド取得 ───
  if (action === "thread") {
    const token = S(p.token);
    if (!token) return json({ error: "token" }, 400, origin);
    const rows = await sbGet("daisha_requests", `id=eq.${token}&limit=1`);
    if (!rows.length) return json({ error: "not_found" }, 404, origin);
    const msgs = await sbGet("daisha_messages", `request_id=eq.${token}&order=id.asc&limit=500`);
    await sbPatch("daisha_messages", `request_id=eq.${token}&sender=eq.staff&read_by_customer=eq.false`, { read_by_customer: true });
    const r = rows[0];
    return json({ ok: true, request: {
      name: r.name, use_case: UC[r.use_case] || r.use_case, period: r.start_date ? `${r.start_date}〜${r.end_date || "未定"}` : (r.period_note || ""),
      del_place: r.del_place, col_place: r.same_col ? r.del_place : r.col_place, status: r.status, created_at: r.created_at,
      choices: [r.choice1, r.choice2, r.choice3].filter(Boolean),
    }, messages: msgs.map((m: any) => ({ sender: m.sender, body: m.body, at: m.created_at })) }, 200, origin);
  }

  // ─── お客様: メッセージ送信 ───
  if (action === "send") {
    const token = S(p.token), body = S(p.body);
    if (!token || !body) return json({ error: "empty" }, 400, origin);
    const rows = await sbGet("daisha_requests", `id=eq.${token}&select=id,name,store&limit=1`);
    if (!rows.length) return json({ error: "not_found" }, 404, origin);
    await sbInsert("daisha_messages", { request_id: token, sender: "customer", body });
    const areaJp = rows[0].store === "nha" ? "那覇" : "札幌";
    await slack(chOf(rows[0].store), `💬 代車チャット新着［${areaJp}・${rows[0].name}様］\n${body}\n→ <https://keydrop.jp/daisha-admin.html?id=${token}&store=${rows[0].store}|このチャットを開いて返信する>`);
    return json({ ok: true }, 200, origin);
  }

  // ─── スタッフ: 一覧 ───
  if (action === "staff_list") {
    if (!(await verifyStaff(S(p.staff_token)))) return json({ error: "unauthorized" }, 401, origin);
    const st = S(p.store);
    const filter = st === "spk" || st === "nha" ? `store=eq.${st}&` : "";
    const rows = await sbGet("daisha_requests", `${filter}order=created_at.desc&limit=300`);
    return json({ ok: true, list: rows }, 200, origin);
  }
  // ─── スタッフ: スレッド取得 ───
  if (action === "staff_thread") {
    if (!(await verifyStaff(S(p.staff_token)))) return json({ error: "unauthorized" }, 401, origin);
    const id = S(p.id);
    const rows = await sbGet("daisha_requests", `id=eq.${id}&limit=1`);
    if (!rows.length) return json({ error: "not_found" }, 404, origin);
    const msgs = await sbGet("daisha_messages", `request_id=eq.${id}&order=id.asc&limit=500`);
    await sbPatch("daisha_messages", `request_id=eq.${id}&sender=eq.customer&read_by_staff=eq.false`, { read_by_staff: true });
    return json({ ok: true, request: rows[0], messages: msgs }, 200, origin);
  }
  // ─── スタッフ: 送信（提案） ───
  if (action === "staff_send") {
    if (!(await verifyStaff(S(p.staff_token)))) return json({ error: "unauthorized" }, 401, origin);
    const id = S(p.id), body = S(p.body);
    if (!id || !body) return json({ error: "empty" }, 400, origin);
    await sbInsert("daisha_messages", { request_id: id, sender: "staff", body, read_by_customer: false });
    if (S(p.status)) await sbPatch("daisha_requests", `id=eq.${id}`, { status: S(p.status) });
    return json({ ok: true }, 200, origin);
  }
  // ─── スタッフ: ステータス更新 ───
  if (action === "staff_status") {
    if (!(await verifyStaff(S(p.staff_token)))) return json({ error: "unauthorized" }, 401, origin);
    await sbPatch("daisha_requests", `id=eq.${S(p.id)}`, { status: S(p.status), staff_note: S(p.staff_note) });
    return json({ ok: true }, 200, origin);
  }

  // ─── 代車割引率：取得（誰でも可）───
  if (action === "get_discount") {
    const spk = await sbGet("app_settings", "key=eq.hdm_keydrop_daisha&select=value&limit=1");
    const nha = await sbGet("nha_app_settings", "key=eq.hdm_keydrop_daisha&select=value&limit=1");
    const parse = (rows: any[]) => { try { const v = rows[0]?.value; const o = typeof v === "string" ? JSON.parse(v) : v; return +((o && o.discount_pct) || 0) || 0; } catch { return 0; } };
    return json({ ok: true, spk: parse(spk), nha: parse(nha) }, 200, origin);
  }
  // ─── 代車割引率：保存（スタッフ認証）───
  if (action === "set_discount") {
    if (!(await verifyStaff(S(p.staff_token)))) return json({ error: "unauthorized" }, 401, origin);
    const store = S(p.store) === "nha" ? "nha" : "spk";
    const pct = Math.max(0, Math.min(90, Math.round(Number(p.pct) || 0)));
    const tbl = store === "nha" ? "nha_app_settings" : "app_settings";
    const val = JSON.stringify({ discount_pct: pct });
    const r = await fetch(`${SB_URL}/rest/v1/${tbl}?on_conflict=key`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: "hdm_keydrop_daisha", value: val }),
    });
    if (!r.ok) { console.error("set_discount", await r.text()); return json({ error: "保存に失敗しました" }, 500, origin); }
    return json({ ok: true, store, pct }, 200, origin);
  }

  return json({ error: "unknown action" }, 400, origin);
});
