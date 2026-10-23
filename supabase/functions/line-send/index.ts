// 2026-10-23 新API鍵移行：新形式の鍵を優先し、無ければ旧鍵（移行期間の保険・旧鍵の無効化前に外す）
function __newKey(env: string, name: string): string { try { return (JSON.parse(Deno.env.get(env) || "{}") as Record<string, string>)[name] || ""; } catch { return ""; } }
console.log("[keymig]", __newKey("SUPABASE_PUBLISHABLE_KEYS", "default") ? "publishable" : "legacy");
// Supabase Edge Function: line-send
// アプリのボタンからLINE送信するための汎用ブリッジ（到着通知・決済・免許証依頼 等）
// 認証: ログイン済みスタッフのアクセストークン(Authorization: Bearer <user jwt>)を /auth/v1/user で検証
// body: { store('spk'|'nha'), resv_no, action, message } → line-push へ委譲
// deploy: functions deploy line-send --no-verify-jwt （secret: FUNC_SECRET）

const SB_URL = Deno.env.get("SUPABASE_URL")!;
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
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ ok: false, error: "POST only" }, 405);
  // スタッフ認証
  const auth = req.headers.get("authorization") || "";
  const ur = await staffUser(auth);
  if (!ur) return j({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || !body.resv_no || !body.action || !body.message) return j({ ok: false, error: "missing params" }, 400);
  const store = body.store === "nha" ? "nha" : "spk";

  const pr = await fetch(`${SB_URL}/functions/v1/line-push`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: FUNC_SECRET, store, resv_no: String(body.resv_no), action: String(body.action), message: String(body.message) }),
  });
  const jr = await pr.json().catch(() => ({}));
  return j(jr, pr.ok ? 200 : 502);
});
