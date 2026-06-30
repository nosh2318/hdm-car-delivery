-- 033: KEYDROP/HANDYMAN スタッフ追跡RPCを 札幌(reservations)＋那覇(nha_reservations) 両対応に
-- 背景: 026の4関数が reservations のみ参照→那覇予約(nha_reservations)の追跡が動かなかった。
-- SELECTはUNION ALL、UPDATEは両テーブル更新して合算行数で判定（該当する1テーブルだけヒット）。

-- 既存関数の戻り型が異なる場合があるため先にDROP（grantは末尾で再付与）
drop function if exists keydrop_track_get(text,text);
drop function if exists keydrop_track_set_cust(text,text,double precision,double precision);
drop function if exists keydrop_track_set_driver(text,text,double precision,double precision);
drop function if exists keydrop_track_get_staff(text,text);

-- 1) お客様→ドライバー位置取得（cust_token=kd_track_token）
create or replace function keydrop_track_get(p_res text, p_token text)
returns table(kd_status text, del_place text, cust_name text,
  driver_lat double precision, driver_lng double precision, driver_at timestamptz,
  cust_lat double precision, cust_lng double precision)
language sql security definer set search_path = public as $$
  select r.kd_status, r.del_place, r.name,
         r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at, r.kd_cust_lat, r.kd_cust_lng
  from reservations r
  where upper(r.id)=upper(p_res) and r.kd_track_token is not null and r.kd_track_token=p_token
  union all
  select r.kd_status, r.del_place, r.name,
         r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at, r.kd_cust_lat, r.kd_cust_lng
  from nha_reservations r
  where upper(r.id)=upper(p_res) and r.kd_track_token is not null and r.kd_track_token=p_token
$$;

-- 2) お客様 現在地セット（kd_track_token）
create or replace function keydrop_track_set_cust(p_res text, p_token text,
  p_lat double precision, p_lng double precision)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; m int; begin
  update reservations set kd_cust_lat=p_lat, kd_cust_lng=p_lng, kd_cust_at=now()
   where upper(id)=upper(p_res) and kd_track_token is not null and kd_track_token=p_token;
  get diagnostics n = row_count;
  update nha_reservations set kd_cust_lat=p_lat, kd_cust_lng=p_lng, kd_cust_at=now()
   where upper(id)=upper(p_res) and kd_track_token is not null and kd_track_token=p_token;
  get diagnostics m = row_count;
  return (n+m) > 0;
end $$;

-- 3) スタッフ(ドライバー) 現在地セット（kd_driver_token）
create or replace function keydrop_track_set_driver(p_res text, p_token text,
  p_lat double precision, p_lng double precision)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; m int; begin
  update reservations set kd_driver_lat=p_lat, kd_driver_lng=p_lng, kd_driver_at=now()
   where upper(id)=upper(p_res) and kd_driver_token is not null and kd_driver_token=p_token;
  get diagnostics n = row_count;
  update nha_reservations set kd_driver_lat=p_lat, kd_driver_lng=p_lng, kd_driver_at=now()
   where upper(id)=upper(p_res) and kd_driver_token is not null and kd_driver_token=p_token;
  get diagnostics m = row_count;
  return (n+m) > 0;
end $$;

-- 4) スタッフ地図用 取得（kd_driver_token・col_place込み）
create or replace function keydrop_track_get_staff(p_res text, p_token text)
returns table(kd_status text, del_place text, col_place text, cust_name text,
  cust_lat double precision, cust_lng double precision, cust_at timestamptz)
language sql security definer set search_path = public as $$
  select r.kd_status, r.del_place, r.col_place, r.name, r.kd_cust_lat, r.kd_cust_lng, r.kd_cust_at
  from reservations r
  where upper(r.id)=upper(p_res) and r.kd_driver_token is not null and r.kd_driver_token=p_token
  union all
  select r.kd_status, r.del_place, r.col_place, r.name, r.kd_cust_lat, r.kd_cust_lng, r.kd_cust_at
  from nha_reservations r
  where upper(r.id)=upper(p_res) and r.kd_driver_token is not null and r.kd_driver_token=p_token
$$;

grant execute on function
  keydrop_track_get(text,text),
  keydrop_track_set_cust(text,text,double precision,double precision),
  keydrop_track_set_driver(text,text,double precision,double precision),
  keydrop_track_get_staff(text,text)
to anon, authenticated;
