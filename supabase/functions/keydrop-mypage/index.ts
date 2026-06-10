// ============================================================
// keydrop-mypage : 顧客のマイページ（予約確認・キャンセル）を安全に提供
// 2026-06-10 / omni
// ・anon に reservations を直READ/PATCH させない（PII漏洩・他人予約キャンセルを防止）
// ・本人確認＝「予約番号 + 登録メール」の両方一致を必須（片方だけでは何も返さない）
// ・service_role は Edge Function 内のみ
// ============================================================

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);

  let p: any;
  try { p = await req.json(); } catch { return json({ error: "invalid json" }, 400, origin); }

  const action = String(p.action || "").trim();
  const mail = String(p.mail || "").trim().toLowerCase();
  const resId = String(p.resId || p.reservationId || "").trim();

  // 本人確認：予約番号 + メール の両方必須（片方だけでは何も返さない＝総当たり/PII漏洩防止）
  if (!mail || mail.indexOf("@") < 0) return json({ error: "メールアドレスが必要です" }, 400, origin);
  if (!resId) return json({ error: "予約番号が必要です" }, 400, origin);

  // 予約を1件だけ取得（id一致 かつ mail一致 のときのみ）
  const rows = await sbGet(
    "reservations",
    `id=eq.${encodeURIComponent(resId)}&select=id,ota,vehicle,lend_date,return_date,name,mail,tel,people,price,status,insurance,del_place,col_place`,
  );
  const r = rows[0];
  if (!r || String(r.mail || "").trim().toLowerCase() !== mail) {
    // 一致しなければ存在を明かさず一律エラー
    return json({ error: "予約番号またはメールアドレスが一致しません" }, 404, origin);
  }

  if (action === "lookup") {
    const fleet = await sbGet("fleet", `reservation_id=eq.${encodeURIComponent(resId)}&select=vehicle_code`);
    return json({
      ok: true,
      reservation: {
        id: r.id, vehicle: r.vehicle, lend_date: r.lend_date, return_date: r.return_date,
        name: r.name, people: r.people, price: r.price, status: r.status,
        insurance: r.insurance, del_place: r.del_place, col_place: r.col_place,
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

  return json({ error: "不正なアクション" }, 400, origin);
});
