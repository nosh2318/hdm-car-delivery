// Supabase Edge Function: license-reminder-cron (札幌SPK / 那覇NHA 対応)
// 出発 3日前 / 2日前 / 前日 の朝に、免許証「未提出」の顧客へ
// 「円滑な貸出のための事前登録のお願い」を自動送信。各段階1回のみ（重複送信なし）。
//   HANDYMAN(SPK/NHA) = LINE(line-push経由) ／ KEYDROP(ota=KEYDROP) = メール(keydrop_notifications→keydrop-send-mail)
// 送信可否 = {store}_line_config.license_auto_enabled(既定 false)。文面確定までは false のまま＝一切送らない。
// pg_cron が x-cron-secret + body{store} で 1日1回(10:00 JST)起動。
// deploy: functions deploy license-reminder-cron --no-verify-jwt  (secrets: FUNC_SECRET, CRON_SECRET)

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbGet(p: string) { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); return r.ok ? await r.json() : []; }
function json(o: unknown) { return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } }); }
const enc = encodeURIComponent;

const STORES: Record<string, any> = {
  spk: { cfg: "spk_line_config", resv: "reservations", dateCol: "lend_date", sends: "spk_line_sends", licStore: "spk", myBase: "https://nosh2318.github.io/spk-task/my.html", licBase: "https://nosh2318.github.io/spk-task/license.html", brand: "HANDYMAN札幌" },
  nha: { cfg: "nha_line_config", resv: "nha_reservations", dateCol: "start_date", sends: "nha_line_sends", licStore: "nha", myBase: "https://nosh2318.github.io/naha-project/my-nha.html", licBase: "https://nosh2318.github.io/naha-project/license.html", brand: "HANDYMAN那覇" },
};

function template(offset: number, name: string, url: string, brand: string): string {
  const cn = (name || "") + "様";
  if (offset === 3) {
    return `【${brand}】${cn}\nご出発が近づいてまいりました。\n当日の受け渡しをスムーズに行うため、運転免許証の「事前ご登録」にご協力をお願いいたします。\n運転される方 全員分（表面）を、下記から事前にご登録いただくと当日のお手続きがスムーズです。\n（アプリ不要・スマホで撮影→送信）\n${url}\nご不明点は本メッセージにご返信ください。`;
  }
  if (offset === 2) {
    return `【${brand}】${cn}\nご出発2日前となりました。\n当日スムーズにお車をお渡しできるよう、運転免許証の事前ご登録がお済みでない方はご登録をお願いいたします。\n運転される方 全員分（表面）\n${url}`;
  }
  return `【${brand}】${cn}\nいよいよ明日がご出発です。\n当日の受け渡しを円滑にするため、運転免許証の事前ご登録をお願いいたします（まだお済みでないようです）。\n※事前登録がお済みでないと、当日お時間をいただく場合がございます。\n${url}`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("unauthorized", { status: 401 });
  let store = "spk";
  try { const b = await req.json(); if (b && b.store === "nha") store = "nha"; } catch { /* default spk */ }
  const S = STORES[store];

  const cfg = (await sbGet(`${S.cfg}?id=eq.1&select=*`))[0] || {};
  const testMode = cfg.test_mode === true;
  if (cfg.license_auto_enabled !== true && !testMode) return json({ ok: true, store, skipped: "disabled" });

  const nowJST = new Date(Date.now() + 9 * 3600 * 1000);
  const dstr = (off: number) => new Date(nowJST.getTime() + off * 86400000).toISOString().slice(0, 10);

  const results: any[] = [];
  for (const offset of [3, 2, 1]) {
    const target = dstr(offset);
    const resvs = await sbGet(`${S.resv}?${S.dateCol}=eq.${target}&select=id,name,status,mypage_token,mail,ota`);
    const alive = (resvs as any[]).filter((r) => {
      const st = String(r.status || "").toLowerCase();
      return r.id && !st.includes("cancel") && !st.includes("キャンセル");
    });
    if (!alive.length) { results.push({ offset, target, candidates: 0 }); continue; }

    const ids = alive.map((r) => r.id);
    // 免許証 提出済み（license_uploads store一致 cnt>0）を除外
    const done = await sbGet(`license_uploads?store=eq.${S.licStore}&reservation_id=in.(${ids.map(enc).join(",")})&select=reservation_id,cnt`);
    const doneSet = new Set((done as any[]).filter((x) => (x.cnt || 0) > 0).map((x) => x.reservation_id));
    // 既送信を除外＝この段階(license_auto_d{offset}) OR スタッフ手動リマインド(license_reminder: sent/manual_done)
    const action = `license_auto_d${offset}`;
    const sent = await sbGet(`${S.sends}?action=in.(${action},license_reminder)&resv_no=in.(${ids.map(enc).join(",")})&select=resv_no,status,action`);
    const sentSet = new Set((sent as any[]).filter((s) => s.action === action || s.status === "sent" || s.status === "manual_done").map((s) => s.resv_no));

    let attempted = 0, ok = 0, mailed = 0;
    for (const r of alive) {
      if (doneSet.has(r.id) || sentSet.has(r.id)) continue;
      attempted++;
      const isKD = String(r.ota || "").toUpperCase() === "KEYDROP";
      if (isKD) {
        // KEYDROP＝メール（Resend）。keydrop_notifications にキュー投入→keydrop-send-mailワーカーが送信。
        if (!r.mail || String(r.mail).indexOf("@") < 0) continue;
        try {
          const pr = await fetch(`${SB_URL}/rest/v1/keydrop_notifications`, {
            method: "POST", headers: { ...H, Prefer: "return=minimal" },
            body: JSON.stringify({ type: "license_reminder", reservation_id: r.id, to_email: r.mail, store: S.licStore, payload: { name: r.name || "", offset, mypage_token: r.mypage_token || "" } }),
          });
          if (pr.ok) {
            mailed++;
            await fetch(`${SB_URL}/rest/v1/${S.sends}`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ resv_no: r.id, action, status: "sent", message: "KEYDROPメール" }) });
          }
        } catch (_) { /* 次回cronで再試行 */ }
        continue;
      }
      // HANDYMAN＝LINE（line-push経由）。マイページtokenURL（免許証アップ内包）優先、無ければ免許証直リンク。
      const url = r.mypage_token ? `${S.myBase}?t=${enc(r.mypage_token)}` : `${S.licBase}?id=${enc(r.id)}&name=${enc(r.name || "")}`;
      const msg = template(offset, r.name, url, S.brand);
      try {
        const pr = await fetch(`${SB_URL}/functions/v1/line-push`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: FUNC_SECRET, store, resv_no: r.id, action, message: msg }),
        });
        const jr = await pr.json().catch(() => ({}));
        if (jr && jr.ok) ok++;
      } catch (_) { /* line-push側でログ済み */ }
    }
    results.push({ offset, target, candidates: alive.length, attempted, sent: ok, mailed });
  }
  return json({ ok: true, store, test: testMode, results });
});
