// 2026-10-23 新API鍵移行：新形式の鍵を優先し、無ければ旧鍵（移行期間の保険・旧鍵の無効化前に外す）
function __newKey(env: string, name: string): string { try { return (JSON.parse(Deno.env.get(env) || "{}") as Record<string, string>)[name] || ""; } catch { return ""; } }
console.log("[keymig]", __newKey("SUPABASE_PUBLISHABLE_KEYS", "default") ? "publishable" : "legacy");
// app-slack-post ─ アプリ内からのSlack投稿を"サーバ側"で中継する。
// 目的: クライアント(app.js)にSlack botトークンを埋めない（公開露出の根絶）。
// 認証: ログイン済みSupabaseユーザーのJWTを検証（authenticatedのみ許可）。
// 制限: 投稿先はホワイトリストのチャンネルのみ（濫用防止）。
// 秘密: SLACK_BOT_TOKEN は EF secret（クライアントには出さない）。
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const MAIN_URL = Deno.env.get("SUPABASE_URL") || "https://ckrxttbnawkclshczsia.supabase.co";
// ★security 2026-10-23 スタッフ許可リスト：「ログインしていれば誰でも」→ 正規スタッフのメールドメインだけ通す。
//   main(ckrxttbnawkclshczsia) の auth.users ドメイン＝spk.hdm/nha.hdm/g-lines.jp/partner.hdm（2026-10-23確認）。協力会社 partner.hdm は不可。新規登録は無効(disable_signup=true)のためドメインで判定できる。EF は個別デプロイなので各 EF に同じ小関数をコピー。
const STAFF_EMAIL_RE = /@(spk\.hdm|nha\.hdm|g-lines\.jp)$/i;
async function staffUser(token: string): Promise<{ id: string; email: string } | null> {
  const t = String(token || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  try {
    const r = await fetch(`${MAIN_URL}/auth/v1/user`, { headers: { apikey: (__newKey("SUPABASE_PUBLISHABLE_KEYS", "default") || Deno.env.get("SUPABASE_ANON_KEY")) || "", Authorization: `Bearer ${t}` } });
    if (!r.ok) return null;
    const u: any = await r.json().catch(() => null);
    const email = String(u?.email || "").trim();
    if (!u?.id || !STAFF_EMAIL_RE.test(email)) return null;
    return { id: String(u.id), email };
  } catch (_) { return null; }
}
// 許可チャンネル（オイル交換アラート等の運用通知）。必要に応じ追加。
const ALLOW_CH = new Set([
  "C06L91W6T08", // #okinawa_operations-team
]);
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o || "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

serve(async (req) => {
  const o = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(o) });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json" } });
  try {
    // ① ログインユーザー検証（静的な共有秘密を使わない＝クライアントに秘密を置かない）
    const auth = req.headers.get("authorization") || "";
    const user = await staffUser(auth); // ★security 2026-10-23 スタッフ許可リスト
    if (!user) return j({ ok: false, error: "unauthorized" }, 401);

    // ② 入力（チャンネルはホワイトリストのみ）
    const body = await req.json().catch(() => ({}));
    const channel = String(body.channel || "");
    const text = String(body.text || "").slice(0, 3500);
    if (!ALLOW_CH.has(channel)) return j({ ok: false, error: "channel_not_allowed" }, 403);
    if (!text.trim()) return j({ ok: false, error: "empty_text" }, 400);

    // ③ サーバ側トークンで投稿
    const slackTok = Deno.env.get("SLACK_BOT_TOKEN") || "";
    if (!slackTok) return j({ ok: false, error: "no_slack_token" }, 500);
    const sRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${slackTok}` },
      body: JSON.stringify({ channel, text, mrkdwn: true }),
    });
    const sJson = await sRes.json().catch(() => ({}));
    return j({ ok: !!sJson.ok, slack: sJson.ok ? "sent" : (sJson.error || "err") });
  } catch (e) {
    console.error("[app-slack-post]", String(e));
    return j({ ok: false, error: "server_error" }, 500);
  }
});
