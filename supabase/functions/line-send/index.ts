// Supabase Edge Function: line-send
// アプリのボタンからLINE送信するための汎用ブリッジ（到着通知・決済・免許証依頼 等）
// 認証: ログイン済みスタッフのアクセストークン(Authorization: Bearer <user jwt>)を /auth/v1/user で検証
// body: { store('spk'|'nha'), resv_no, action, message } → line-push へ委譲
// deploy: functions deploy line-send --no-verify-jwt （secret: FUNC_SECRET）

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ ok: false, error: "POST only" }, 405);
  // スタッフ認証
  const auth = req.headers.get("authorization") || "";
  const ur = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!ur.ok) return j({ ok: false, error: "unauthorized" }, 401);

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
