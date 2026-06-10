-- ============================================================
-- 013 KEYDROP 予約RPC v2 日数を「暦日カウント」に修正
-- 2026-06-11 / omni
-- 不具合：日数 = ceil(時間/24) だと「6/13 22:00→6/14 10:00（12h）」が1日課金になる。
-- 仕様（オーナー）：日を跨いだら2日間。＝暦日差＋1（同日=1日 / 翌日=2日 / 翌々日=3日）。
-- 変更点は v_days の算出 1行のみ（クライアント getDayCount と一致）。他ロジックは012と同一。
-- per-day tier合算ループ（0..v_days-1）は v_lend::date+i で各暦日を正しく集計する。
-- ============================================================
create or replace function public.keydrop_book_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_class text := nullif(trim(p->>'vehicleClass'),'');
  v_model text := coalesce(trim(p->>'vehicleModel'),'');
  v_lend text := p->>'lend_date';
  v_ret  text := p->>'return_date';
  v_lendt text := coalesce(nullif(p->>'lend_time',''),'10:00');
  v_rett  text := coalesce(nullif(p->>'return_time',''),'10:00');
  v_code text; v_name text; v_id text; v_prefix text; v_max int; v_suffix text;
  v_assigned text := '未配車';
  v_cfg jsonb; v_prices jsonb; v_presets jsonb; v_default int;
  v_days int; v_class_total numeric := 0; v_tier int; v_md text; v_preset jsonb; v_i int;
  v_ins text := coalesce(p->>'insuranceType','none');
  v_cdw numeric := 0; v_seat numeric := 0; v_opt numeric := 0; v_total numeric := 0;
  v_ins_label text;
begin
  if v_class is null then return jsonb_build_object('error','クラス未指定'); end if;
  if v_lend is null or v_ret is null then return jsonb_build_object('error','日付未指定'); end if;
  perform pg_advisory_xact_lock(hashtext('keydrop_booking'));

  -- 日数 = 暦日差 + 1（日を跨いだら2日間・最低1日）。時刻は日数に影響しない。
  v_days := greatest(1, (v_ret::date - v_lend::date) + 1);

  -- クラス料金（価格マスターから tier×日 を合算）
  begin select value::jsonb into v_cfg from app_settings where key='hdm_keydrop_price'; exception when others then v_cfg:=null; end;
  if v_cfg is not null and (v_cfg ? 'prices') and (v_cfg->'prices' ? v_class) then
    v_prices  := v_cfg->'prices'->v_class;
    v_presets := coalesce(v_cfg->'presets','[]'::jsonb);
    v_default := coalesce((v_cfg->>'default')::int,1);
    for v_i in 0..(v_days-1) loop
      v_md := to_char((v_lend::date + v_i),'MM-DD');
      v_tier := v_default;
      for v_preset in select * from jsonb_array_elements(v_presets) loop
        if (v_preset->>'start') is null or (v_preset->>'end') is null then continue; end if;
        if (v_preset->>'start') <= (v_preset->>'end') then
          if v_md >= (v_preset->>'start') and v_md <= (v_preset->>'end') then v_tier:=(v_preset->>'tier')::int; exit; end if;
        else
          if v_md >= (v_preset->>'start') or v_md <= (v_preset->>'end') then v_tier:=(v_preset->>'tier')::int; exit; end if;
        end if;
      end loop;
      v_class_total := v_class_total + coalesce((v_prices->>v_tier)::numeric,0);
    end loop;
  else
    v_class_total := coalesce((p->>'base_price')::numeric,0); -- マスタ未設定時の保険
  end if;

  -- オプション（補償・シート）をサーバ計算
  v_cdw  := (case v_ins when 'pack' then 1650 when 'cdw' then 1100 else 0 end) * v_days;
  v_seat := coalesce((p->>'childSeat')::int,0)*1000 + coalesce((p->>'juniorSeat')::int,0)*500;
  v_opt  := v_cdw + v_seat;
  v_total := v_class_total + v_opt;
  v_ins_label := case v_ins when 'pack' then 'フル' when 'cdw' then '免責' else 'なし' end;

  -- 空き車両割当（表示/GASと同一の除外条件）
  select v.code, v.name into v_code, v_name from vehicles v
  where v.type=v_class and coalesce(v.insurance_veh,false)=false and coalesce(v.active,true)=true
    and ( v_model='' or upper(regexp_replace(coalesce(v.name,''),'[0-9①-⑩]+$',''))=upper(v_model)
          or replace(replace(upper(coalesce(v.name,'')),' ',''),'-','')=replace(replace(upper(v_model),' ',''),'-','') )
    and not exists (select 1 from vehicle_monthly_kpi k where k.vehicle_code=v.code and k.active=false
        and k.year_month in (select to_char(d,'YYYY-MM') from generate_series(date_trunc('month',v_lend::date),v_ret::date,interval '1 month') d))
    and not exists (select 1 from fleet f join reservations r on r.id=f.reservation_id where f.vehicle_code=v.code
        and coalesce(r.status,'') not in ('cancelled','キャンセル','cancel') and r.lend_date<=v_ret and r.return_date>=v_lend)
    and not exists (select 1 from maintenance m where m.vehicle_code=v.code and m.start_date<=v_ret and m.end_date>=v_lend)
  order by v.code limit 1;

  if v_code is null and coalesce((p->>'requireStock')::boolean,false) then
    return jsonb_build_object('error','ご希望の期間・クラスは満車です','soldOut',true);
  end if;

  -- 採番 KD-YYMM-NNNN-XXX
  v_prefix := 'KD-'||to_char(v_lend::date,'YYMM')||'-';
  select coalesce(max(nullif(split_part(substring(id from char_length(v_prefix)+1),'-',1),'')::int),0) into v_max from reservations where id like v_prefix||'%';
  v_suffix := '';
  for v_i in 1..3 loop v_suffix := v_suffix || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',1+floor(random()*31)::int,1); end loop;
  v_id := v_prefix||lpad((v_max+1)::text,4,'0')||'-'||v_suffix;

  insert into reservations
    (id,ota,vehicle,lend_date,return_date,lend_time,del_time,return_time,col_time,name,mail,tel,people,
     base_price,option_price,discount,price,status,insurance,del_place,col_place,visit_type,return_type)
  values
    (v_id,'KEYDROP',v_class,v_lend,v_ret,v_lendt,v_lendt,v_rett,v_rett,p->>'name',p->>'mail',p->>'tel',coalesce((p->>'people')::int,1),
     v_class_total,v_opt,0,v_total,'pending_payment',v_ins_label,
     coalesce(p->>'del_place',''),coalesce(p->>'col_place',''),coalesce(nullif(p->>'visit_type',''),'DEL'),coalesce(nullif(p->>'return_type',''),'COL'));

  if v_code is not null then insert into fleet (reservation_id,vehicle_code) values (v_id,v_code); v_assigned := coalesce(v_name,'')||'('||v_code||')'; end if;

  return jsonb_build_object('reservationId',v_id,'total',v_total,'classTotal',v_class_total,'options',v_opt,'days',v_days,'vehicleCode',v_code,'assigned',v_assigned,'status','pending_payment');
end; $$;
revoke all on function public.keydrop_book_v2(jsonb) from public, anon, authenticated;
