// app-slack-post ─ アプリ内からのSlack投稿を"サーバ側"で中継する。
// 目的: クライアント(app.js)にSlack botトークンを埋めない（公開露出の根絶）。
// 認証: ログイン済みSupabaseユーザーのJWTを検証（authenticatedのみ許可）。
// 制限: 投稿先はホワイトリストのチャンネルのみ（濫用防止）。
// 秘密: SLACK_BOT_TOKEN は EF secret（クライアントには出さない）。
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const MAIN_URL = Deno.env.get("SUPABASE_URL") || "https://ckrxttbnawkclshczsia.supabase.co";
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
    const tok = auth.replace(/^Bearer\s+/i, "");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const uRes = await fetch(`${MAIN_URL}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${tok}` },
    });
    if (!uRes.ok) return j({ ok: false, error: "unauthorized" }, 401);
    const user = await uRes.json();
    if (!user || !user.id) return j({ ok: false, error: "unauthorized" }, 401);

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
    return j({ ok: false, error: String(e) }, 500);
  }
});
