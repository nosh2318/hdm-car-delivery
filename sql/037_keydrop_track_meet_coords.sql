-- 037: 追跡RPCに「顧客がマイページの地図でピン留めした座標(del_lat/del_lng・col_lat/col_lng)」を追加。
-- 目的: 追跡3ページ(track/handyman-track/handyman-driver)で、del_placeテキストをジオコードする前に
--       正本の座標を最優先で使えるようにする（便名ノイズ・地名にならない語(自宅/ホテル単体等)での誤爆を根絶）。
-- 方針: del_place/col_placeの解決ロジックは現行(live)を1文字も変えない。coord列を末尾に追加するだけ。
--       状態連動: collecting/returning=col_lat/col_lng / それ以外(delivering等)=del_lat/del_lng。

-- お客様地図用（kd_track_token）: meet_lat/meet_lng を追加
drop function if exists keydrop_track_get(text,text);
create or replace function keydrop_track_get(p_res text, p_token text)
returns table(kd_status text, del_place text, cust_name text,
  driver_lat double precision, driver_lng double precision, driver_at timestamptz,
  cust_lat double precision, cust_lng double precision,
  meet_lat double precision, meet_lng double precision)
language sql security definer set search_path = public as $$
  select r.kd_status,
    case when r.kd_status in ('collecting','returning')
      then coalesce(_kd_task_place(r.id,'COL'),
             (select nullif(t.col_place,'') from tasks t where t.reservation_id=r.id and coalesce(t.col_place,'')<>'' limit 1),
             nullif(r.col_place,''))
      else coalesce(_kd_task_place(r.id,'DEL'), nullif(r.del_place,''))
    end as del_place,
    r.name, r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at, r.kd_cust_lat, r.kd_cust_lng,
    case when r.kd_status in ('collecting','returning') then r.col_lat else r.del_lat end as meet_lat,
    case when r.kd_status in ('collecting','returning') then r.col_lng else r.del_lng end as meet_lng
  from reservations r
  where upper(r.id)=upper(p_res) and r.kd_track_token is not null and r.kd_track_token=p_token
  union all
  select r.kd_status,
    case when r.kd_status in ('collecting','returning')
      then coalesce(nullif(r.col_place,''), nullif(r.del_place,''))
      else coalesce(nullif(r.del_place,''), nullif(r.col_place,''))
    end as del_place,
    r.name, r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at, r.kd_cust_lat, r.kd_cust_lng,
    case when r.kd_status in ('collecting','returning') then r.col_lat else r.del_lat end as meet_lat,
    case when r.kd_status in ('collecting','returning') then r.col_lng else r.del_lng end as meet_lng
  from nha_reservations r
  where upper(r.id)=upper(p_res) and r.kd_track_token is not null and r.kd_track_token=p_token
$$;
grant execute on function keydrop_track_get(text,text) to anon, authenticated;

-- スタッフ地図用（kd_driver_token）: del_lat/del_lng・col_lat/col_lng を追加（ドライバーページが状態で選ぶ）
drop function if exists keydrop_track_get_staff(text,text);
create or replace function keydrop_track_get_staff(p_res text, p_token text)
returns table(kd_status text, del_place text, col_place text, cust_name text,
  cust_lat double precision, cust_lng double precision, cust_at timestamptz,
  del_lat double precision, del_lng double precision, col_lat double precision, col_lng double precision)
language sql security definer set search_path = public as $$
  select r.kd_status,
    coalesce(nullif(r.del_place,''), _kd_task_place(r.id,'DEL')) as del_place,
    coalesce(nullif(r.col_place,''), _kd_task_place(r.id,'COL'),
             (select nullif(t.col_place,'') from tasks t where t.reservation_id=r.id and coalesce(t.col_place,'')<>'' limit 1)) as col_place,
    r.name, r.kd_cust_lat, r.kd_cust_lng, r.kd_cust_at,
    r.del_lat, r.del_lng, r.col_lat, r.col_lng
  from reservations r
  where upper(r.id)=upper(p_res) and r.kd_driver_token is not null and r.kd_driver_token=p_token
  union all
  select r.kd_status, r.del_place, r.col_place, r.name, r.kd_cust_lat, r.kd_cust_lng, r.kd_cust_at,
    r.del_lat, r.del_lng, r.col_lat, r.col_lng
  from nha_reservations r
  where upper(r.id)=upper(p_res) and r.kd_driver_token is not null and r.kd_driver_token=p_token
$$;
grant execute on function keydrop_track_get_staff(text,text) to anon, authenticated;
