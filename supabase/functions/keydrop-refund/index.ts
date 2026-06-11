// ============================================================
// keydrop-refund : SPK運営がキャンセル依頼を「承認」→ Square自動返金＋キャンセル確定
// 2026-06-10 / omni  (Phase B) / 2026-06-11 自動返金化（オーナー指示）
//
// 方針（2026-06-11 更新）：承認したら自動でSquare返金する。
//   ・KEYDROPは1予約=1 Square決済（square_payment_id 保持）なので Refunds API で安全に自動返金可能。
//   ・返金額 = 入金 − キャンセル料（ポリシー）。Square返金が成功した時だけ DBをrefunded/キャンセルに更新。
//   ・Square失敗時は DB を一切変更せず error 返却＋Slack警告（手動対応へ）。
//   ・autoRefund:false を渡せば旧挙動（記録のみ＝手動返金前提）。返金0（100%料）はSquare不要。
//   ・authenticated（SPKログイン）以外は拒否。冪等：refunded済はスキップ＋idempotency_key=kdrefund-予約番号。
//
// ポリシー（hdm-car-delivery getCancelFee と一致・表示と記録の根拠）:
//   出発まで ≥7日=無料(0%) / 6〜3日=20% / 2〜1日=30% / 当日以降=50%
//   キャンセル料 = ceil(基本料金 × 率)、返金 = 入金額 − キャンセル料（0未満は0）
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SQUARE_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const SQUARE_API = "https://connect.squareup.com";

const ALLOWED = ["https://nosh2318.github.io"];
function cors(o: string | null) {
  const allow = o && ALLOWED.includes(o) ? o : ALLOWED[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Vary": "Origin" };
}
let _o: string | null = null;
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors(_o), "content-type": "application/json" } }); }

async function sbGet(t: string, q: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) { console.error(`GET ${t}: ${await r.text()}`); return []; }
  return await r.json();
}
async function sbPatch(t: string, q: string, d: unknown): Promise<boolean> {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(d) });
  if (!r.ok) { console.error(`PATCH ${t}: ${await r.text()}`); return false; }
  const j = await r.json(); return Array.isArray(j) && j.length > 0;
}
async function sbDelete(t: string, q: string) {
  await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { method: "DELETE", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
}
async function sbPost(t: string, d: unknown) {
  const r = await fetch(`${SB_URL}/rest/v1/${t}`, { method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(d) });
  if (!r.ok) console.error(`POST ${t}: ${await r.text()}`);
}
async function notifySlack(text: string, channel?: string) {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  const ch = channel || Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36";
  if (!token || !ch) return;
  try { await fetch("https://slack.com/api/chat.postMessage", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: ch, text }) }); } catch (e) { console.error("[slack]", e); }
}

// ★ 店舗別テーブル/Slack/列マッピング解決。store指定が無ければ予約番号接頭辞 KDN- で那覇を推論。
const STORE_MAP: Record<string, { resv: string; fleet: string; tasks: string; resvSel: string; slackEnv: string }> = {
  spk: { resv: "reservations", fleet: "fleet", tasks: "tasks",
    resvSel: "id,ota,status,lend_date,price,name,vehicle,mail", slackEnv: "SLACK_KEYDROP_CHANNEL" },
  nha: { resv: "nha_reservations", fleet: "nha_fleet", tasks: "nha_tasks",
    resvSel: "id,ota,status,lend_date:start_date,price,name,vehicle:vehicle_class,mail", slackEnv: "SLACK_KEYDROP_CHANNEL_NAHA" },
};
function resolveStore(p: any, resId: string) {
  const s = (p && p.store === "nha") || /^KDN-/i.test(resId) ? "nha" : "spk";
  const m = STORE_MAP[s];
  const slack = Deno.env.get(m.slackEnv) || Deno.env.get("SLACK_KEYDROP_CHANNEL") || "C08TDTPEB36";
  return { store: s, ...m, slack };
}

// JWTのrole claimを読む（gatewayが署名検証済み。ここでは認可のためroleだけ見る）
function jwtRole(auth: string | null): string {
  try {
    const tok = (auth || "").replace(/^Bearer\s+/i, "");
    const p = tok.split(".")[1]; if (!p) return "";
    const pad = p.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)));
    return payload.role || "";
  } catch { return ""; }
}

// ポリシー：出発までの日数からキャンセル率(%)を返す（hdm getCancelFee と一致）
function policyRate(lendDate: string): number {
  const lend = new Date(lendDate + "T00:00:00+09:00").getTime();
  const now = Date.now();
  const days = Math.ceil((lend - now) / 86400000);
  if (days >= 7) return 0;
  if (days >= 3) return 20;
  if (days >= 1) return 30;
  return 50;
}

Deno.serve(async (req) => {
  _o = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(_o) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // 認可：authenticated（SPKログイン）のみ。anon/未ログインは拒否。
  if (jwtRole(req.headers.get("authorization")) !== "authenticated") {
    return json({ error: "権限がありません（SPKにログインして操作してください）" }, 403);
  }

  let p: any; try { p = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const resId = String(p.reservationId || p.resId || "").trim();
  if (!resId) return json({ error: "予約番号が必要です" }, 400);

  const M = resolveStore(p, resId); // 店舗解決（spk/nha）

  // 予約（KEYDROPのみ・店舗別テーブル／那覇は列エイリアスで札幌項目名に揃える）
  const rv = (await sbGet(M.resv, `id=eq.${encodeURIComponent(resId)}&select=${M.resvSel}`))[0];
  if (!rv || rv.ota !== "KEYDROP") return json({ error: "対象のKEYDROP予約が見つかりません" }, 404);
  const st = String(rv.status || "");
  if (st === "cancelled" || st === "キャンセル" || st === "cancel") return json({ ok: true, alreadyCancelled: true });

  // 決済台帳
  const pay = (await sbGet("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}&select=status,amount,square_payment_id`))[0];
  if (!pay) return json({ error: "決済記録がありません（未決済の可能性）" }, 409);
  if (pay.status === "refunded") return json({ ok: true, alreadyRefunded: true });
  if (pay.status !== "paid") return json({ error: `入金が確認できません（status=${pay.status}）` }, 409);

  // サーバ側でポリシー再計算
  const base = Number(rv.price || 0);
  const paid = Number(pay.amount || base);
  //  ★ ノーチャージ（キャンセル料不要・全額返金）：運営判断で料率0%に上書き（航空便欠航等）。
  const noCharge = p.noCharge === true;
  const rate = noCharge ? 0 : policyRate(rv.lend_date);
  const fee = noCharge ? 0 : Math.ceil(base * rate / 100);
  let refund = paid - fee;
  if (refund < 0) refund = 0;
  if (refund > paid) refund = paid;

  //  任意：スタッフが実際の返金額を refundAmount で上書き可（無ければポリシー値）。ノーチャージ時は常に全額。
  const refundActual = noCharge ? paid
    : ((p.refundAmount !== undefined && p.refundAmount !== null && !isNaN(Number(p.refundAmount)))
        ? Math.max(0, Math.round(Number(p.refundAmount))) : refund);

  // ★ 自動返金（既定）：Square Refunds API で実返金。失敗したらDBは一切変更しない（手動対応へ）。
  //   autoRefund:false を渡せば従来の「記録のみ（手動返金前提）」。返金額0（100%キャンセル料）はSquare不要。
  let squareRefundId: string | null = null;
  const doAuto = p.autoRefund !== false;
  if (doAuto && refundActual > 0) {
    if (!SQUARE_TOKEN) return json({ error: "Square設定が未構成のため自動返金できません（手動返金後にautoRefund:falseで確定してください）" }, 503);
    if (!pay.square_payment_id) return json({ error: "Square決済IDが無いため自動返金不可。Square Dashboardで手動返金してください" }, 409);
    try {
      const r = await fetch(`${SQUARE_API}/v2/refunds`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, "content-type": "application/json", "Square-Version": "2024-06-04" },
        body: JSON.stringify({
          idempotency_key: `kdrefund-${resId}`,
          payment_id: pay.square_payment_id,
          amount_money: { amount: refundActual, currency: "JPY" },
          reason: `KEYDROP cancel ${rate}%`,
        }),
      });
      const j = await r.json();
      const rst = j?.refund?.status;
      if (!r.ok || (rst !== "COMPLETED" && rst !== "PENDING" && rst !== "APPROVED")) {
        const detail = (j.errors && j.errors[0] && (j.errors[0].detail || j.errors[0].code)) || "返金APIエラー";
        console.error(`[refund] FAIL ${resId}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
        await notifySlack(`⚠️ *KEYDROP 自動返金 失敗* ${resId} / ${rv.name || ""}様\n返金額 ¥${refundActual.toLocaleString()} : ${detail}\n→ DB未変更。Square Dashboardで手動確認してください。`);
        return json({ error: "Square返金に失敗しました：" + detail + "（DBは変更していません）" }, 402);
      }
      squareRefundId = j.refund.id;
    } catch (e) {
      console.error("[refund]", e);
      return json({ error: "返金処理で通信エラーが発生しました（DBは変更していません）" }, 500);
    }
  }

  // DB確定：台帳refunded・予約キャンセル・配車解放（Square返金成功 or 返金0 or 手動モードのみ到達）
  const nowIso = new Date().toISOString();
  await sbPatch("keydrop_payments", `reservation_id=eq.${encodeURIComponent(resId)}`,
    { status: "refunded", refund_amount: refundActual, cancel_fee: fee, cancel_rate: rate, refunded_at: nowIso, square_refund_id: squareRefundId });
  await sbPatch(M.resv, `id=eq.${encodeURIComponent(resId)}`, { status: "キャンセル" });
  await sbDelete(M.fleet, `reservation_id=eq.${encodeURIComponent(resId)}`);
  // OPシート(配車表)からタスク(d-/c-/w-)を除去＝アプリ通常キャンセルと同挙動。
  // 札幌tasksはreservation_id列あり / 那覇nha_tasksは無い→_id(d-/c-/w-)で削除。
  if (M.store === "nha") {
    await sbDelete(M.tasks, `_id=in.(${["d-", "c-", "w-"].map((pf) => encodeURIComponent(pf + resId)).join(",")})`);
  } else {
    await sbDelete(M.tasks, `reservation_id=eq.${encodeURIComponent(resId)}`);
  }

  // 顧客へ「キャンセル確定（返金）」メールをキュー投入（GAS送信ワーカーが reserve@ から送信）
  if (rv.mail && String(rv.mail).indexOf("@") > 0) {
    await sbPost("keydrop_notifications", {
      type: "cancel_done",
      reservation_id: resId,
      to_email: rv.mail,
      store: M.store,
      payload: {
        name: rv.name || "", vehicleClass: rv.vehicle || "",
        lend_date: rv.lend_date || "",
        paid: paid, fee: fee, rate: rate, refund: refundActual,
      },
    });
  }

  const howRefunded = (doAuto && refundActual > 0) ? `自動返金 完了（Square refund ${squareRefundId}）`
    : (refundActual === 0 ? "返金なし（キャンセル料100%）" : "記録のみ（手動返金）");
  await notifySlack([
    `✅ *KEYDROP キャンセル確定*${M.store === "nha" ? "【那覇】" : ""}${noCharge ? "（🆓 ノーチャージ＝キャンセル料不要）" : ""}`,
    `予約番号: ${resId} / ${rv.name || ""}様（${rv.vehicle || ""}クラス）`,
    `入金 ¥${paid.toLocaleString()} − キャンセル料 ¥${fee.toLocaleString()}(${rate}%) = 返金 ¥${refundActual.toLocaleString()}`,
    `💳 ${howRefunded}`,
  ].join("\n"), M.slack);

  console.log(`[cancel-confirm] ${resId} paid=${paid} fee=${fee}(${rate}%) refund=${refundActual} noCharge=${noCharge} auto=${doAuto} sq=${squareRefundId}`);
  return json({ ok: true, noCharge, rate, fee, refundSuggested: refund, refundRecorded: refundActual, paid, autoRefunded: !!squareRefundId, squareRefundId });
});
