-- 040: HANDYMAN 統合マイページ（全予約ユニークURL）土台
-- 目的: 全予約(OTA/HP不問)に token を発行し、顧客が自分の予約を1画面で閲覧/変更。
--   変更は必ず監査ログ(mypage_changes)に追記＝上書き・消失しても検出&復元できる保険。
--   mypage_locked＝顧客が確定した項目の印。GAS再取込/タスク自動生成はこの印の項目を上書きしない(protect相乗り)。
-- 対象: 札幌(reservations) 先行。那覇(nha_reservations)は後追いで同型追加。

-- 1) 予約ごとのユニークtoken（公開しない・LINE個別送信のみ）。既存行にも自動発行。
alter table reservations add column if not exists mypage_token uuid unique default gen_random_uuid();
update reservations set mypage_token = gen_random_uuid() where mypage_token is null;

-- 2) 顧客が確定した項目の印（{ "del_place": {"at":"...","by":"customer"} } 形式）
alter table reservations add column if not exists mypage_locked jsonb not null default '{}'::jsonb;

-- 3) 変更監査ログ（追記専用・復元用の保険）
create table if not exists mypage_changes (
  id            bigint generated always as identity primary key,
  reservation_id text not null,
  store         text not null default 'spk',
  field         text not null,           -- del_place/col_place/lend_time/return_time/people/opt_c ...
  old_value     text,
  new_value     text,
  source        text not null default 'customer', -- customer / staff
  actor         text,                    -- 変更者(スタッフ名/顧客)
  status        text not null default 'applied',  -- applied / requested / approved / rejected / reverted
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists mypage_changes_res_idx on mypage_changes(reservation_id, created_at desc);
create index if not exists mypage_changes_status_idx on mypage_changes(status, created_at desc);

-- RLS: サービスロール(Edge Function)のみ書込。authenticated(本体ログイン=管理画面)は読取可。
alter table mypage_changes enable row level security;
drop policy if exists mypage_changes_read on mypage_changes;
create policy mypage_changes_read on mypage_changes for select to authenticated using (true);
