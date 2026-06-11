-- ============================================================
-- 022 KEYDROP TOPデザイン A/B 切替（パターン1/2）
-- 2026-06-12 / omni
-- keydrop.jp の入口(エリア選択画面)のデザインを app_settings で 1⇄2 に切替。
-- SPKアプリTOPのトグルがこの値を書き換え、顧客LPは公開ビューから読む。
-- ============================================================
insert into public.app_settings (key, value)
values ('hdm_keydrop_top_pattern', '2')
on conflict (key) do nothing;  -- 既存があれば尊重（既定=パターン2）

create or replace view public.public_keydrop_top_v
  with (security_invoker = off) as
  select value from public.app_settings where key = 'hdm_keydrop_top_pattern';

grant select on public.public_keydrop_top_v to anon;

-- 確認: select * from public_keydrop_top_v;
