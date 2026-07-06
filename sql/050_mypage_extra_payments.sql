-- マイページ 追加決済（オプション/補償の差額）記録テーブル
-- 通常決済(OTA/JLN)とは別枠。督促時に「追加分が未決済か」を判別するための正本。
create table if not exists mypage_extra_payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id  text not null,
  store           text default 'spk',
  change_id       uuid,                 -- mypage_changes.id（承認元）
  kind            text,                 -- 'option' | 'insurance'
  detail          text,                 -- 例: オプション チャイルド0→2 / 補償 免責→NOC（3日）
  amount          int  not null,        -- 追加請求は正、返金は負
  direction       text not null,        -- 'charge' | 'refund'
  square_order_id text,
  square_url      text,
  status          text default 'unpaid',-- unpaid | paid | link_failed | refund_pending | refunded | cancelled
  paid_at         timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_mep_resv   on mypage_extra_payments(reservation_id);
create index if not exists idx_mep_status on mypage_extra_payments(status);

alter table mypage_extra_payments enable row level security;
-- 社内アプリ(authenticated)は読み書き可。anon(顧客)は不可＝EF(service_role)経由のみ書込。
drop policy if exists mep_auth_all on mypage_extra_payments;
create policy mep_auth_all on mypage_extra_payments for all to authenticated using (true) with check (true);
grant select, insert, update on mypage_extra_payments to authenticated;
