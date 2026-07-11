// Supabase Edge Function: keydrop-returnday
// KEYDROP予約の「返却日の朝(8時以降)」に、返却のご案内＋早め回収ボタンの訴求を【メールで】1回だけ送る。
//   keydrop_notifications に type=returnday を enqueue → keydrop-send-mail が Resend でメール送信。
// 対象: reservations(ota=KEYDROP・spk) と nha_reservations(ota=KEYDROP・nha)。キャンセル除外・token/メール必須。
// dedup: keydrop_notifications に type=returnday 行があれば処理済み。
// 起動: pg_cron が x-cron-secret 付きで叩く（*/30）。POST {test:true} で 8時ゲート無視のドライ確認。
// deploy: functions deploy keydrop-returnday --no-verify-jwt / secrets: CRON_SECRET

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sbGet(p: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H });
  return r.ok ? await r.json() : [];
}
async function sbPost(p: string, b: unknown) {
  return fetch(`${SB_URL}/rest/v1/${p}`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(b) });
}

Deno.serve(async (req) => {
  const sec = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || sec !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const testMode = body.test === true;

  const nowJ = new Date(Date.now() + 9 * 3600 * 1000);
  const today = nowJ.toISOString().slice(0, 10);
  const hh = nowJ.getUTCHours(); // JST hour
  // 9時ゲート（8時=傷チェックメールと被らせないため。日帰りでも 8時=傷チェック / 9時=返却案内 に分離）
  if (hh < 9 && !testMode) {
    return new Response(JSON.stringify({ ok: true, skipped: "before_9am_jst", hh }), { headers: { "content-type": "application/json" } });
  }

  const stores = [
    { key: "spk", resv: "reservations", colCol: "return_date", sel: "id,name,mail,mypage_token,status,return_time,col_time" },
    { key: "nha", resv: "nha_reservations", colCol: "end_date", sel: "id,name,mail,mypage_token,status,col_time" },
  ];
  const out: any[] = [];

  for (const s of stores) {
    const resvs = await sbGet(`${s.resv}?ota=eq.KEYDROP&${s.colCol}=eq.${today}&select=${s.sel}&limit=300`);
    for (const r of resvs) {
      const st = String(r.status || "").toLowerCase();
      if (st.includes("cancel") || st.includes("キャンセル")) continue;
      if (!r.mypage_token) continue;
      if (!r.mail || String(r.mail).indexOf("@") < 0) { out.push({ id: r.id, store: s.key, ch: "none", reason: "no_email" }); continue; }

      // dedup（メールenqueue済みなら何もしない）
      const prior = await sbGet(`keydrop_notifications?reservation_id=eq.${encodeURIComponent(r.id)}&type=eq.returnday&select=id&limit=1`);
      if (prior[0]) continue;
      if (testMode) { out.push({ id: r.id, store: s.key, ch: "dry" }); continue; }

      await sbPost("keydrop_notifications", {
        type: "returnday", reservation_id: r.id, to_email: r.mail, store: s.key, sent: false,
        payload: { name: r.name || "", return_time: r.return_time || "", col_time: r.col_time || "", mypage_token: r.mypage_token },
      });
      out.push({ id: r.id, store: s.key, ch: "email" });
    }
  }

  return new Response(JSON.stringify({ ok: true, today, processed: out.length, detail: out }), { headers: { "content-type": "application/json" } });
});
