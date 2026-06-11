-- ============================================================
-- 020 KEYDROP 那覇拡張: 共有台帳に store 列を追加
-- 2026-06-11 / omni
-- keydrop_payments / keydrop_notifications は札幌・那覇 共有。store で店舗を識別する。
-- 既存行は札幌(spk)とみなす(default 'spk')。Edge Functionが新規行に store を付与し、
-- 承認UI(SPK/NHAアプリ)は store でフィルタする。
-- 予約IDは札幌=KD- / 那覇=KDN- 接頭辞で自己識別もできる(二重の安全)。
-- ============================================================
alter table public.keydrop_payments      add column if not exists store text not null default 'spk';
alter table public.keydrop_notifications  add column if not exists store text not null default 'spk';

create index if not exists idx_keydrop_payments_store on public.keydrop_payments(store);

-- 確認: select store, count(*) from keydrop_payments group by store;
