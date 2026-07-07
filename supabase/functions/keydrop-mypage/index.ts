// ============================================================
// keydrop-mypage : 顧客のマイページ（予約確認・キャンセル）を安全に提供
// 2026-06-10 / omni
// ・anon に reservations を直READ/PATCH させない（PII漏洩・他人予約キャンセルを防止）
// ・本人確認＝「予約番号 + 登録メール」の両方一致を必須（片方だけでは何も返さない）
// ・service_role は Edge Function 内のみ
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// キャンセル依頼の運営通知は Slack を主とする。メールは「専用アドレスを設定した時だけ」送る。
// ⚠️ reserve@ を既定にしない（問い合わせ管理GASが reserve@ 受信箱を監視＝誤取込を避ける）。
// 設定する場合は Slackチャンネルのメール連携アドレス or 専用 ops@ を KEYDROP_OPS_EMAIL に入れる。未設定ならメールは送らずSlackのみ。
const OPS_EMAIL = (Deno.env.get("KEYDROP_OPS_EMAIL") || "").trim();

// 許可オリジン（KEYDROP公開元）。それ以外のブラウザからは弾く。
const ALLOWED = [
  "https://nosh2318.github.io",
  "https://keydrop.jp", // 独自ドメイン
];
function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json" },
  });
}

async function sbGet(table: string, query: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) { console.error(`GET ${table}: ${await r.text()}`); return []; }
  return await r.json();
}
async function sbPatch(table: string, query: string, body: unknown): Promise<boolean> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { console.error(`PATCH ${table}: ${await r.text()}`); return false; }
  const d = await r.json();
  return Array.isArray(d) && d.length > 0;
}
async function sbDelete(table: string, query: string): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
}
// 那覇OPシート(nha_tasks)は札幌(tasks)と別構造：_id=t番号 / 予約番号で紐付け / 内容(DEL/COL)で識別 / 日本語列(時間・送迎場所・返却)。
async function nhaPatchTasks(resId: string, del: any, col: any, marker?: string): Promise<void> {
  const q = encodeURIComponent("予約番号") + "=eq." + encodeURIComponent(resId) + "&select=_id," + encodeURIComponent("内容") + "," + encodeURIComponent("メモ");
  const tasks = await sbGet("nha_tasks", q);
  for (const t of tasks) {
    const naiyou = String(t["内容"] || "");
    const patch: Record<string, unknown> = {};
    if (naiyou === "DEL") {
      if (del?.time) patch["時間"] = del.time;
      if (del?.place) patch["送迎場所"] = del.place;
      if (col?.time) patch["返却"] = col.time; // DELタスクの返却参照
    } else if (naiyou === "COL") {
      if (col?.time) patch["時間"] = col.time;
      if (col?.place) patch["送迎場所"] = col.place;
    }
    // OPシート差別化マーカーをメモ列に書く（札幌と同様：🟡変更申請中／✅変更済）
    if (marker) {
      let m = String(t["メモ"] || "");
      if (marker.indexOf("変更済") >= 0) m = m.replace(/🟡変更申請中\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim(); // 承認時は申請中を消す
      if (!m.includes(marker)) m = m ? m + " " + marker : marker;
      patch["メモ"] = m;
    }
    if (Object.keys(patch).length) await sbPatch("nha_tasks", "_id=eq." + encodeURIComponent(String(t._id)), patch);
  }
}
async function nhaDeleteTasks(resId: string): Promise<void> {
  await sbDelete("nha_tasks", encodeURIComponent("予約番号") + "=eq." + encodeURIComponent(resId));
}
async function sbPost(table: string, body: unknown): Promise<void> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error(`POST ${table}: ${await r.text()}`);
}

// 運営へSlack通知（任意：環境変数が無ければスキップ＝変更自体は成立）
// SLACK_BOT_TOKEN + SLACK_KEYDROP_CHANNEL（既定 #sapporo_reservation=C08TDTPEB36）
async function notifySlack(text: string, channel?: string): Promise<void> {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  const ch = channel || Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36";
  if (!token || !ch) { console.log("[notifySlack] no token/ch (skip):", text); return; }
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: ch, text }),
    });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) console.error("[notifySlack] failed:", JSON.stringify(d));
  } catch (e) { console.error("[notifySlack] error:", String(e)); }
}

// ★ 店舗別テーブル/タスク/Slack/列マッピング。store指定が無ければ予約番号接頭辞 KDN- で那覇を推論。
//   SELECTはPostgRESTエイリアス(alias:col)で那覇の列名(start_*/vehicle_class)を札幌の項目名(lend_*/vehicle)へ揃える＝本体ロジック無改修。
//   時刻PATCHのみ正本列名が違う(lend_time→start_time / return_time→end_time)ので lendTimeCol/returnTimeCol で切替。
const STORE_MAP: Record<string, { resv: string; fleet: string; tasks: string; lendTimeCol: string; returnTimeCol: string; slackEnv: string; slackDefault: string; sel: string }> = {
  spk: { resv: "reservations", fleet: "fleet", tasks: "tasks", lendTimeCol: "lend_time", returnTimeCol: "return_time", slackEnv: "SLACK_KEYDROP_CHANNEL", slackDefault: "C08TDTPEB36",
    sel: "id,ota,vehicle,lend_date,return_date,lend_time,return_time,del_time,col_time,name,mail,tel,people,price,status,insurance,opt_b,opt_c,opt_j,opt_usb,del_place,col_place,del_lat,del_lng,col_lat,col_lng,kd_status,kd_track_token,coupon_code,discount" },
  nha: { resv: "nha_reservations", fleet: "nha_fleet", tasks: "nha_tasks", lendTimeCol: "start_time", returnTimeCol: "end_time", slackEnv: "SLACK_KEYDROP_CHANNEL_NAHA", slackDefault: "C06KZ56NTDF",
    sel: "id,ota,vehicle:vehicle_class,lend_date:start_date,return_date:end_date,lend_time:start_time,return_time:end_time,del_time,col_time,name,mail,tel,people,price,status,insurance,opt_b,opt_c,opt_j,opt_usb,del_place,col_place,del_lat,del_lng,col_lat,col_lng,kd_status,kd_track_token,coupon_code,discount" },
};
function mkStore(s: string) {
  const m = STORE_MAP[s];
  const slack = Deno.env.get(m.slackEnv) || m.slackDefault;
  return { store: s, ...m, slack };
}
function resolveStore(p: any, resId: string) {
  // 店舗は「予約番号の接頭辞」で確定する（KDN-=那覇 / KD-=札幌）。
  // 接頭辞が無い時のみ p.store を採用。これにより、那覇エリアからマイページを
  // 開いて store:'nha' が送られても、KD-（札幌）予約は札幌テーブルを正しく参照する。
  let s: string;
  if (/^KDN-/i.test(resId)) s = "nha";
  else if (/^KD-/i.test(resId)) s = "spk";
  else s = (p && p.store === "nha") ? "nha" : "spk";
  return mkStore(s);
}
function otherStoreKey(s: string) { return s === "nha" ? "spk" : "nha"; }

// 営業時間 9:00〜19:00・30分刻みのみ許可（不正値は弾く）
function validTime(s: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(":").map(Number);
  if (m !== 0 && m !== 30) return false;
  if (h < 9 || h > 19) return false;
  if (h === 19 && m !== 0) return false; // 19:00 が最終
  return true;
}
// JSTの「今」と日時文字列から、出発24時間前を過ぎているか判定
function within24h(lendDate: string, lendTime: string): boolean {
  const t = (validTime(lendTime) ? lendTime : "10:00");
  // 予約日時を JST(+09:00) として解釈
  const dep = new Date(`${lendDate}T${t}:00+09:00`).getTime();
  const now = Date.now();
  return now >= dep - 24 * 3600 * 1000;
}
// 指定日時(JST)まで何時間あるか（負＝過去）
function hoursUntil(date: string, time: string): number {
  const t = (validTime(time) ? time : "10:00");
  const target = new Date(`${date}T${t}:00+09:00`).getTime();
  return (target - Date.now()) / 3600000;
}

// ---- HANDYMANマイページ相当の表示解決（OPタスクから場所/時間を実値解決）----
function nowJst(): string { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " "); }
function parseCJ(t: any): any { let cj = t?.changed_json; if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch { cj = {}; } } return cj || {}; }
function resolveTaskPlace(t: any): string { if (!t) return ""; const cj = parseCJ(t); const place = String(t.place || ""); if (cj._placeSource === "manual") return place; return String(cj._ssPlace || place || ""); }
function resolveTaskTime(t: any): string { if (!t) return ""; const cj = parseCJ(t); return String(cj._timeChange || cj._ssTime || t.time || ""); }
function taskOptNum(t: any, k: string): number { if (!t) return 0; const cj = parseCJ(t); return Number(cj[k]) || 0; }

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);

  let p: any;
  try { p = await req.json(); } catch { return json({ error: "invalid json" }, 400, origin); }

  // --- スパム対策②：レート制限（予約番号+メールの総当たり探索を防止）---
  const _ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  try {
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent = await sbGet("keydrop_rate", `ip=eq.${encodeURIComponent(_ip)}&path=eq.mypage&created_at=gte.${encodeURIComponent(since)}&select=id`);
    if (recent.length >= 30) return json({ error: "アクセスが集中しています。しばらくしてから再度お試しください" }, 429, origin);
    await sbPost("keydrop_rate", { ip: _ip, path: "mypage" });
  } catch (e) { console.error("[rate]", e); }

  const action = String(p.action || "").trim();
  const mail = String(p.mail || "").trim().toLowerCase();
  // 予約番号は大文字に正規化（DBのid＝KD-/KDN-は大文字。小文字入力でもログイン可に）
  const resId0 = String(p.resId || p.reservationId || "").trim().toUpperCase();
  // 🔑 マイページURL用トークン（?t=<mypage_token>）。メールで本人にだけURLを送る＝URL所持＝本人（ログイン不要）
  const token = String(p.token || "").trim();

  let M: any, r: any, resId = resId0;

  if (token && /^[0-9a-fA-F-]{36}$/.test(token)) {
    // トークン認証：mypage_tokenで予約を特定（札幌→那覇の順で探索）。予約番号+メールは不要。
    for (const sk of ["spk", "nha"]) {
      const MM = mkStore(sk);
      const rr = await sbGet(MM.resv, `mypage_token=eq.${encodeURIComponent(token)}&select=${MM.sel}`).catch(() => []);
      if (rr[0]) { r = rr[0]; M = MM; resId = String(rr[0].id || "").toUpperCase(); break; }
    }
    if (!r) return json({ error: "マイページが見つかりません（URLをご確認ください）" }, 404, origin);
  } else {
    // 従来ログイン：予約番号 + メール（URLを紛失した人の救済入口）
    if (!mail || mail.indexOf("@") < 0) return json({ error: "メールアドレスが必要です" }, 400, origin);
    if (!resId) return json({ error: "予約番号が必要です" }, 400, origin);
    M = resolveStore(p, resId);
    const rows = await sbGet(M.resv, `id=eq.${encodeURIComponent(resId)}&select=${M.sel}`);
    r = rows[0];
    // 🛡 自己修復：解決した店舗で見つからなければ、もう一方の店舗も探す（本人確認はmail一致で担保）
    if (!r) {
      const oM = mkStore(otherStoreKey(M.store));
      const orows = await sbGet(oM.resv, `id=eq.${encodeURIComponent(resId)}&select=${oM.sel}`).catch(() => []);
      if (orows[0]) { r = orows[0]; M = oM; }
    }
    if (!r || String(r.mail || "").trim().toLowerCase() !== mail) {
      return json({ error: "予約番号またはメールアドレスが一致しません" }, 404, origin);
    }
  }

  if (action === "lookup") {
    const enc = encodeURIComponent(resId);
    // 傷チェック解禁：出発日8:00以降（KEYDROP札幌のみ vehicle_twins あり・best-effort）
    const todayJ = nowJst().slice(0, 10); const hhJ = +nowJst().slice(11, 13);
    const damageReady = (!!r.lend_date && (r.lend_date < todayJ || (r.lend_date === todayJ && hhJ >= 8)));
    const damageP: Promise<string | null> = (damageReady && M.store === "spk") ? (async () => {
      try {
        const fl = await sbGet(M.fleet, `reservation_id=eq.${enc}&select=vehicle_code`);
        const code = fl[0]?.vehicle_code; if (!code) return null;
        const vs = await sbGet("vehicles", `code=eq.${encodeURIComponent(code)}&select=plate_no`);
        const plate = vs[0]?.plate_no; if (!plate) return null;
        const tw = await sbGet("vehicle_twins", `display_label=ilike.*${encodeURIComponent(plate)}*&share_enabled=eq.true&select=share_token&limit=1`);
        return tw[0]?.share_token ? `https://nosh2318.github.io/handyman-damage/v.html?t=${tw[0].share_token}&v=v3` : null;
      } catch (_) { return null; }
    })() : Promise.resolve(null);
    const fleetP = sbGet(M.fleet, `reservation_id=eq.${enc}&select=vehicle_code`);
    const opTasksP = sbGet(M.tasks, `reservation_id=eq.${enc}&deleted=not.is.true&select=_id,place,time,insurance,changed_json`).catch(() => []);
    // 変更履歴＝KEYDROP独自ログ（keydrop_mypage_changes）＝HANDYMANの mypage_changes と切り分け
    const chgP = sbGet("keydrop_mypage_changes", `reservation_id=eq.${enc}&order=created_at.desc&limit=12&select=field,old_value,new_value,source,status,actor,created_at`).catch(() => []);
    const payP = sbGet("keydrop_payments", `reservation_id=eq.${enc}&select=cancel_requested_at,cancel_reason,change_req`).catch(() => []);
    const [damageUrl, fleet, opTasks, chg, pay] = await Promise.all([damageP, fleetP, opTasksP, chgP, payP]);
    const dTask = opTasks.find((t: any) => String(t._id || "").startsWith("d-"));
    const cTask = opTasks.find((t: any) => String(t._id || "").startsWith("c-"));
    const appliedChg = (field: string): string | null => { const c = chg.find((x: any) => x.field === field && x.status === "applied"); return c && String(c.new_value || "").trim() ? String(c.new_value).trim() : null; };
    const delPlaceR = appliedChg("del_place") ?? (resolveTaskPlace(dTask) || (r.del_place || ""));
    const colPlaceR = appliedChg("col_place") ?? (resolveTaskPlace(cTask) || (r.col_place || ""));
    const lendTimeR = appliedChg("lend_time") ?? (resolveTaskTime(dTask) || r.lend_time || r.del_time || "");
    const returnTimeR = appliedChg("return_time") ?? (resolveTaskTime(cTask) || r.return_time || r.col_time || "");
    const optBR = Math.max(Number(r.opt_b) || 0, taskOptNum(dTask, "_optB"), taskOptNum(cTask, "_optB"));
    const optCR = Math.max(Number(r.opt_c) || 0, taskOptNum(dTask, "_optC"), taskOptNum(cTask, "_optC"));
    const optJR = Math.max(Number(r.opt_j) || 0, taskOptNum(dTask, "_optJ"), taskOptNum(cTask, "_optJ"));
    const insR = String(r.insurance || "").trim() || String(dTask?.insurance || cTask?.insurance || "").trim();
    const pendingCancel = !!pay[0]?.cancel_requested_at || chg.some((c: any) => c.field === "cancel" && c.status === "requested");
    const readyPending = chg.some((c: any) => c.field === "ready" && c.status === "requested");
    const history = chg.map((c: any) => ({ field: c.field, value: c.new_value, old: c.old_value, at: c.created_at, source: c.source === "staff" ? "staff" : "customer_mypage", status: c.status, actor: c.actor })).slice(0, 10);
    const cr = pay[0]?.change_req || null;
    return json({
      ok: true, store: M.store, label: M.store === "nha" ? "那覇" : "札幌",
      reservation: {
        id: r.id, vehicle: r.vehicle, lend_date: r.lend_date, return_date: r.return_date,
        lend_time: lendTimeR, return_time: returnTimeR, del_time: r.del_time, col_time: r.col_time,
        name: r.name, people: r.people, price: r.price, status: r.status,
        insurance: insR, del_place: delPlaceR, col_place: colPlaceR,
        opt_b: optBR, opt_c: optCR, opt_j: optJR, opt_usb: r.opt_usb || 0,
        kd_status: r.kd_status || null, kd_track_token: r.kd_track_token || null,
        coupon_code: r.coupon_code || null, discount: Number(r.discount) || 0,
        cancel_requested_at: pay[0]?.cancel_requested_at || null, cancel_reason: pay[0]?.cancel_reason || null,
        change_req: (cr && cr.status === "pending") ? cr : null,
        vehicle_code: fleet[0]?.vehicle_code || null,
      },
      damage: { ready: damageReady, url: damageUrl },
      tracking: { active: r.kd_status === "delivering" || r.kd_status === "collecting", kd_status: r.kd_status || null, token: r.kd_track_token || null },
      pendingCancel, readyPending, recentChanges: chg, history,
    }, 200, origin);
  }

  if (action === "cancel") {
    const st = String(r.status || "");
    if (st === "cancelled" || st === "キャンセル" || st === "cancel") {
      return json({ ok: true, alreadyCancelled: true }, 200, origin);
    }
    // 出発済みはキャンセル不可（lend_date が過去）
    const today = new Date().toISOString().slice(0, 10);
    if (r.lend_date && r.lend_date < today) {
      return json({ error: "貸出日を過ぎているためオンラインでキャンセルできません" }, 409, origin);
    }
    await sbDelete(M.fleet, `reservation_id=eq.${encodeURIComponent(resId)}`);
    // OPシートからタスク(d-/c-/w-)も除去。札幌tasks=reservation_id列 / 那覇nha_tasks=_idで削除。
    if (M.store === "nha") {
      await nhaDeleteTasks(resId); // 那覇nha_tasksは予約番号紐付け(_id=t番号)
    } else {
      await sbDelete(M.tasks, `reservation_id=eq.${encodeURIComponent(resId)}`);
    }
    const ok = await sbPatch(M.resv, `id=eq.${encodeURIComponent(resId)}`, { status: "キャンセル" });
    if (!ok) return json({ error: "キャンセルに失敗しました" }, 500, origin);
    return json({ ok: true, cancelled: true }, 200, origin);
  }

  // ── 予約内容（場所/時間）の変更：お届け(出発)24時間前まで・場所と時間のみ ──
  if (action === "update") {
    const st = String(r.status || "");
    if (st === "cancelled" || st === "キャンセル" || st === "cancel") {
      return json({ error: "キャンセル済みの予約は変更できません" }, 409, origin);
    }
    // 出発24時間前を過ぎていたらオンライン変更不可（→公式LINE）
    if (within24h(r.lend_date, r.lend_time || r.del_time || "")) {
      return json({ error: "出発24時間前を過ぎているため、変更は公式LINEにて承ります", lineOnly: true }, 409, origin);
    }

    // 入力（与えられた項目だけ変更）。場所は文字列、時間は営業時間内30分刻み。
    const has = (k: string) => Object.prototype.hasOwnProperty.call(p, k);
    const delPlace = has("del_place") ? String(p.del_place || "").trim() : null;
    const colPlace = has("col_place") ? String(p.col_place || "").trim() : null;
    const lendTime = has("lend_time") ? String(p.lend_time || "").trim() : null;
    const returnTime = has("return_time") ? String(p.return_time || "").trim() : null;

    if (delPlace !== null && delPlace.length < 2) return json({ error: "お届け場所が不正です" }, 400, origin);
    if (colPlace !== null && colPlace.length < 2) return json({ error: "回収場所が不正です" }, 400, origin);
    if (lendTime !== null && !validTime(lendTime)) return json({ error: "お届け時間は9:00〜19:00（30分刻み）で指定してください" }, 400, origin);
    if (returnTime !== null && !validTime(returnTime)) return json({ error: "回収時間は9:00〜19:00（30分刻み）で指定してください" }, 400, origin);

    if (delPlace === null && colPlace === null && lendTime === null && returnTime === null) {
      return json({ error: "変更内容がありません" }, 400, origin);
    }

    // 1) reservations（正本）を更新。時間は lend_time/del_time・return_time/col_time を両系統そろえる
    const rPatch: Record<string, unknown> = {};
    if (delPlace !== null) rPatch.del_place = delPlace;
    if (colPlace !== null) rPatch.col_place = colPlace;
    if (lendTime !== null) { rPatch[M.lendTimeCol] = lendTime; rPatch.del_time = lendTime; }
    if (returnTime !== null) { rPatch[M.returnTimeCol] = returnTime; rPatch.col_time = returnTime; }
    const okRes = await sbPatch(M.resv, `id=eq.${encodeURIComponent(resId)}`, rPatch);
    if (!okRes) return json({ error: "変更の保存に失敗しました" }, 500, origin);

    if (M.store === "nha") {
      // 那覇：OPシート=nha_tasks（予約番号紐付け・日本語列・内容DEL/COL）を更新＋差別化マーカー
      const _st = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
      const _lbls: string[] = [];
      if (delPlace !== null) _lbls.push("お届け場所");
      if (lendTime !== null) _lbls.push("お届け時間");
      if (colPlace !== null) _lbls.push("回収場所");
      if (returnTime !== null) _lbls.push("回収時間");
      await nhaPatchTasks(resId, { place: delPlace, time: lendTime }, { place: colPlace, time: returnTime }, `✅変更済(${_st}):${_lbls.join("・")}`);
    } else {
    // 2) 既存タスク（OPシート・配車表のソース）も即時同期＋🔔変更マーカーをmemoに追記
    const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
    const changedLabels: string[] = [];
    if (delPlace !== null) changedLabels.push("お届け場所");
    if (lendTime !== null) changedLabels.push("お届け時間");
    if (colPlace !== null) changedLabels.push("回収場所");
    if (returnTime !== null) changedLabels.push("回収時間");
    const marker = `🔔顧客変更(${stamp}):${changedLabels.join("・")}`;

    async function patchTask(taskId: string, patch: Record<string, unknown>) {
      const cur = await sbGet(M.tasks, `_id=eq.${encodeURIComponent(taskId)}&select=_id,memo,changed_json`);
      if (!cur[0]) return; // タスク未生成なら本体が次回reservationsから生成（正本は更新済）
      const memo = String(cur[0].memo || "");
      const newMemo = memo.includes(marker) ? memo : (memo ? memo + " " + marker : marker);
      let cj: any = {};
      try { cj = cur[0].changed_json && typeof cur[0].changed_json === "object" ? cur[0].changed_json : (cur[0].changed_json ? JSON.parse(cur[0].changed_json) : {}); } catch { cj = {}; }
      cj.kd_customer_changed_at = new Date().toISOString();
      // 🔴 OP戻り防止（HANDYMAN同様）：SSパトロールが _ssPlace/_ssTime をフォーム値へ戻すのを防ぐ。
      // 場所は _placeSource=customer で保護＋_ssPlaceに新値／時間は _timeChange(最優先表示)＋_ssTime に新値。
      if (patch.place !== undefined) { cj._ssPlace = String(patch.place); cj._placeSource = "customer"; }
      if (patch.time !== undefined) { cj._ssTime = String(patch.time); cj._timeChange = String(patch.time); }
      await sbPatch(M.tasks, `_id=eq.${encodeURIComponent(taskId)}`, { ...patch, memo: newMemo, changed_json: cj });
    }
    // DELタスク：place=お届け場所 / time=お届け時間 ＋ 参照(col_place/return_time)
    const delTaskPatch: Record<string, unknown> = {};
    if (delPlace !== null) delTaskPatch.place = delPlace;
    if (lendTime !== null) delTaskPatch.time = lendTime;
    if (colPlace !== null) delTaskPatch.col_place = colPlace;
    if (returnTime !== null) delTaskPatch.return_time = returnTime;
    if (Object.keys(delTaskPatch).length) await patchTask(`d-${resId}`, delTaskPatch);
    // COLタスク：place=回収場所 / time=回収時間
    const colTaskPatch: Record<string, unknown> = {};
    if (colPlace !== null) colTaskPatch.place = colPlace;
    if (returnTime !== null) colTaskPatch.time = returnTime;
    if (Object.keys(colTaskPatch).length) await patchTask(`c-${resId}`, colTaskPatch);
    }

    // 3) 運営へSlack通知（OPシート連動・任意env）
    const lines = [
      `🔔 *マイページ変更* （顧客が予約内容を変更しました）`,
      `予約番号: ${resId} / ${r.name || ""}様`,
      `お届け: ${r.lend_date} ${lendTime !== null ? `→ *${lendTime}*` : (r.lend_time || "")}`,
      delPlace !== null ? `お届け場所 → *${delPlace}*` : null,
      `回収: ${r.return_date} ${returnTime !== null ? `→ *${returnTime}*` : (r.return_time || "")}`,
      colPlace !== null ? `回収場所 → *${colPlace}*` : null,
      `※配車表/OPシートに反映済み・ご確認ください`,
    ].filter(Boolean);
    await notifySlack(lines.join("\n"), M.slack);

    // 4) KEYDROP独自の変更ログに記録（マイページ履歴＋将来のKEYDROP my-admin用）＝HANDYMANのmypage_changesと切り分け
    const chgLog = async (field: string, oldV: any, newV: any) => {
      await sbPost("keydrop_mypage_changes", { reservation_id: resId, store: M.store, field, old_value: String(oldV ?? ""), new_value: String(newV ?? ""), source: "customer", status: "applied", note: "マイページ変更(即時反映)" }).catch(() => {});
    };
    if (delPlace !== null) await chgLog("del_place", r.del_place, delPlace);
    if (lendTime !== null) await chgLog("lend_time", r.lend_time || r.del_time, lendTime);
    if (colPlace !== null) await chgLog("col_place", r.col_place, colPlace);
    if (returnTime !== null) await chgLog("return_time", r.return_time || r.col_time, returnTime);

    return json({
      ok: true,
      updated: {
        del_place: delPlace !== null ? delPlace : r.del_place,
        col_place: colPlace !== null ? colPlace : r.col_place,
        lend_time: lendTime !== null ? lendTime : r.lend_time,
        return_time: returnTime !== null ? returnTime : r.return_time,
      },
    }, 200, origin);
  }

  // ── 早め返却（返却準備完了・希望回収時間の目安）＝申請（承認制）──
  if (action === "ready") {
    const st0 = String(r.status || "");
    if (st0 === "cancelled" || st0 === "キャンセル" || st0 === "cancel") return json({ error: "キャンセル済みの予約です" }, 409, origin);
    const already = await sbGet("keydrop_mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.ready&status=eq.requested&select=id&limit=1`).catch(() => []);
    if (already[0]) return json({ ok: true, alreadyRequested: true }, 200, origin);
    const rdyTime = (typeof p.time === "string" && /^\d{1,2}:\d{2}$/.test(p.time.trim())) ? p.time.trim() : "";
    const newVal = rdyTime ? `返却準備完了(早め回収OK) 希望時間 ${rdyTime}〜` : "返却準備完了(早め回収OK)";
    await sbPost("keydrop_mypage_changes", { reservation_id: resId, store: M.store, field: "ready", old_value: "", new_value: newVal, source: "customer", status: "requested", note: rdyTime ? `希望回収時間の目安 ${rdyTime}〜` : "予定時間より早い回収OK" });
    await notifySlack(`🟢 *早め回収OK（返却準備完了）* ${resId} ${r.name || ""}様\n利用:${r.lend_date}〜${r.return_date} / 予定回収:${r.return_time || r.col_time || "-"}${rdyTime ? ` / 🕒希望:${rdyTime}〜` : ""}`, M.slack);
    return json({ ok: true, requested: true }, 200, origin);
  }

  // ── オプション/補償/受渡方法の変更依頼（承認制・即反映しない）──
  if (action === "request") {
    const st1 = String(r.status || "");
    if (st1 === "cancelled" || st1 === "キャンセル" || st1 === "cancel") return json({ error: "キャンセル済みの予約は変更できません" }, 409, origin);
    const reqType = String(p.req_type || "").trim();
    const detail = String(p.detail || "").trim().slice(0, 300);
    const map: Record<string, string> = { option: "有料オプション(シート類)変更", method: "貸出/返却方法(区分)変更", insurance: "補償(免責)変更" };
    if (!map[reqType]) return json({ error: "リクエスト種別が不正です" }, 400, origin);
    if (detail.length < 1) return json({ error: "変更内容を入力してください" }, 400, origin);
    const already = await sbGet("keydrop_mypage_changes", `reservation_id=eq.${encodeURIComponent(resId)}&field=eq.${reqType}&status=eq.requested&select=id&limit=1`).catch(() => []);
    if (already[0]) return json({ ok: true, alreadyRequested: true, message: "同じ内容の依頼を受付済みです" }, 200, origin);
    const payload = (p.target && typeof p.target === "object") ? p.target : null;
    await sbPost("keydrop_mypage_changes", { reservation_id: resId, store: M.store, field: reqType, old_value: "", new_value: detail, source: "customer", status: "requested", note: map[reqType], payload });
    await notifySlack(`🟡 *${map[reqType]}の依頼* ${resId} ${r.name || ""}様\n利用:${r.lend_date}〜${r.return_date}\n依頼内容: ${detail}\n→ 管理で対応してください`, M.slack);
    return json({ ok: true, requested: true, kind: map[reqType] }, 200, origin);
  }

  // ── 変更リクエストの承認（SPK現場が押す）→ reservations/tasks に反映＋change_reqクリア＋顧客へ反映メール ──
  if (action === "approve_change") {
    const pay0 = (await sbGet("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}&select=change_req`).catch(() => []))[0];
    const cr: any = pay0?.change_req;
    if (!cr || cr.status !== "pending") return json({ error: "承認対象の変更申請がありません" }, 409, origin);
    const del = cr.del || null, col = cr.col || null;
    const rPatch: Record<string, unknown> = {};
    if (del) { if (del.place) rPatch.del_place = del.place; if (del.time) { rPatch[M.lendTimeCol] = del.time; rPatch.del_time = del.time; } }
    if (col) { if (col.place) rPatch.col_place = col.place; if (col.time) { rPatch[M.returnTimeCol] = col.time; rPatch.col_time = col.time; } }
    if (Object.keys(rPatch).length) await sbPatch(M.resv, `id=eq.${encodeURIComponent(resId)}`, rPatch);
    const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
    const apLabels: string[] = [];
    if (del?.time) apLabels.push("お届け時間");
    if (del?.place) apLabels.push("お届け場所");
    if (col?.time) apLabels.push("回収時間");
    if (col?.place) apLabels.push("回収場所");
    const marker = `✅変更済(${stamp}):${apLabels.join("・")}`;
    if (M.store === "nha") {
      // 那覇：OPシート=nha_tasks（予約番号紐付け・日本語列・内容DEL/COL）を反映＋✅変更済マーカー
      await nhaPatchTasks(resId, del, col, marker);
    } else {
    async function patchTask(taskId: string, patch: Record<string, unknown>) {
      const cur = await sbGet(M.tasks, `_id=eq.${encodeURIComponent(taskId)}&select=_id,memo,changed_json`);
      if (!cur[0]) return;
      const memo = String(cur[0].memo || "");
      const newMemo = memo.includes(marker) ? memo : (memo ? memo + " " + marker : marker);
      let cj: any = {};
      try { cj = cur[0].changed_json && typeof cur[0].changed_json === "object" ? cur[0].changed_json : (cur[0].changed_json ? JSON.parse(cur[0].changed_json) : {}); } catch { cj = {}; }
      cj.kd_customer_changed_at = new Date().toISOString();
      await sbPatch(M.tasks, `_id=eq.${encodeURIComponent(taskId)}`, { ...patch, memo: newMemo, changed_json: cj });
    }
    const dt: Record<string, unknown> = {};
    if (del?.place) dt.place = del.place;
    if (del?.time) dt.time = del.time;
    if (col?.place) dt.col_place = col.place;
    if (col?.time) dt.return_time = col.time;
    if (Object.keys(dt).length) await patchTask(`d-${resId}`, dt);
    const ct: Record<string, unknown> = {};
    if (col?.place) ct.place = col.place;
    if (col?.time) ct.time = col.time;
    if (Object.keys(ct).length) await patchTask(`c-${resId}`, ct);
    // 「🟡変更申請中」フラグを両タスクから除去（承認＝反映済みなので不要に）
    for (const tid of [`d-${resId}`, `c-${resId}`]) {
      const cu = await sbGet(M.tasks, `_id=eq.${encodeURIComponent(tid)}&select=_id,memo`);
      if (!cu[0]) continue;
      const m2 = String(cu[0].memo || "");
      if (m2.includes("変更申請中")) await sbPatch(M.tasks, `_id=eq.${encodeURIComponent(tid)}`, { memo: m2.replace(/🟡変更申請中\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim() });
    }
    }
    await sbPatch("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}`, { change_req: null, change_req_at: null });
    if (r.mail && String(r.mail).indexOf("@") > 0) {
      await sbPost("keydrop_notifications", { type: "change_done", reservation_id: resId, to_email: r.mail, store: M.store, payload: {
        name: r.name || "", del: del || null, col: col || null,
      } });
    }
    await notifySlack(`✅ *KEYDROP 変更を承認・反映*${M.store === "nha" ? "【那覇】" : ""} ${resId} / ${r.name || ""}様`, M.slack);
    return json({ ok: true, approved: true }, 200, origin);
  }

  // ── 変更リクエストの差戻し（SPK現場が押す）→ change_reqクリア（反映しない）＋フラグ除去 ──
  if (action === "reject_change") {
    await sbPatch("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}`, { change_req: null, change_req_at: null });
    if (M.store === "nha") {
      const _ts = await sbGet("nha_tasks", encodeURIComponent("予約番号") + "=eq." + encodeURIComponent(resId) + "&select=_id," + encodeURIComponent("メモ"));
      for (const _t of _ts) {
        const _m = String(_t["メモ"] || "");
        if (_m.includes("変更申請中")) await sbPatch("nha_tasks", "_id=eq." + encodeURIComponent(String(_t._id)), { "メモ": _m.replace(/🟡変更申請中\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim() });
      }
    } else {
    for (const tid of [`d-${resId}`, `c-${resId}`]) {
      const cu = await sbGet(M.tasks, `_id=eq.${encodeURIComponent(tid)}&select=_id,memo`);
      if (!cu[0]) continue;
      const m2 = String(cu[0].memo || "");
      if (m2.includes("変更申請中")) await sbPatch(M.tasks, `_id=eq.${encodeURIComponent(tid)}`, { memo: m2.replace(/🟡変更申請中\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim() });
    }
    }
    await notifySlack(`↩️ *KEYDROP 変更を差戻し*${M.store === "nha" ? "【那覇】" : ""} ${resId} / ${r.name || ""}様`, M.slack);
    return json({ ok: true, rejected: true }, 200, origin);
  }

  // ── 変更リクエスト（顧客がマイページで申請 → 即反映せず記録＋Slack。現場が承認で反映）──
  //   お届け(貸出)＝出発48時間前まで / 回収(返却)＝返却2時間前まで。締切後は公式LINE。
  if (action === "change_request") {
    const st = String(r.status || "");
    if (st === "cancelled" || st === "キャンセル" || st === "cancel") return json({ error: "キャンセル済みの予約は変更できません" }, 409, origin);
    const pay0 = (await sbGet("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}&select=change_req`).catch(() => []))[0];
    if (pay0?.change_req && pay0.change_req.status === "pending") return json({ error: "すでに変更申請中です。承認をお待ちください。" }, 409, origin);

    const del = p.del && typeof p.del === "object" ? p.del : null;
    const col = p.col && typeof p.col === "object" ? p.col : null;
    if (!del && !col) return json({ error: "変更内容がありません" }, 400, origin);

    const req: Record<string, unknown> = { requested_at: new Date().toISOString(), status: "pending" };
    if (del) {
      if (hoursUntil(r.lend_date, r.lend_time || r.del_time || "") < 48) {
        return json({ error: "お届けの変更はマイページでは出発48時間前まで。締切後は公式LINEへご連絡ください。", line: true }, 409, origin);
      }
      const dt = del.time != null ? String(del.time).trim() : "";
      if (dt && !validTime(dt)) return json({ error: "お届け時間は9:00〜19:00（30分刻み）で指定してください" }, 400, origin);
      req.del = {
        time: dt || (r.lend_time || r.del_time || ""),
        place: del.place != null ? String(del.place).trim() : (r.del_place || ""),
        lat: del.lat != null ? Number(del.lat) : null,
        lng: del.lng != null ? Number(del.lng) : null,
      };
    }
    if (col) {
      if (hoursUntil(r.return_date, r.return_time || r.col_time || "") < 2) {
        return json({ error: "回収の変更はマイページでは返却2時間前まで。締切後は公式LINEへご連絡ください。", line: true }, 409, origin);
      }
      const ct = col.time != null ? String(col.time).trim() : "";
      if (ct && !validTime(ct)) return json({ error: "回収時間は9:00〜19:00（30分刻み）で指定してください" }, 400, origin);
      req.col = {
        time: ct || (r.return_time || r.col_time || ""),
        place: col.place != null ? String(col.place).trim() : (r.col_place || ""),
        lat: col.lat != null ? Number(col.lat) : null,
        lng: col.lng != null ? Number(col.lng) : null,
      };
    }

    await sbPatch("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}`, { change_req: req, change_req_at: req.requested_at });

    // OPシート/配車表に「変更申請中」フラグ（d-/c-タスクのmemoに付与）→現場が承認待ち＋何が変わるか分かる
    const cstamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
    const reqLabels: string[] = [];
    if ((req.del as any)?.time) reqLabels.push("お届け時間");
    if ((req.del as any)?.place) reqLabels.push("お届け場所");
    if ((req.col as any)?.time) reqLabels.push("回収時間");
    if ((req.col as any)?.place) reqLabels.push("回収場所");
    const cmark = `🟡変更申請中(${cstamp}):${reqLabels.join("・")}`;
    if (M.store === "nha") {
      await nhaPatchTasks(resId, null, null, cmark); // 那覇：nha_tasksのメモに🟡変更申請中マーカー
    } else {
    for (const tid of [`d-${resId}`, `c-${resId}`]) {
      const cur = await sbGet(M.tasks, `_id=eq.${encodeURIComponent(tid)}&select=_id,memo`);
      if (!cur[0]) continue;
      const memo = String(cur[0].memo || "");
      if (!memo.includes("変更申請中")) await sbPatch(M.tasks, `_id=eq.${encodeURIComponent(tid)}`, { memo: memo ? memo + " " + cmark : cmark });
    }
    }

    const lines = [
      `✏️ *KEYDROP 変更リクエスト*（顧客がマイページで申請・要承認）`,
      `予約番号: ${resId} / ${r.name || ""}様`,
    ];
    if (req.del) lines.push(`お届け→ 時間:${(req.del as any).time || "-"} / 場所:${(req.del as any).place || "-"}`);
    if (req.col) lines.push(`回収→ 時間:${(req.col as any).time || "-"} / 場所:${(req.col as any).place || "-"}`);
    lines.push(`➡️ ${M.store === "nha" ? "NHAアプリ" : "SPKアプリ"}「🚫キャンセル」隣の変更リクエストで確認→承認してください`);
    await notifySlack(lines.join("\n"), M.slack);

    return json({ ok: true, requested: true }, 200, origin);
  }

  // ── キャンセル依頼（顧客が押す → 即キャンセルせず運営へメール＋Slack。返金判断は運営）──
  if (action === "cancel_request") {
    const st = String(r.status || "");
    if (st === "cancelled" || st === "キャンセル" || st === "cancel") {
      return json({ ok: true, alreadyCancelled: true }, 200, origin);
    }
    const reason = String(p.reason || "").trim().slice(0, 500);
    const nowIso = new Date().toISOString();

    // 1) キャンセル依頼マーカーを keydrop_payments に記録（reservationsには changed_json 列が無いため）。
    //    statusは変えない＝運営が返金判断後にSPK adminで確定。SPKはこの列を読んで一覧表示する。
    await sbPatch("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}`,
      { cancel_requested_at: nowIso, cancel_reason: reason || null });

    // 1.5) 顧客へ「キャンセル依頼を受け付けました」メールをキュー投入（GAS送信ワーカーが reserve@ から送信）
    if (r.mail && String(r.mail).indexOf("@") > 0) {
      await sbPost("keydrop_notifications", {
        type: "cancel_ack",
        reservation_id: resId,
        to_email: r.mail,
        store: M.store,
        payload: {
          name: r.name || "", vehicleClass: r.vehicle || "",
          lend_date: r.lend_date || "", lend_time: r.lend_time || r.del_time || "",
          return_date: r.return_date || "", return_time: r.return_time || r.col_time || "",
          del_place: r.del_place || "", col_place: r.col_place || "",
          price: r.price || 0, reason,
        },
      });
    }

    // 2) 配車表/OPシートに出るよう d-/c- タスクのmemoに🔴依頼マーカー（存在すれば）
    const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
    const marker = `🔴キャンセル依頼(${stamp})${reason ? "：" + reason : ""}`;
    if (M.store === "nha") {
      await nhaPatchTasks(resId, null, null, marker); // 那覇：nha_tasksのメモに🔴キャンセル依頼マーカー
    } else {
    for (const tid of [`d-${resId}`, `c-${resId}`]) {
      const cur = await sbGet(M.tasks, `_id=eq.${encodeURIComponent(tid)}&select=_id,memo`);
      if (!cur[0]) continue;
      const memo = String(cur[0].memo || "");
      if (!memo.includes("キャンセル依頼")) {
        await sbPatch(M.tasks, `_id=eq.${encodeURIComponent(tid)}`, { memo: memo ? memo + " " + marker : marker });
      }
    }
    }

    // 3) 運営へキャンセル依頼メールをキュー投入（KEYDROP_OPS_EMAIL を設定した時のみ。
    //    未設定なら送らない＝運営通知は下のSlackが主。reserve@ 誤取込を避けるため既定では送らない）
    if (OPS_EMAIL && OPS_EMAIL.indexOf("@") > 0) {
      await sbPost("keydrop_notifications", {
        type: "cancel_request",
        reservation_id: resId,
        to_email: OPS_EMAIL,
        store: M.store,
        payload: {
          name: r.name || "", mail: r.mail || "", tel: r.tel || "",
          vehicleClass: r.vehicle || "",
          lend_date: r.lend_date || "", lend_time: r.lend_time || r.del_time || "",
          return_date: r.return_date || "", return_time: r.return_time || r.col_time || "",
          del_place: r.del_place || "", col_place: r.col_place || "",
          price: r.price || 0, status: st, reason,
        },
      });
    }

    // 4) 運営へSlack即時通知（主・任意env・店舗別ch）
    await notifySlack([
      `🔴 *KEYDROP キャンセル依頼*${M.store === "nha" ? "【那覇】" : ""} （顧客がマイページで申請）`,
      `予約番号: ${resId} / ${r.name || ""}様（${r.mail || ""}）`,
      `期間: ${r.lend_date} ${r.lend_time || r.del_time || ""} 〜 ${r.return_date} ${r.return_time || r.col_time || ""}`,
      `クラス: ${r.vehicle || ""} / 金額: ¥${Number(r.price || 0).toLocaleString()}`,
      reason ? `理由: ${reason}` : null,
      `➡️ *返金判断のうえ ${M.store === "nha" ? "NHA" : "SPK"} adminでキャンセル確定してください*`,
    ].filter(Boolean).join("\n"), M.slack);

    return json({ ok: true, requested: true }, 200, origin);
  }

  return json({ error: "不正なアクション" }, 400, origin);
});
