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
  const reqAction = String(body.action || "track").trim();
  if (!r || !d) return json({ ok: false, error: "missing r/d" }, 400);

  // 予約がどちらの予約表にあるか＝店舗を自動判定（driverページは共有のため）
  const sel = "select=id,ota,kd_status,kd_track_token,name";
  let store = "spk";
  let rows = await sbGet(`reservations?id=eq.${encodeURIComponent(r)}&kd_driver_token=eq.${encodeURIComponent(d)}&${sel}`);
  let rec = rows[0];
  if (!rec) {
    store = "nha";
    rows = await sbGet(`nha_reservations?id=eq.${encodeURIComponent(r)}&kd_driver_token=eq.${encodeURIComponent(d)}&${sel}`);
    rec = rows[0];
  }
  if (!rec) return json({ ok: false, reason: "invalid_driver_token" }, 401);

  // ★到着通知：driverページの「到着」ボタンから {r,d,action:'arrival'} で呼ばれる
  //   OPシート／タスクサマリーの「到着」ボタンと同機能に揃える（本文にナンバー／KEYDROPはメール／OP到着済みバッジ連動）
  if (reqAction === "arrival") {
    const cn = (rec.name ? String(rec.name).trim() : "") + "様";
    const isKD = String(rec.ota || "") === "KEYDROP";
    const delivering = rec.kd_status === "delivering";
    const collecting = rec.kd_status === "collecting" || rec.kd_status === "returning";
    if (!delivering && !collecting) return json({ ok: false, reason: "not_in_delivery_or_collection:" + (rec.kd_status || "") });

    // お届け到着メッセージ用のナンバー（OPと同じくタスクの plate_no を使う）
    let plate = "";
    if (delivering) {
      try {
        if (store === "nha") {
          const t = await sbGet(`nha_tasks?${encodeURIComponent("予約番号")}=eq.${encodeURIComponent(r)}&${encodeURIComponent("内容")}=eq.DEL&select=No&limit=1`);
          plate = (t[0] && t[0]["No"]) ? String(t[0]["No"]).trim() : "";
        } else {
          const t = await sbGet(`tasks?reservation_id=eq.${encodeURIComponent(r)}&type=eq.DEL&select=plate_no&limit=1`);
          plate = (t[0] && t[0].plate_no) ? String(t[0].plate_no).trim() : "";
        }
      } catch (_) { /* ナンバー取得失敗時は本文に含めない */ }
    }

    const pushAction = delivering ? "arrival" : "col_arrival";
    const msg = delivering
      ? `【車両到着のお知らせ】\n${cn}\n\nお待たせいたしました。只今スタッフが到着いたしました。\nご準備整い次第、受け取り対応をお願いいたします。 引き続きどうぞ宜しくお願い申し上げます。` + (plate ? `\n\n対象車両のナンバーは ${plate} でございます。` : "")
      : `【ご返却場所到着のお知らせ】\n${cn}\n\n回収スタッフがご返却場所に到着致しました。\nご準備できましたら対応のほどお願い申しあげます。\n何卒よろしくお願いいたします。`;

    // KEYDROP予約＝メール（OPと同じ keydrop_enqueue_button）／それ以外＝LINE(line-push)
    if (isKD) {
      const kind = delivering ? "arrive_del" : "arrive_col";
      const kb = delivering ? { p_resv: r, p_kind: kind, p_plate: plate } : { p_resv: r, p_kind: kind };
      let kok = false;
      try {
        const kr = await fetch(`${SB_URL}/rest/v1/rpc/keydrop_enqueue_button`, { method: "POST", headers: H, body: JSON.stringify(kb) });
        const kd = await kr.json().catch(() => null);
        kok = (kd === "ok");
      } catch (_) { /* ignore */ }
      // OP到着済みバッジ同期（keydrop_enqueue_button は line_sends に残さないため補記）
      if (kok) {
        try { await fetch(`${SB_URL}/rest/v1/${store}_line_sends`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ resv_no: r, action: pushAction, status: "manual_done", message: "到着(KEYDROPメール)" }) }); } catch (_) { /* ignore */ }
      }
      return json({ ok: kok, store, action: pushAction, via: "keydrop-mail" });
    }

    // LINE送信（line-push が ${store}_line_sends に status=sent で記録＝OP到着済みバッジも自動連動）
    const pr = await fetch(`${SB_URL}/functions/v1/line-push`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: FUNC_SECRET, store, resv_no: r, action: pushAction, message: msg }),
    });
    const jr = await pr.json().catch(() => ({}));
    return json({ ok: jr.ok === true, store, action: pushAction, via: "line-push", ...jr });
  }

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
