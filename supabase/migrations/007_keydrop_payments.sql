-- ============================================================
-- 007 KEYDROP 決済記録テーブル（Square Phase B）
-- 2026-06-10 / omni
-- 役割:
--   ・予約(pending_payment)とSquare決済リンク/注文を1:1で突合する台帳。
--   ・webhook冪等性（同じ入金イベントが複数回来ても二重処理しない）の根拠。
--   ・★売上の正本は reservations.price。このテーブルには会計起票しない
--     （spk_accountingへ起票すると二重計上＝AIスタッフ_G事故と同型。絶対しない）。
-- 状態: pending（リンク発行済・未入金）→ paid（入金確認）/ failed。
-- アクセス: anon/authenticated 不可。Edge Function(service_role)のみ。
-- ============================================================

create table if not exists public.keydrop_payments (
  reservation_id        text primary key,
  square_order_id       text,
  square_payment_link_id text,
  payment_url           text,
  amount                numeric not null default 0,
  status                text not null default 'pending',  -- pending | paid | failed
  square_payment_id     text,
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- ※予約完了メール等の送信管理は 008 の通知キュー(keydrop_notifications)で行う（本表には持たせない）

create index if not exists idx_keydrop_payments_order on public.keydrop_payments (square_order_id);
create index if not exists idx_keydrop_payments_status on public.keydrop_payments (status);

-- updated_at 自動更新
create or replace function public.keydrop_payments_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_keydrop_payments_touch on public.keydrop_payments;
create trigger trg_keydrop_payments_touch before update on public.keydrop_payments
  for each row execute function public.keydrop_payments_touch();

-- RLS: 公開ロールは一切不可（service_role のみが触る）
alter table public.keydrop_payments enable row level security;
-- ポリシーを作らない＝anon/authenticated は全拒否。service_role はRLSをバイパス。
revoke all on public.keydrop_payments from anon, authenticated;
