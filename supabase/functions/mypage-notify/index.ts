// ============================================================
// mypage-notify : マイページURLを最適タイミングで自動送信（cron）
// 2026-07-05 / omni  ※札幌(spk)先行。テンプレ＋マイページURLを line-push で送る。
//  タイミング: ①初動(LINE ID取得後) ②場所未設定リマインド(貸出3日前) ③前日 ④返却3時間前
//  安全: spk_line_config.mypage_notify_enabled=true の時のみ本番送信。test_mode時は test_user_id のみ。
//  重複防止: {store}_line_sends に (resv_no, action, status='sent') があれば再送しない。
//  認証: x-cron-secret = CRON_SECRET（cron）。
// ============================================================
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };
const URLBASE = "https://nosh2318.github.io/spk-task/my.html?t=";

async function sbGet(t: string, q: string): Promise<any[]> { const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: H }); if (!r.ok) { console.error(`GET ${t}`, await r.text()); return []; } return await r.json(); }
function jstNow(): Date { return new Date(Date.now() + 9 * 3600 * 1000); }
function dstr(off: number): string { const d = jstNow(); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); }

// テンプレ（日本語＋English）＋ URL
const TPL: Record<string, (u: string, r: any) => string> = {
  mypage_initial: (u) => `【HANDYMAN 札幌デリバリー】\nご予約ありがとうございます。専用マイページで、お届け／回収の日時・場所の確認・変更ができます👇\nThank you for your booking! Check & edit your delivery/pickup details here 👇\n${u}`,
  mypage_place: (u) => `【HANDYMAN 札幌デリバリー】お届け／回収の場所がまだ未設定です。スムーズなお引き渡しのため、マイページからご登録をお願いします👇\nYour delivery/pickup location is not set yet. Please set it from your page 👇\n${u}`,
  mypage_daybefore: (u) => `【HANDYMAN 札幌デリバリー】明日がご利用日です。日時・お届け場所を今一度ご確認ください👇\nYour rental starts tomorrow. Please review the date/time & location 👇\n${u}`,
  mypage_return3h: (u) => `【HANDYMAN 札幌デリバリー】まもなくご返却のお時間です（約3時間後）。回収の場所・時間をご確認ください👇\nPickup is in about 3 hours. Please review the pickup place & time 👇\n${u}`,
};

// 無人貸出・乗り捨ての担当が付いた予約は、貸出/返却リマインドを自動送信しない（スタッフ手動運用）。
//   貸出担当(d-タスク)が無人/乗り捨て → 場所未設定(②)・前日(③)リマインドを止める
//   返却担当(c-タスク)が乗り捨て/無人 → 返却3時間前(④)リマインドを止める
//   ①初動のマイページ案内は残す。将来 全体自動ONでもこの2種は除外を維持する。
const UNATTENDED_RE = /無人|乗り?捨/;

async function callLinePush(store: string, resvNo: string, action: string, message: string): Promise<any> {
  const secret = Deno.env.get("LINEPUSH_SECRET");
  if (!secret) return { ok: false, reason: "no_secret" };
  try {
    const r = await fetch(`${SB_URL}/functions/v1/line-push`, {
      method: "POST", headers: { "content-type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify({ secret, store, resv_no: resvNo, action, message }),
    });
    return await r.json().catch(() => ({ ok: false }));
  } catch (e) { return { ok: false, reason: String(e) }; }
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const hdr = req.headers.get("x-cron-secret");
  let body: any = {}; try { body = await req.json(); } catch { /* ignore */ }
  const bySecret = !!cronSecret && (hdr === cronSecret || body?.secret === cronSecret);
  if (!bySecret) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  const store = "spk"; // P1
  const cfg = (await sbGet(`${store}_line_config`, `id=eq.1&select=*`))[0] || {};
  const enabled = cfg.mypage_notify_enabled === true;
  const testMode = cfg.test_mode === true;
  if (!enabled && !testMode) return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), { headers: { "content-type": "application/json" } });

  const today = dstr(0), d1 = dstr(1), d3 = dstr(3);
  const RESV = "reservations";
  // 対象＝返却が今日以降・未キャンセル
  const resvsAll = await sbGet(RESV, `return_date=gte.${today}&status=not.in.("キャンセル",cancelled,cancel)&select=id,name,ota,lend_date,lend_time,return_date,return_time,del_time,col_time,del_place,mypage_token&limit=1000`);
  // KEYDROPは独自マイページ(keydrop.jp)を使うため、HANDYMANマイページの送信対象から除外
  const resvs = resvsAll.filter((r: any) => String(r.ota || "").toUpperCase() !== "KEYDROP");
  // LINE連携済み（userIdあり）だけが対象
  const links = await sbGet(`${store}_line_links`, `select=resv_no,line_user_id&limit=5000`);
  const linked = new Set(links.filter((l: any) => l.resv_no && l.line_user_id).map((l: any) => l.resv_no));
  // 既送信（sent）マップ
  const sends = await sbGet(`${store}_line_sends`, `action=like.mypage_*&status=eq.sent&select=resv_no,action&limit=20000`);
  const sentSet = new Set(sends.map((s: any) => s.resv_no + "|" + s.action));

  // 場所リマインド判定用: 貸出3日後の予約の d- タスク解決場所
  const d3ids = resvs.filter((r: any) => r.lend_date === d3 && linked.has(r.id)).map((r: any) => r.id);
  const placeByRes: Record<string, string> = {};
  if (d3ids.length) {
    for (let i = 0; i < d3ids.length; i += 60) {
      const chunk = d3ids.slice(i, i + 60).map((x: string) => encodeURIComponent(x)).join(",");
      const ts = await sbGet("tasks", `reservation_id=in.(${chunk})&deleted=not.is.true&select=reservation_id,_id,place,changed_json`);
      for (const t of ts) {
        if (!String(t._id || "").startsWith("d-")) continue;
        let cj: any = t.changed_json; if (typeof cj === "string") { try { cj = JSON.parse(cj); } catch { cj = {}; } } cj = cj || {};
        const p = cj._placeSource === "manual" ? (t.place || "") : (cj._ssPlace || t.place || "");
        placeByRes[t.reservation_id] = String(p || "").trim();
      }
    }
  }

  // 無人貸出・乗り捨て判定用: リマインド候補予約の d-(貸出) / c-(返却) タスク担当を取得
  const remIds = resvs
    .filter((r: any) => linked.has(r.id) && r.mypage_token &&
      (r.lend_date === d1 || r.lend_date === d3 || r.return_date === today || r.return_date === d1))
    .map((r: any) => r.id);
  const lendAsg: Record<string, string> = {};
  const colAsg: Record<string, string> = {};
  for (let i = 0; i < remIds.length; i += 60) {
    const chunk = remIds.slice(i, i + 60).map((x: string) => encodeURIComponent(x)).join(",");
    if (!chunk) continue;
    const ts = await sbGet("tasks", `reservation_id=in.(${chunk})&deleted=not.is.true&select=reservation_id,_id,assignee`);
    for (const t of ts) {
      const id = String(t._id || "");
      if (id.startsWith("d-")) lendAsg[t.reservation_id] = String(t.assignee || "");
      else if (id.startsWith("c-")) colAsg[t.reservation_id] = String(t.assignee || "");
    }
  }
  const unLend = (id: string) => lendAsg[id] && UNATTENDED_RE.test(lendAsg[id]);
  const unCol = (id: string) => colAsg[id] && UNATTENDED_RE.test(colAsg[id]);

  const nowMs = Date.now();
  const results: any[] = [];
  const push = async (r: any, action: string) => {
    const key = r.id + "|" + action;
    if (sentSet.has(key)) return;
    const url = URLBASE + r.mypage_token;
    const msg = TPL[action](url, r);
    const res = await callLinePush(store, r.id, action, msg);
    results.push({ id: r.id, action, ok: !!res.ok, reason: res.reason || null });
    if (res.ok) sentSet.add(key);
  };

  for (const r of resvs) {
    if (!linked.has(r.id) || !r.mypage_token) continue;
    // ① 初動（LINE ID取得後、まだ送っていなければ）
    await push(r, "mypage_initial");
    // ② 場所未設定リマインド（貸出3日前・OP解決場所が空）※無人貸出は除外
    if (r.lend_date === d3 && !(placeByRes[r.id]) && !unLend(r.id)) await push(r, "mypage_place");
    // ③ 前日 ※無人貸出は除外
    if (r.lend_date === d1 && !unLend(r.id)) await push(r, "mypage_daybefore");
    // ④ 返却3時間前（返却日時が now〜now+3h+window内）※乗り捨て/無人返却は除外
    if (r.return_date && r.return_date >= today && !unCol(r.id)) {
      const rt = (r.return_time || r.col_time || "18:00");
      if (/^\d{1,2}:\d{2}$/.test(rt)) {
        const dep = new Date(`${r.return_date}T${rt}:00+09:00`).getTime();
        const win = (cfg.window_min || 30) * 60000;
        if (dep - nowMs <= 3 * 3600000 && dep - nowMs > 3 * 3600000 - Math.max(win, 30 * 60000)) await push(r, "mypage_return3h");
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, enabled, testMode, sent: results.filter((x) => x.ok).length, results }), { headers: { "content-type": "application/json" } });
});
