// Supabase Edge Function: line-links-import
// エルメ受付フォーム回答CSV(userId↔予約番号)を spk_line_links へ取込（毎日の更新業務用アップローダーから呼ばれる）
// 認証: ログイン済みスタッフのアクセストークン(Authorization: Bearer <user jwt>)を /auth/v1/user で検証（anonは拒否）
// deploy: functions deploy line-links-import --no-verify-jwt （関数内でユーザ検証するため gateway JWT は無効化）

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  // ログイン済みスタッフ検証
  const auth = req.headers.get("authorization") || "";
  const ur = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!ur.ok) return j({ error: "unauthorized (ログインが必要です)" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.rows)) return j({ error: "rows がありません" }, 400);
  const store = (body.store === "nha") ? "nha" : "spk";
  const TABLE = `${store}_line_links`;

  // 予約番号・userId 必須。テスト/空は除外
  const clean = body.rows
    .filter((r: any) => r && r.resv_no && r.line_user_id && !/テスト|test/i.test(String(r.resv_no)))
    .map((r: any) => ({
      resv_no: String(r.resv_no).trim(),
      line_user_id: String(r.line_user_id).trim(),
      line_name: r.line_name || null, cust_name: r.cust_name || null, media: r.media || null,
      del_date: r.del_date || null, del_time: r.del_time || null, del_place: r.del_place || null,
      col_date: r.col_date || null, col_time: r.col_time || null, col_place: r.col_place || null,
      answer_id: r.answer_id ? Number(r.answer_id) : null,
      source: "csv_upload", updated_at: new Date().toISOString(),
    }));
  if (!clean.length) return j({ ok: true, count: 0, note: "有効行なし" });

  const resp = await fetch(`${SB_URL}/rest/v1/${TABLE}?on_conflict=resv_no`, {
    method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(clean),
  });
  if (!resp.ok) return j({ error: (await resp.text()).slice(0, 300) }, 500);
  return j({ ok: true, count: clean.length });
});
