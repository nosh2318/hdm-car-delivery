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
  // "https://keydrop.example.com", // 独自ドメイン取得時に追加
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
async function notifySlack(text: string): Promise<void> {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  const channel = Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36";
  if (!token) { console.log("[notifySlack] no token (skip):", text); return; }
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text }),
    });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) console.error("[notifySlack] failed:", JSON.stringify(d));
  } catch (e) { console.error("[notifySlack] error:", String(e)); }
}

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
  const resId = String(p.resId || p.reservationId || "").trim();

  // 本人確認：予約番号 + メール の両方必須（片方だけでは何も返さない＝総当たり/PII漏洩防止）
  if (!mail || mail.indexOf("@") < 0) return json({ error: "メールアドレスが必要です" }, 400, origin);
  if (!resId) return json({ error: "予約番号が必要です" }, 400, origin);

  // 予約を1件だけ取得（id一致 かつ mail一致 のときのみ）
  const rows = await sbGet(
    "reservations",
    `id=eq.${encodeURIComponent(resId)}&select=id,ota,vehicle,lend_date,return_date,lend_time,return_time,del_time,col_time,name,mail,tel,people,price,status,insurance,del_place,col_place,kd_status`,
  );
  const r = rows[0];
  if (!r || String(r.mail || "").trim().toLowerCase() !== mail) {
    // 一致しなければ存在を明かさず一律エラー
    return json({ error: "予約番号またはメールアドレスが一致しません" }, 404, origin);
  }

  if (action === "lookup") {
    const fleet = await sbGet("fleet", `reservation_id=eq.${encodeURIComponent(resId)}&select=vehicle_code`);
    // キャンセル依頼マーカー（keydrop_payments.cancel_requested_at）を返す＝再入場でも「申請中」を表示し再依頼を防ぐ
    const pay = await sbGet("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}&select=cancel_requested_at,cancel_reason`).catch(() => []);
    return json({
      ok: true,
      reservation: {
        id: r.id, vehicle: r.vehicle, lend_date: r.lend_date, return_date: r.return_date,
        lend_time: r.lend_time, return_time: r.return_time, del_time: r.del_time, col_time: r.col_time,
        name: r.name, people: r.people, price: r.price, status: r.status,
        insurance: r.insurance, del_place: r.del_place, col_place: r.col_place,
        kd_status: r.kd_status || null,
        cancel_requested_at: pay[0]?.cancel_requested_at || null,
        cancel_reason: pay[0]?.cancel_reason || null,
        vehicle_code: fleet[0]?.vehicle_code || null,
      },
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
    await sbDelete("fleet", `reservation_id=eq.${encodeURIComponent(resId)}`);
    const ok = await sbPatch("reservations", `id=eq.${encodeURIComponent(resId)}`, { status: "キャンセル" });
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
    if (lendTime !== null) { rPatch.lend_time = lendTime; rPatch.del_time = lendTime; }
    if (returnTime !== null) { rPatch.return_time = returnTime; rPatch.col_time = returnTime; }
    const okRes = await sbPatch("reservations", `id=eq.${encodeURIComponent(resId)}`, rPatch);
    if (!okRes) return json({ error: "変更の保存に失敗しました" }, 500, origin);

    // 2) 既存タスク（OPシート・配車表のソース）も即時同期＋🔔変更マーカーをmemoに追記
    const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
    const changedLabels: string[] = [];
    if (delPlace !== null) changedLabels.push("お届け場所");
    if (lendTime !== null) changedLabels.push("お届け時間");
    if (colPlace !== null) changedLabels.push("回収場所");
    if (returnTime !== null) changedLabels.push("回収時間");
    const marker = `🔔顧客変更(${stamp}):${changedLabels.join("・")}`;

    async function patchTask(taskId: string, patch: Record<string, unknown>) {
      const cur = await sbGet("tasks", `_id=eq.${encodeURIComponent(taskId)}&select=_id,memo,changed_json`);
      if (!cur[0]) return; // タスク未生成なら本体が次回reservationsから生成（正本は更新済）
      const memo = String(cur[0].memo || "");
      const newMemo = memo.includes(marker) ? memo : (memo ? memo + " " + marker : marker);
      let cj: any = {};
      try { cj = cur[0].changed_json && typeof cur[0].changed_json === "object" ? cur[0].changed_json : (cur[0].changed_json ? JSON.parse(cur[0].changed_json) : {}); } catch { cj = {}; }
      cj.kd_customer_changed_at = new Date().toISOString();
      await sbPatch("tasks", `_id=eq.${encodeURIComponent(taskId)}`, { ...patch, memo: newMemo, changed_json: cj });
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
    await notifySlack(lines.join("\n"));

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

    // 2) 配車表/OPシートに出るよう d-/c- タスクのmemoに🔴依頼マーカー（存在すれば）
    const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
    const marker = `🔴キャンセル依頼(${stamp})${reason ? "：" + reason : ""}`;
    for (const tid of [`d-${resId}`, `c-${resId}`]) {
      const cur = await sbGet("tasks", `_id=eq.${encodeURIComponent(tid)}&select=_id,memo`);
      if (!cur[0]) continue;
      const memo = String(cur[0].memo || "");
      if (!memo.includes("キャンセル依頼")) {
        await sbPatch("tasks", `_id=eq.${encodeURIComponent(tid)}`, { memo: memo ? memo + " " + marker : marker });
      }
    }

    // 3) 運営へキャンセル依頼メールをキュー投入（KEYDROP_OPS_EMAIL を設定した時のみ。
    //    未設定なら送らない＝運営通知は下のSlackが主。reserve@ 誤取込を避けるため既定では送らない）
    if (OPS_EMAIL && OPS_EMAIL.indexOf("@") > 0) {
      await sbPost("keydrop_notifications", {
        type: "cancel_request",
        reservation_id: resId,
        to_email: OPS_EMAIL,
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

    // 4) 運営へSlack即時通知（主・任意env）
    await notifySlack([
      `🔴 *KEYDROP キャンセル依頼* （顧客がマイページで申請）`,
      `予約番号: ${resId} / ${r.name || ""}様（${r.mail || ""}）`,
      `期間: ${r.lend_date} ${r.lend_time || r.del_time || ""} 〜 ${r.return_date} ${r.return_time || r.col_time || ""}`,
      `クラス: ${r.vehicle || ""} / 金額: ¥${Number(r.price || 0).toLocaleString()}`,
      reason ? `理由: ${reason}` : null,
      `➡️ *返金判断のうえ SPK adminでキャンセル確定してください*`,
    ].filter(Boolean).join("\n"));

    return json({ ok: true, requested: true }, 200, origin);
  }

  return json({ error: "不正なアクション" }, 400, origin);
});
