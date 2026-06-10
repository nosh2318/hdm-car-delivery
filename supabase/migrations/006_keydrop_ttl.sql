-- ============================================================
-- 006 KEYDROP 未決済予約の TTL（在庫を食わせない・幽霊予約掃除）
-- 2026-06-10 / omni
-- pending_payment のまま p_minutes 超過した KEYDROP予約を cancelled にし、fleet割当を解放。
-- ※決済成立後は status='confirmed' になる想定（Square webhook）。confirmed は対象外＝消えない。
-- ============================================================

create or replace function public.keydrop_expire_pending(p_minutes int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int := 0;
begin
  -- 期限切れ未決済の fleet 割当を解放
  delete from fleet f
   using reservations r
   where f.reservation_id = r.id
     and r.ota = 'KEYDROP'
     and r.status = 'pending_payment'
     and r.created_at < now() - make_interval(mins => p_minutes);
  -- 予約を cancelled に
  update reservations
     set status = 'cancelled'
   where ota = 'KEYDROP'
     and status = 'pending_payment'
     and created_at < now() - make_interval(mins => p_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.keydrop_expire_pending(int) from public, anon, authenticated;

-- pg_cron で5分毎に実行（30分超の未決済を解放）
create extension if not exists pg_cron;

-- 既存スケジュールがあれば消してから再登録（冪等）
do $$
begin
  perform cron.unschedule('keydrop-expire-pending');
exception when others then null;
end $$;

select cron.schedule('keydrop-expire-pending', '*/5 * * * *', $$ select public.keydrop_expire_pending(30) $$);
