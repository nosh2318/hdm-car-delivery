-- 036: 顧客追跡RPC keydrop_track_get の目的地(del_place)を kd_status 連動に修正。
-- 重大バグ: 旧 del_place = coalesce(_kd_task_place(COL), _kd_task_place(DEL), ...) で
--   お届け中(delivering)でも回収場所(COL)を先に表示 → お客様が回収先で待つ事故(2026-07-03 R0CYV6NR)。
-- 修正: お届け中=DEL場所 / 回収・返却中=COL場所（スタッフRPCと同じ解決順）。del↔colの取り違えを排除。

create or replace function keydrop_track_get(p_res text, p_token text)
returns table(kd_status text, del_place text, cust_name text,
  driver_lat double precision, driver_lng double precision, driver_at timestamptz,
  cust_lat double precision, cust_lng double precision)
language sql security definer set search_path = public as $$
  select r.kd_status,
    case when r.kd_status in ('collecting','returning')
      then coalesce(_kd_task_place(r.id,'COL'),
             (select nullif(t.col_place,'') from tasks t where t.reservation_id=r.id and coalesce(t.col_place,'')<>'' limit 1),
             nullif(r.col_place,''))
      else coalesce(_kd_task_place(r.id,'DEL'), nullif(r.del_place,''))
    end as del_place,
    r.name, r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at, r.kd_cust_lat, r.kd_cust_lng
  from reservations r
  where upper(r.id)=upper(p_res) and r.kd_track_token is not null and r.kd_track_token=p_token
  union all
  select r.kd_status,
    case when r.kd_status in ('collecting','returning')
      then coalesce(nullif(r.col_place,''), nullif(r.del_place,''))
      else coalesce(nullif(r.del_place,''), nullif(r.col_place,''))
    end as del_place,
    r.name, r.kd_driver_lat, r.kd_driver_lng, r.kd_driver_at, r.kd_cust_lat, r.kd_cust_lng
  from nha_reservations r
  where upper(r.id)=upper(p_res) and r.kd_track_token is not null and r.kd_track_token=p_token
$$;

grant execute on function keydrop_track_get(text,text) to anon, authenticated;
