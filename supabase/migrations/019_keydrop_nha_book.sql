-- ============================================================
-- 019 KEYDROP 那覇(NHA) 予約RPC: keydrop_book_nha(p jsonb)
-- 2026-06-11 / omni
-- 013 の keydrop_book_v2(札幌) を那覇テーブルへ複製・適合。共用化せず別関数にした理由:
--   nha_reservations は列名が違う(start_date/end_date/start_time/end_time/vehicle_class)。
--   dynamic SQL を避け、静的に那覇テーブルへ直書きする方が安全。
-- 価格= nha_app_settings.hdm_keydrop_price / 在庫= nha_vehicles・nha_vehicle_monthly_kpi
--      ・nha_fleet⋈nha_reservations・nha_maintenance / 採番接頭辞= KDN-。
-- 日数= 暦日差+1（札幌と同一仕様・getDayCountと一致）。金額はサーバ確定（偽装防止）。
-- ============================================================
create or replace function public.keydrop_book_nha(p jsonb)
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
  perform pg_advisory_xact_lock(hashtext('keydrop_booking_nha'));

  -- 日数 = 暦日差 + 1（日を跨いだら2日間・最低1日）。時刻は日数に影響しない。
  v_days := greatest(1, (v_ret::date - v_lend::date) + 1);

  -- クラス料金（那覇の価格マスターから tier×日 を合算）
  begin select value::jsonb into v_cfg from nha_app_settings where key='hdm_keydrop_price'; exception when others then v_cfg:=null; end;
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

  -- 空き車両割当（那覇テーブル・表示/GASと同一の除外条件）
  select v.code, v.name into v_code, v_name from nha_vehicles v
  where v.type=v_class and coalesce(v.insurance_veh,false)=false and coalesce(v.active,true)=true
    and ( v_model='' or upper(regexp_replace(coalesce(v.name,''),'[0-9①-⑩]+$',''))=upper(v_model)
          or replace(replace(upper(coalesce(v.name,'')),' ',''),'-','')=replace(replace(upper(v_model),' ',''),'-','') )
    and not exists (select 1 from nha_vehicle_monthly_kpi k where k.vehicle_code=v.code and k.active=false
        and k.year_month in (select to_char(d,'YYYY-MM') from generate_series(date_trunc('month',v_lend::date),v_ret::date,interval '1 month') d))
    and not exists (select 1 from nha_fleet f join nha_reservations r on r.id=f.reservation_id where f.vehicle_code=v.code
        and coalesce(r.status,'') not in ('cancelled','キャンセル','cancel') and r.start_date<=v_ret and r.end_date>=v_lend)
    and not exists (select 1 from nha_maintenance m where m.vehicle_code=v.code and m.start_date<=v_ret and m.end_date>=v_lend)
  order by v.code limit 1;

  if v_code is null and coalesce((p->>'requireStock')::boolean,false) then
    return jsonb_build_object('error','ご希望の期間・クラスは満車です','soldOut',true);
  end if;

  -- 採番 KDN-YYMM-NNNN-XXX（那覇接頭辞・共有台帳PK衝突回避）
  v_prefix := 'KDN-'||to_char(v_lend::date,'YYMM')||'-';
  select coalesce(max(nullif(split_part(substring(id from char_length(v_prefix)+1),'-',1),'')::int),0) into v_max from nha_reservations where id like v_prefix||'%';
  v_suffix := '';
  for v_i in 1..3 loop v_suffix := v_suffix || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',1+floor(random()*31)::int,1); end loop;
  v_id := v_prefix||lpad((v_max+1)::text,4,'0')||'-'||v_suffix;

  -- nha_reservations へ挿入（札幌の vehicle/lend_*/return_* → 那覇の vehicle_class/start_*/end_* にマッピング）
  insert into nha_reservations
    (id,ota,vehicle_class,vehicle_name,start_date,end_date,start_time,del_time,end_time,col_time,name,mail,tel,people,
     base_price,option_price,discount,price,status,insurance,del_place,col_place,visit_type,return_type)
  values
    (v_id,'KEYDROP',v_class,coalesce(v_name,''),v_lend,v_ret,v_lendt,v_lendt,v_rett,v_rett,p->>'name',p->>'mail',p->>'tel',coalesce((p->>'people')::int,1),
     v_class_total,v_opt,0,v_total,'pending_payment',v_ins_label,
     coalesce(p->>'del_place',''),coalesce(p->>'col_place',''),coalesce(nullif(p->>'visit_type',''),'DEL'),coalesce(nullif(p->>'return_type',''),'COL'));

  if v_code is not null then insert into nha_fleet (reservation_id,vehicle_code) values (v_id,v_code); v_assigned := coalesce(v_name,'')||'('||v_code||')'; end if;

  return jsonb_build_object('reservationId',v_id,'total',v_total,'classTotal',v_class_total,'options',v_opt,'days',v_days,'vehicleCode',v_code,'assigned',v_assigned,'status','pending_payment');
end; $$;
revoke all on function public.keydrop_book_nha(jsonb) from public, anon, authenticated;

-- 確認(テスト→作成行は削除すること):
-- select keydrop_book_nha('{"vehicleClass":"C","lend_date":"2026-07-10","return_date":"2026-07-11","name":"テスト","mail":"t@example.com","tel":"0","requireStock":true}'::jsonb);
