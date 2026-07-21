// Supabase Edge Function: license-reminder-cron (札幌 SPK 専用)
// 出発 3日前 / 2日前 / 前日 の朝に、免許証「未提出」かつLINE連携済みの顧客へ
// 「円滑な貸出のための事前登録のお願い」を自動送信（line-push経由）。各段階1回のみ（重複送信なし）。
// 送信可否 = spk_line_config.license_auto_enabled(既定 false)。文面確定までは false のまま＝一切送らない。
// pg_cron が x-cron-secret で 1日1回(10:00 JST)起動。KEYDROP等はline-push側のリンク有無で自然にフィルタ。
// deploy: functions deploy license-reminder-cron --no-verify-jwt  (secrets: FUNC_SECRET, CRON_SECRET)

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const LIC_BASE = "https://nosh2318.github.io/spk-task/license.html";
const MY_BASE = "https://nosh2318.github.io/spk-task/my.html";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbGet(p: string) { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); return r.ok ? await r.json() : []; }
function json(o: unknown) { return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } }); }
const enc = encodeURIComponent;

// 段階別テンプレ（円滑な貸出＝事前登録がおすすめ という前向きトーン）
function template(offset: number, name: string, url: string): string {
  const cn = (name || "") + "様";
  if (offset === 3) {
    return `【HANDYMAN札幌】${cn}\nご出発が近づいてまいりました。\n当日の受け渡しをスムーズに行うため、運転免許証の「事前ご登録」にご協力をお願いいたします。\n運転される方 全員分（表面）を、下記から事前にご登録いただくと当日のお手続きがスムーズです。\n（アプリ不要・スマホで撮影→送信）\n${url}\nご不明点は本メッセージにご返信ください。`;
  }
  if (offset === 2) {
    return `【HANDYMAN札幌】${cn}\nご出発2日前となりました。\n当日スムーズにお車をお渡しできるよう、運転免許証の事前ご登録がお済みでない方はご登録をお願いいたします。\n運転される方 全員分（表面）\n${url}`;
  }
  return `【HANDYMAN札幌】${cn}\nいよいよ明日がご出発です。\n当日の受け渡しを円滑にするため、運転免許証の事前ご登録をお願いいたします（まだお済みでないようです）。\n※事前登録がお済みでないと、当日お時間をいただく場合がございます。\n${url}`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("unauthorized", { status: 401 });

  const cfg = (await sbGet(`spk_line_config?id=eq.1&select=*`))[0] || {};
  const testMode = cfg.test_mode === true;
  if (cfg.license_auto_enabled !== true && !testMode) return json({ ok: true, skipped: "disabled" });

  const nowJST = new Date(Date.now() + 9 * 3600 * 1000);
  const dstr = (off: number) => new Date(nowJST.getTime() + off * 86400000).toISOString().slice(0, 10);

  const results: any[] = [];
  for (const offset of [3, 2, 1]) {
    const target = dstr(offset);
    // 対象＝その日に出発する予約（キャンセル除外）
    const resvs = await sbGet(`reservations?lend_date=eq.${target}&select=id,name,status,lend_date,mypage_token,mail,ota`);
    const alive = (resvs as any[]).filter((r) => {
      const st = String(r.status || "").toLowerCase();
      return r.id && !st.includes("cancel") && !st.includes("キャンセル");
    });
    if (!alive.length) { results.push({ offset, target, candidates: 0 }); continue; }

    const ids = alive.map((r) => r.id);
    // 免許証 提出済み（license_uploads cnt>0）を除外
    const done = await sbGet(`license_uploads?reservation_id=in.(${ids.map(enc).join(",")})&select=reservation_id,cnt`);
    const doneSet = new Set((done as any[]).filter((x) => (x.cnt || 0) > 0).map((x) => x.reservation_id));
    // 既送信を除外＝この段階の自動送信済(license_auto_d{offset}) OR スタッフが手動リマインド対応済(license_reminder: sent/manual_done)＝二重送信防止
    const action = `license_auto_d${offset}`;
    const sent = await sbGet(`spk_line_sends?action=in.(${action},license_reminder)&resv_no=in.(${ids.map(enc).join(",")})&select=resv_no,status,action`);
    const sentSet = new Set((sent as any[]).filter((s) => s.action === action || s.status === "sent" || s.status === "manual_done").map((s) => s.resv_no));

    let attempted = 0, ok = 0, mailed = 0;
    for (const r of alive) {
      if (doneSet.has(r.id) || sentSet.has(r.id)) continue;
      attempted++;
      const isKD = String(r.ota || "").toUpperCase() === "KEYDROP";
      if (isKD) {
        // KEYDROP＝メール（Resend）で送る。keydrop_notifications にキュー投入→keydrop-send-mailワーカーが送信。
        if (!r.mail || String(r.mail).indexOf("@") < 0) continue; // メール無しは送れない＝スキップ
        try {
          const pr = await fetch(`${SB_URL}/rest/v1/keydrop_notifications`, {
            method: "POST", headers: { ...H, Prefer: "return=minimal" },
            body: JSON.stringify({ type: "license_reminder", reservation_id: r.id, to_email: r.mail, store: "spk", payload: { name: r.name || "", offset, mypage_token: r.mypage_token || "" } }),
          });
          if (pr.ok) {
            mailed++;
            // 二重送信防止のため送信台帳(spk_line_sends)にも記録（LINEと共通のdedup）
            await fetch(`${SB_URL}/rest/v1/spk_line_sends`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ resv_no: r.id, action, status: "sent", message: "KEYDROPメール" }) });
          }
        } catch (_) { /* 次回cronで再試行 */ }
        continue;
      }
      // HANDYMAN＝LINE（line-push経由）。マイページtokenURL（免許証アップ内包）優先、無ければ免許証直リンク。
      const url = r.mypage_token ? `${MY_BASE}?t=${enc(r.mypage_token)}` : `${LIC_BASE}?id=${enc(r.id)}&name=${enc(r.name || "")}`;
      const msg = template(offset, r.name, url);
      try {
        const pr = await fetch(`${SB_URL}/functions/v1/line-push`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: FUNC_SECRET, store: "spk", resv_no: r.id, action, message: msg }),
        });
        const jr = await pr.json().catch(() => ({}));
        if (jr && jr.ok) ok++;
      } catch (_) { /* line-push側でログ済み */ }
    }
    results.push({ offset, target, candidates: alive.length, attempted, sent: ok, mailed });
  }
  return json({ ok: true, test: testMode, results });
});
