-- マイページ領収書の発行記録（2026-11-08・HDM 那覇/札幌/高松 共通・main DB に1つ）
-- 1予約につき「有効な領収書」は1枚だけ（部分ユニーク索引で DB が止める）。出し直しは古い方を void にしてから新しい番号で作る。
create table if not exists public.mypage_receipts (
  id bigserial primary key,
  receipt_no text generated always as ((case store when 'nha' then 'NHA' when 'spk' then 'SPK' when 'tkm' then 'TKM' else upper(store) end) || '-' || lpad(id::text, 6, '0')) stored unique,
  store text not null check (store in ('nha','spk','tkm')),
  reservation_id text not null,
  addressee text not null,
  honorific text not null default '様',
  amount integer not null check (amount > 0),
  tax integer not null,
  purpose text not null default 'レンタカーご利用料金として',
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'issued' check (status in ('issued','void')),
  issued_at timestamptz not null default now(),
  issued_by text not null default 'guest',
  reissue_of text,
  voided_at timestamptz,
  void_reason text,
  view_count integer not null default 0,
  last_viewed_at timestamptz
);
create unique index if not exists mypage_receipts_one_active on public.mypage_receipts (store, reservation_id) where status = 'issued';
create index if not exists mypage_receipts_res on public.mypage_receipts (store, reservation_id);
alter table public.mypage_receipts enable row level security;
revoke all on public.mypage_receipts from anon, authenticated;
revoke all on sequence public.mypage_receipts_id_seq from anon, authenticated;

create or replace function public.mypage_receipt_viewed(p_id bigint) returns void
language sql security definer set search_path to 'public' as $$
  update mypage_receipts set view_count = view_count + 1, last_viewed_at = now() where id = p_id;
$$;
revoke all on function public.mypage_receipt_viewed(bigint) from public, anon, authenticated;
