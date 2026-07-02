// Supabase Edge Function: line-track
// driverページ「位置送信を開始」から呼ばれ、追跡URLを顧客LINEへ送信（お届け/回収）
// 認証: reservations.kd_driver_token と一致する driver token(d) を要求（FUNC_SECRETは公開ページに置かない）
// 実送信は line-push 経由（挨拶文/userId解決/設定ON-OFF/テストモード/誤送信ガード は line-push 側）
// KEYDROPは別LINE=除外。deploy: functions deploy line-track --no-verify-jwt （secret: FUNC_SECRET）

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST" } });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: any; try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const r = String(body.r || "").toUpperCase().trim();
  const d = String(body.d || "").trim();
  if (!r || !d) return json({ ok: false, error: "missing r/d" }, 400);

  // driverトークン照合（＝この予約の担当リンク保持者だけが発火できる）
  const rows = await (await fetch(`${SB_URL}/rest/v1/reservations?id=eq.${encodeURIComponent(r)}&kd_driver_token=eq.${encodeURIComponent(d)}&select=id,ota,kd_status,kd_track_token`, { headers: H })).json();
  const rec = rows[0];
  if (!rec) return json({ ok: false, reason: "invalid_driver_token" }, 401);
  if (rec.ota === "KEYDROP") return json({ ok: false, reason: "skipped_keydrop" });

  // ステータス→アクション/案内ページ
  let action = "", guide = "", head = "";
  if (rec.kd_status === "delivering") { action = "track_del"; guide = "handyman-delivery-guide.html"; head = "お届けに向かっております🚚\nスタッフの現在地と到着予定を下記URLからリアルタイムでご確認いただけます（アプリ不要）。"; }
  else if (rec.kd_status === "collecting") { action = "track_col"; guide = "handyman-collection-guide.html"; head = "お車の回収に向かっております🧭\nスタッフの現在地を下記URLからご確認いただけます（アプリ不要）。"; }
  else return json({ ok: false, reason: "not_in_delivery_or_collection:" + (rec.kd_status || "") });

  const tk = rec.kd_track_token || "";
  const url = `https://keydrop.jp/${guide}?r=${encodeURIComponent(r)}${tk ? "&t=" + encodeURIComponent(tk) : ""}`;
  const message = "【HANDYMAN 札幌】" + head + "\n" + url + "\n※「今いる場所を共有」を押していただくとスムーズに合流できます。";

  // 送信は line-push に委譲（挨拶/userId/設定/ガード/ログ）
  const pr = await fetch(`${SB_URL}/functions/v1/line-push`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: FUNC_SECRET, resv_no: r, action, message }),
  });
  const jr = await pr.json().catch(() => ({}));
  return json({ ok: jr.ok === true, action, via: "line-push", ...jr });
});
