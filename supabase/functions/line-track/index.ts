// Supabase Edge Function: line-track (店舗自動判定: spk / nha)
// driverページ「位置送信を開始」から {r,d} で呼ばれ、追跡URLを顧客LINEへ送信（お届け/回収）
// driverページは札幌/那覇共有。予約IDがどちらの予約表にあるかで店舗を自動判定。
// 実送信は line-push 経由（挨拶/userId/設定/ガード/ログ）。deploy: --no-verify-jwt（secret: FUNC_SECRET）

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbGet(p: string) { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); return r.ok ? await r.json() : []; }
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST" } });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: any; try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const r = String(body.r || "").toUpperCase().trim();
  const d = String(body.d || "").trim();
  if (!r || !d) return json({ ok: false, error: "missing r/d" }, 400);

  // 予約がどちらの予約表にあるか＝店舗を自動判定（driverページは共有のため）
  const sel = "select=id,ota,kd_status,kd_track_token";
  let store = "spk";
  let rows = await sbGet(`reservations?id=eq.${encodeURIComponent(r)}&kd_driver_token=eq.${encodeURIComponent(d)}&${sel}`);
  let rec = rows[0];
  if (!rec) {
    store = "nha";
    rows = await sbGet(`nha_reservations?id=eq.${encodeURIComponent(r)}&kd_driver_token=eq.${encodeURIComponent(d)}&${sel}`);
    rec = rows[0];
  }
  if (!rec) return json({ ok: false, reason: "invalid_driver_token" }, 401);

  let action = "", guide = "", head = "";
  if (rec.kd_status === "delivering") { action = "track_del"; guide = "handyman-delivery-guide.html"; head = "お届けに向かっております🚚\nスタッフの現在地と到着予定を下記URLからリアルタイムでご確認いただけます（アプリ不要）。"; }
  else if (rec.kd_status === "collecting") { action = "track_col"; guide = "handyman-collection-guide.html"; head = "お車の回収に向かっております🧭\nスタッフの現在地を下記URLからご確認いただけます（アプリ不要）。"; }
  else return json({ ok: false, reason: "not_in_delivery_or_collection:" + (rec.kd_status || "") });

  const tk = rec.kd_track_token || "";
  const url = `https://keydrop.jp/${guide}?r=${encodeURIComponent(r)}${tk ? "&t=" + encodeURIComponent(tk) : ""}`;
  // ★Layer4: 顧客RPCと同じ解決で目的地を取得し本文に明記（地図＋テキストの二重・食い違い検知）
  let placeLine = "";
  try {
    const trk = await (await fetch(`${SB_URL}/rest/v1/rpc/keydrop_track_get`, { method: "POST", headers: H, body: JSON.stringify({ p_res: r, p_token: tk }) })).json();
    const place = (trk && trk[0] && trk[0].del_place) ? String(trk[0].del_place).trim() : "";
    if (place) placeLine = "\n" + (action === "track_col" ? "回収先" : "お届け先") + "：" + place;
  } catch (_) { /* 取得失敗時は場所行なし（誤った場所は出さない） */ }
  const message = "【HANDYMAN " + (store === "nha" ? "那覇" : "札幌") + "】" + head + placeLine + "\n" + url + "\n※「今いる場所を共有」を押していただくとスムーズに合流できます。";

  const pr = await fetch(`${SB_URL}/functions/v1/line-push`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: FUNC_SECRET, store, resv_no: r, action, message }),
  });
  const jr = await pr.json().catch(() => ({}));
  return json({ ok: jr.ok === true, store, action, via: "line-push", ...jr });
});
