// 2026-10-23 新API鍵移行：新形式の鍵を優先し、無ければ旧鍵（移行期間の保険・旧鍵の無効化前に外す）
function __newKey(env: string, name: string): string { try { return (JSON.parse(Deno.env.get(env) || "{}") as Record<string, string>)[name] || ""; } catch { return ""; } }
console.log("[keymig]", __newKey("SUPABASE_SECRET_KEYS", "edge") ? "secret" : "legacy");
// Supabase Edge Function: line-links-import
// エルメ受付フォーム回答CSV(userId↔予約番号)を spk_line_links へ取込（毎日の更新業務用アップローダーから呼ばれる）
// 認証: ログイン済みスタッフのアクセストークン(Authorization: Bearer <user jwt>)を /auth/v1/user で検証（anonは拒否）
// deploy: functions deploy line-links-import --no-verify-jwt （関数内でユーザ検証するため gateway JWT は無効化）

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = (__newKey("SUPABASE_SECRET_KEYS", "edge") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const ANON = (__newKey("SUPABASE_PUBLISHABLE_KEYS", "default") || Deno.env.get("SUPABASE_ANON_KEY"))!;
// ★security 2026-10-23 スタッフ許可リスト：「ログインしていれば誰でも」→ 正規スタッフのメールドメインだけ通す。
//   main(ckrxttbnawkclshczsia) の auth.users ドメイン＝spk.hdm/nha.hdm/g-lines.jp/partner.hdm（2026-10-23確認）。協力会社 partner.hdm は不可。新規登録は無効(disable_signup=true)のためドメインで判定できる。EF は個別デプロイなので各 EF に同じ小関数をコピー。
const STAFF_EMAIL_RE = /@(spk\.hdm|nha\.hdm|g-lines\.jp)$/i;
async function staffUser(token: string): Promise<{ id: string; email: string } | null> {
  const t = String(token || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${t}` } });
    if (!r.ok) return null;
    const u: any = await r.json().catch(() => null);
    const email = String(u?.email || "").trim();
    if (!u?.id || !STAFF_EMAIL_RE.test(email)) return null;
    return { id: String(u.id), email };
  } catch (_) { return null; }
}
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  // ログイン済みスタッフ検証
  const auth = req.headers.get("authorization") || "";
  const ur = await staffUser(auth);
  if (!ur) return j({ error: "unauthorized (ログインが必要です)" }, 401);

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

  // 同一CSV内で予約番号が重複すると upsert が 21000(ON CONFLICT ...second time) で全体失敗する。
  // 予約番号ごとに最新(answer_id が大きい=後の回答)を残して1行に畳んでから送る。
  const byResv = new Map<string, any>();
  for (const r of clean) {
    const prev = byResv.get(r.resv_no);
    if (!prev || (Number(r.answer_id) || 0) >= (Number(prev.answer_id) || 0)) byResv.set(r.resv_no, r);
  }
  const deduped = Array.from(byResv.values());

  const resp = await fetch(`${SB_URL}/rest/v1/${TABLE}?on_conflict=resv_no`, {
    method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(deduped),
  });
  if (!resp.ok) return j({ error: (await resp.text()).slice(0, 300) }, 500);
  return j({ ok: true, count: deduped.length });
});
