// Supabase Edge Function: damage-check-cron
// HANDYMAN札幌: DEL出発の約30分前に、割当車両の傷チェックURLを対象顧客へ自動送信
// pg_cron が x-cron-secret 付きで 5分毎に起動。実送信は line-push 経由（安全ガード/設定/テストモードは line-push 側）
// COL・洗車は対象外（DELのみ）。KEYDROPは別LINE=除外。
// deploy: supabase functions deploy damage-check-cron --no-verify-jwt
//   secrets: FUNC_SECRET, CRON_SECRET（LINE_CHANNEL_TOKEN等はline-push側）

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNC_SECRET = Deno.env.get("FUNC_SECRET")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const DMG_BASE = "https://nosh2318.github.io/handyman-damage/v.html";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
async function sbGet(p: string) { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); return r.ok ? await r.json() : []; }
function json(o: unknown) { return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("unauthorized", { status: 401 });

  const cfg = (await sbGet(`spk_line_config?id=eq.1&select=*`))[0] || {};
  // 本番OFF かつ テストモードOFF なら何もしない（無駄打ち/ログスパム防止）
  if (cfg.damage_enabled !== true && cfg.test_mode !== true) return json({ ok: true, skipped: "disabled" });
  const lead = cfg.lead_min || 30;

  const nowJST = new Date(Date.now() + 9 * 3600 * 1000);
  const today = nowJST.toISOString().slice(0, 10);
  const nowMin = nowJST.getUTCHours() * 60 + nowJST.getUTCMinutes();

  // 今日の未完了DELタスク（時刻あり・予約紐付きあり）
  const tasks = await sbGet(`tasks?date=eq.${today}&type=eq.DEL&done=eq.false&reservation_id=not.is.null&select=reservation_id,time,assigned_vehicle,ota`);
  const cands = (tasks as any[]).filter((t) => {
    if (t.ota === "KEYDROP") return false;
    if (!t.time || !/^\d{1,2}:\d{2}/.test(t.time)) return false;
    const [h, m] = t.time.split(":").map(Number);
    const until = (h * 60 + m) - nowMin;
    return until > 0 && until <= lead; // 出発まで lead(30)分以内 かつ 未来
  });
  if (!cands.length) return json({ ok: true, candidates: 0 });

  // 既に damage_check 送信済み(sent)は除外（重複送信防止）
  const resvList = cands.map((t) => t.reservation_id);
  const sent = await sbGet(`spk_line_sends?action=eq.damage_check&status=eq.sent&resv_no=in.(${resvList.map(encodeURIComponent).join(",")})&select=resv_no`);
  const sentSet = new Set((sent as any[]).map((s) => s.resv_no));

  // 車両の傷チェック共有トークン
  const vcodes = [...new Set(cands.map((t) => t.assigned_vehicle).filter(Boolean))];
  const tokenMap: Record<string, string> = {};
  if (vcodes.length) {
    const tw = await sbGet(`vehicle_twins?id=in.(${vcodes.map(encodeURIComponent).join(",")})&share_enabled=eq.true&select=id,share_token`);
    (tw as any[]).forEach((v) => { tokenMap[v.id] = v.share_token; });
  }

  const results: any[] = [];
  for (const t of cands) {
    if (sentSet.has(t.reservation_id)) continue;
    const tok = tokenMap[t.assigned_vehicle];
    if (!tok) { results.push({ resv: t.reservation_id, skip: "no_dmg_token" }); continue; }
    const url = `${DMG_BASE}?t=${tok}&v=v3`;
    const msg = "【HANDYMAN 札幌】ご利用車両 傷チェックのご案内\nまもなくお届けです🚗\nご出発前に、車両の状態を下記URLからご確認ください（アプリ不要）。\n" + url + "\n気になる点がございましたら車両引き渡し時に担当スタッフまでお申し付けくださいませ。\n※ご出発後の申告は対応いたしかねる場合がございます。";
    const r = await fetch(`${SB_URL}/functions/v1/line-push`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: FUNC_SECRET, resv_no: t.reservation_id, action: "damage_check", message: msg }),
    });
    const jr = await r.json().catch(() => ({}));
    results.push({ resv: t.reservation_id, ...jr });
  }
  return json({ ok: true, processed: results.length, results });
});
