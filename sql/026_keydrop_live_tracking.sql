-- ============================================================
-- KEYDROP 待ち合わせ位置連動 MVP（札幌＝reservations / お届け①）
-- Supabase: ckrxttbnawkclshczsia  ・  SQL Editor で1回 RUN
-- 追加のみ（既存列・予約/決済ロジックには影響なし）
-- ============================================================

-- 1) 予約テーブルに位置・トークン列を追加（札幌=reservations）
alter table reservations
  add column if not exists kd_track_token  text,          -- 顧客リンク用（読む＋自分の位置を書く権限）
  add column if not exists kd_driver_token text,          -- スタッフ用（車の位置を書く権限）
  add column if not exists kd_driver_lat   double precision,
  add column if not exists kd_driver_lng   double precision,
  add column if not exists kd_driver_at    timestamptz,
  add column if not exists kd_cust_lat     double precision,
  add column if not exists kd_cust_lng     double precision,
  add column if not exists kd_cust_at      timestamptz;

-- 2) 顧客：配達中の予約の「スタッフ位置・待ち合わせ住所」を読む（track_token照合）
create or replace function keydrop_track_get(p_res text, p_token text)
returns table(kd_status text, del_place text, cust_name text,
  driver_lat double precision, driver_lng double precision, driver_at timestamptz,
  cust_lat double precision, cust_lng double precision)
language sql security definer set search_path = public as $$
  select r.kd_status, r.del_place, r.name,
         r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at,
         r.kd_cust_lat, r.kd_cust_lng
  from reservations r
  where upper(r.id) = upper(p_res)
    and r.kd_track_token is not null
    and r.kd_track_token = p_token
$$;

-- 3) 顧客：自分の現在地を書く（任意の「現在地を共有」）
create or replace function keydrop_track_set_cust(p_res text, p_token text,
  p_lat double precision, p_lng double precision)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; begin
  update reservations
     set kd_cust_lat = p_lat, kd_cust_lng = p_lng, kd_cust_at = now()
   where upper(id) = upper(p_res)
     and kd_track_token is not null and kd_track_token = p_token;
  get diagnostics n = row_count; return n > 0;
end $$;

-- 4) スタッフ：車（自分）の現在地を書く（driver_token照合）
create or replace function keydrop_track_set_driver(p_res text, p_token text,
  p_lat double precision, p_lng double precision)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; begin
  update reservations
     set kd_driver_lat = p_lat, kd_driver_lng = p_lng, kd_driver_at = now()
   where upper(id) = upper(p_res)
     and kd_driver_token is not null and kd_driver_token = p_token;
  get diagnostics n = row_count; return n > 0;
end $$;

-- 5) スタッフ：お客様の位置・待ち合わせ住所を読む（driver_token照合）
create or replace function keydrop_track_get_staff(p_res text, p_token text)
returns table(kd_status text, del_place text, cust_name text,
  cust_lat double precision, cust_lng double precision, cust_at timestamptz)
language sql security definer set search_path = public as $$
  select r.kd_status, r.del_place, r.name,
         r.kd_cust_lat, r.kd_cust_lng, r.kd_cust_at
  from reservations r
  where upper(r.id) = upper(p_res)
    and r.kd_driver_token is not null
    and r.kd_driver_token = p_token
$$;

-- 6) anon/authenticated から RPC 実行可（テーブル直アクセスは付与しない＝トークンで限定）
grant execute on function
  keydrop_track_get(text,text),
  keydrop_track_set_cust(text,text,double precision,double precision),
  keydrop_track_set_driver(text,text,double precision,double precision),
  keydrop_track_get_staff(text,text)
to anon, authenticated;

-- 注：SECURITY DEFINER でRLSを跨ぐが、where 句で「id一致＋トークン一致」必須＝
--     正しいトークンを持つ当事者だけが自分の予約の位置のみ読み書きできる。
