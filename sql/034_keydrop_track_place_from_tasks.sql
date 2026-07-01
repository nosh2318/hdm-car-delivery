-- 034: 追跡RPCの目的地(del/col_place)をOPシートと同じ解決式でtasksから取得
-- OPシートの最終受け皿: tasks の DEL/COL 行の「場所」= _placeSource='manual'?place:(changed_json._ssPlace||place)
-- reservations.del/col_place が空でも、tasks(DEL/COL)から正しい待ち合わせ場所を出す。
-- SPK=reservations+tasks / NHA=nha_reservations(場所はreservationsに入っている)。

-- OPシート準拠の場所解決（1タスク）
create or replace function _kd_task_place(p_res text, p_type text) returns text
language sql stable set search_path = public as $$
  select coalesce(
    case when coalesce((t.changed_json::jsonb)->>'_placeSource','')='manual'
         then nullif(t.place,'')
         else coalesce(nullif((t.changed_json::jsonb)->>'_ssPlace',''), nullif(t.place,'')) end
  , null)
  from tasks t
  where t.reservation_id = p_res and t.type = p_type
  order by (coalesce(nullif((t.changed_json::jsonb)->>'_ssPlace',''), nullif(t.place,'')) is not null) desc
  limit 1
$$;

-- スタッフ地図用（kd_driver_token）
create or replace function keydrop_track_get_staff(p_res text, p_token text)
returns table(kd_status text, del_place text, col_place text, cust_name text,
  cust_lat double precision, cust_lng double precision, cust_at timestamptz)
language sql security definer set search_path = public as $$
  select r.kd_status,
    coalesce(nullif(r.del_place,''), _kd_task_place(r.id,'DEL')) as del_place,
    coalesce(nullif(r.col_place,''), _kd_task_place(r.id,'COL'),
             (select nullif(t.col_place,'') from tasks t where t.reservation_id=r.id and coalesce(t.col_place,'')<>'' limit 1)) as col_place,
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
    coalesce(nullif(r.del_place,''), _kd_task_place(r.id,'COL'), _kd_task_place(r.id,'DEL')) as del_place,
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
