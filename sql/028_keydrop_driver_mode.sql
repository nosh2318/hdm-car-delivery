-- 028 KEYDROP 回収時のスタッフ移動手段（徒歩/キックボード/自転車/回収車）
-- お客様地図のスタッフピンを、向かっている手段に応じて 🚶/🛴/🚲/🚗 に切替える。
-- ★順序安全：このSQL未適用でも HTML 側はフォールバック(🚶)で動作する（破壊なし）。
-- 値は安定キー: walk / kick / bike / car

alter table reservations     add column if not exists kd_driver_mode text;
alter table nha_reservations add column if not exists kd_driver_mode text;

-- スタッフ：移動手段を保存（driver_token照合・両店union）
create or replace function keydrop_track_set_mode(p_res text, p_token text, p_mode text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; m text;
begin
  m := case lower(coalesce(p_mode,''))
         when 'walk' then 'walk' when 'kick' then 'kick'
         when 'bike' then 'bike' when 'car'  then 'car' else null end;
  if m is null then return false; end if;
  update reservations set kd_driver_mode = m
   where upper(id)=upper(p_res) and kd_driver_token is not null and kd_driver_token = p_token;
  get diagnostics n = row_count;
  if n = 0 then
    update nha_reservations set kd_driver_mode = m
     where upper(id)=upper(p_res) and kd_driver_token is not null and kd_driver_token = p_token;
    get diagnostics n = row_count;
  end if;
  return n > 0;
end $$;

-- お客様：移動手段を読む（track_token照合・両店union）
create or replace function keydrop_track_get_mode(p_res text, p_token text)
returns text language sql security definer set search_path = public as $$
  select u.kd_driver_mode from (
    select id, kd_track_token, kd_driver_mode from reservations
    union all
    select id, kd_track_token, kd_driver_mode from nha_reservations
  ) u
  where upper(u.id)=upper(p_res) and u.kd_track_token is not null and u.kd_track_token = p_token
  limit 1;
$$;

grant execute on function keydrop_track_set_mode(text,text,text),
                          keydrop_track_get_mode(text,text)
  to anon, authenticated;

-- 注：回収完了(COL ✅) で kd_status が collecting でなくなると地図OFF。
--     お届け(delivery)は常に車のため mode は無視し track.html で🚗固定。
