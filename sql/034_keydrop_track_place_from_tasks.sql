-- 034: スタッフ/お客様 追跡RPCの目的地(del/col_place)を、reservationsが空ならtasksから補完
-- 背景: OPシートは tasks に場所を保存するが reservations.del/col_place は空のまま→RPCが目的地を取れず地図にゴールが出なかった。
-- SPK=reservations+tasks / NHA=nha_reservations(既に場所が入っているのでそのまま)。

-- スタッフ地図用（kd_driver_token）
create or replace function keydrop_track_get_staff(p_res text, p_token text)
returns table(kd_status text, del_place text, col_place text, cust_name text,
  cust_lat double precision, cust_lng double precision, cust_at timestamptz)
language sql security definer set search_path = public as $$
  select r.kd_status,
    coalesce(nullif(r.del_place,''),
      (select t.place from tasks t where t.reservation_id=r.id and coalesce(t.place,'')<>'' limit 1)) as del_place,
    coalesce(nullif(r.col_place,''),
      (select t.col_place from tasks t where t.reservation_id=r.id and coalesce(t.col_place,'')<>'' limit 1),
      (select t.place from tasks t where t.reservation_id=r.id and t.type='COL' and coalesce(t.place,'')<>'' limit 1)) as col_place,
    r.name, r.kd_cust_lat, r.kd_cust_lng, r.kd_cust_at
  from reservations r
  where upper(r.id)=upper(p_res) and r.kd_driver_token is not null and r.kd_driver_token=p_token
  union all
  select r.kd_status, r.del_place, r.col_place, r.name, r.kd_cust_lat, r.kd_cust_lng, r.kd_cust_at
  from nha_reservations r
  where upper(r.id)=upper(p_res) and r.kd_driver_token is not null and r.kd_driver_token=p_token
$$;

-- お客様地図用（kd_track_token）
create or replace function keydrop_track_get(p_res text, p_token text)
returns table(kd_status text, del_place text, cust_name text,
  driver_lat double precision, driver_lng double precision, driver_at timestamptz,
  cust_lat double precision, cust_lng double precision)
language sql security definer set search_path = public as $$
  select r.kd_status,
    coalesce(nullif(r.del_place,''),
      (select t.col_place from tasks t where t.reservation_id=r.id and coalesce(t.col_place,'')<>'' limit 1),
      (select t.place from tasks t where t.reservation_id=r.id and coalesce(t.place,'')<>'' limit 1)) as del_place,
    r.name, r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at, r.kd_cust_lat, r.kd_cust_lng
  from reservations r
  where upper(r.id)=upper(p_res) and r.kd_track_token is not null and r.kd_track_token=p_token
  union all
  select r.kd_status, r.del_place, r.name,
    r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at, r.kd_cust_lat, r.kd_cust_lng
  from nha_reservations r
  where upper(r.id)=upper(p_res) and r.kd_track_token is not null and r.kd_track_token=p_token
$$;

grant execute on function keydrop_track_get_staff(text,text) to anon, authenticated;
grant execute on function keydrop_track_get(text,text) to anon, authenticated;
