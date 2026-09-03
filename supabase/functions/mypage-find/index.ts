// ============================================================
// mypage-find : 予約番号 ＋ 連絡先(メール/電話) の2点照合でマイページURLを返す
// ------------------------------------------------------------
// 2026-09-03 / rent-handyman.com ヘッダー「予約確認」入口用。
// 入口(公式サイト)で 予約番号+メール(または電話) を入力 → 一致した予約の
// マイページURL(mypage_token付き)を返す。フロントはそのURLへ遷移。
//
// 対応店舗(全店横断):
//   main DB(ckrxttbnawkclshczsia): reservations(札幌) / nha_reservations(那覇)
//   BT   DB(ggqugvyskyiblxiycpci): bt_reservations(高松)  ← cross-DB(BT_URL/BT_SERVICE_KEY)
//
// セキュリティ: 予約番号だけ・名前だけの列挙を防ぐため必ず「予約番号＋連絡先の両方一致」を要求。
//   一致しなければ理由を明かさず一律 {ok:false}。メール/電話などの中身は絶対に返さない(URLのみ)。
//   service_role で読むが token 以外は返さない(既存 mypage EF と同じ信頼モデル)。
// デプロイ: supabase functions deploy mypage-find --no-verify-jwt (main project)
//   要 secrets: BT_URL, BT_SERVICE_KEY (license-overdue-alert と同じ値でOK)
// ============================================================
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BT_URL = Deno.env.get("BT_URL") || "";
const BT_KEY = Deno.env.get("BT_SERVICE_KEY") || "";

function cors(o: string | null) {
  return { "Access-Control-Allow-Origin": o || "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Vary": "Origin" };
}
function json(b: unknown, s: number, o: string | null) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "content-type": "application/json" } }); }

async function sbGet(base: string, key: string, table: string, q: string): Promise<any[]> {
  try {
    const r = await fetch(`${base}/rest/v1/${table}?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) { console.error(`GET ${table}`, r.status, await r.text()); return []; }
    return await r.json();
  } catch (e) { console.error(`GET ${table}`, String(e)); return []; }
}

const norm = (s: string) => String(s || "").trim();
const lc = (s: string) => norm(s).toLowerCase();
const digits = (s: string) => String(s || "").replace(/[^0-9]/g, "");
// 電話の一致: 数字だけ比較。国番号 81→0 のゆれも吸収（末尾10桁比較でフォールバック）。
function telMatch(a: string, b: string): boolean {
  const x = digits(a), y = digits(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tail = (s: string) => s.replace(/^(0|81)/, "");
  return tail(x) === tail(y) || x.slice(-10) === y.slice(-10);
}

// 店舗定義: 検索するテーブルと、マイページURLの組み立て
const STORES = [
  { db: "main", table: "reservations",     url: (t: string) => `https://nosh2318.github.io/spk-task/my.html?t=${t}`,          label: "札幌" },
  { db: "main", table: "nha_reservations", url: (t: string) => `https://nosh2318.github.io/naha-project/my-nha.html?t=${t}`,  label: "那覇" },
  { db: "bt",   table: "bt_reservations",  url: (t: string) => `https://rent-handyman.com/my-tkm.html?t=${t}`,                label: "高松" },
];

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false }, 405, origin);

  let body: any = {};
  try { body = await req.json(); } catch { /* noop */ }
  if (body?.action === "ping") return json({ ok: true, warm: true }, 200, origin);

  const resvNo = norm(body?.resv_no);
  const contact = norm(body?.contact);
  // 両方必須・予約番号は4文字以上（総当り/列挙の抑止）
  if (resvNo.length < 4 || contact.length < 3) {
    return json({ ok: false, error: "invalid_input" }, 200, origin);
  }
  const isMail = contact.indexOf("@") >= 0;

  for (const st of STORES) {
    const base = st.db === "bt" ? BT_URL : SB_URL;
    const key = st.db === "bt" ? BT_KEY : SB_KEY;
    if (!base || !key) continue; // BT未設定なら高松はスキップ(安全)
    const rows = await sbGet(base, key, st.table, `id=eq.${encodeURIComponent(resvNo)}&select=id,mail,tel,name,mypage_token,status`);
    if (!rows || rows.length === 0) continue;
    const r = rows[0];
    if (!r.mypage_token) continue; // token未発行は開けない
    const ok = isMail ? (lc(r.mail) === lc(contact)) : telMatch(r.tel, contact);
    if (ok) {
      return json({ ok: true, url: st.url(String(r.mypage_token)), store: st.label }, 200, origin);
    }
  }
  // 一致なし: 理由を明かさない(どの店/どの項目が違うか返さない)
  return json({ ok: false, error: "not_found" }, 200, origin);
});
