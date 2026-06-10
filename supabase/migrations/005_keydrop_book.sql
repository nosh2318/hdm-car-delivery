-- ============================================================
-- 005 KEYDROP 予約のアトミック化＋サーバ側金額再計算（ダブルブッキング/採番衝突/価格偽装 防止）
-- 2026-06-10 / omni
-- ・在庫確認→採番→reservations/fleet INSERT を 1関数・1txn・グローバルadvisory lockで直列化
-- ・★金額はクライアント値を信用せず、価格マスター(app_settings.hdm_keydrop_price)から
--   選択日ごとのtier(閑散/通常/繁忙)×クラス価格をサーバで合算して確定（決済前提の脆弱性対策）
-- ・除外ロジックは表示(public_*_v)/GAS自動配車と同一
-- ============================================================

create or replace function public.keydrop_book(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class   text := nullif(trim(p->>'vehicleClass'), '');
  v_model   text := coalesce(trim(p->>'vehicleModel'), '');
  v_lend    text := p->>'lend_date';
  v_ret     text := p->>'return_date';
  v_code    text;
  v_name    text;
  v_id      text;
  v_prefix  text;
  v_max     int;
  v_assigned text := '未配車';
  -- 価格計算用
  v_cfg     jsonb;
  v_prices  jsonb;
  v_presets jsonb;
  v_default int;
  v_days    int;
  v_total   numeric := 0;
  v_tier    int;
  v_md      text;
  v_preset  jsonb;
  v_i       int;
begin
  if v_class is null then
    return jsonb_build_object('error', 'クラス未指定');
  end if;
  if v_lend is null or v_ret is null then
    return jsonb_build_object('error', '日付未指定');
  end if;

  -- 全KEYDROP予約を直列化（チェック〜INSERTをアトミックに）
  perform pg_advisory_xact_lock(hashtext('keydrop_booking'));

  -- ===== サーバ側 金額再計算（クライアントのprice/base_priceは信用しない）=====
  begin
    select value::jsonb into v_cfg from app_settings where key = 'hdm_keydrop_price';
  exception when others then v_cfg := null; end;

  if v_cfg is not null and (v_cfg ? 'prices') and (v_cfg->'prices' ? v_class) then
    v_prices  := v_cfg->'prices'->v_class;                 -- [閑散,通常,繁忙]
    v_presets := coalesce(v_cfg->'presets', '[]'::jsonb);
    v_default := coalesce((v_cfg->>'default')::int, 1);
    v_days    := greatest(1, (v_ret::date - v_lend::date)); -- 日数（最低1日）
    for v_i in 0..(v_days - 1) loop
      v_md   := to_char((v_lend::date + v_i), 'MM-DD');
      v_tier := v_default;
      for v_preset in select * from jsonb_array_elements(v_presets) loop
        if (v_preset->>'start') is null or (v_preset->>'end') is null then continue; end if;
        if (v_preset->>'start') <= (v_preset->>'end') then
          if v_md >= (v_preset->>'start') and v_md <= (v_preset->>'end') then
            v_tier := (v_preset->>'tier')::int; exit;
          end if;
        else  -- 年跨ぎ
          if v_md >= (v_preset->>'start') or v_md <= (v_preset->>'end') then
            v_tier := (v_preset->>'tier')::int; exit;
          end if;
        end if;
      end loop;
      v_total := v_total + coalesce((v_prices->>v_tier)::numeric, 0);
    end loop;
  else
    -- 価格マスター未設定時のみ、クライアント値にフォールバック（移行期の保険）
    v_total := coalesce((p->>'price')::numeric, 0);
  end if;

  -- ===== 空き車両を1台（表示/GASと同一の除外条件）=====
  select v.code, v.name into v_code, v_name
  from vehicles v
  where v.type = v_class
    and coalesce(v.insurance_veh, false) = false
    and coalesce(v.active, true) = true
    and ( v_model = ''
          or upper(regexp_replace(coalesce(v.name,''), '[0-9①-⑩]+$', '')) = upper(v_model)
          or replace(replace(upper(coalesce(v.name,'')),' ',''),'-','') = replace(replace(upper(v_model),' ',''),'-','') )
    and not exists (
      select 1 from vehicle_monthly_kpi k
      where k.vehicle_code = v.code and k.active = false
        and k.year_month in (
          select to_char(d, 'YYYY-MM')
          from generate_series(date_trunc('month', v_lend::date), v_ret::date, interval '1 month') d
        )
    )
    and not exists (
      select 1 from fleet f join reservations r on r.id = f.reservation_id
      where f.vehicle_code = v.code
        and coalesce(r.status,'') not in ('cancelled','キャンセル','cancel')
        and r.lend_date <= v_ret and r.return_date >= v_lend
    )
    and not exists (
      select 1 from maintenance m
      where m.vehicle_code = v.code
        and m.start_date <= v_ret and m.end_date >= v_lend
    )
  order by v.code
  limit 1;

  if v_code is null and coalesce((p->>'requireStock')::boolean, false) then
    return jsonb_build_object('error', 'ご希望の期間・クラスは満車です', 'soldOut', true);
  end if;

  -- 採番 KD-YYMM-xxxx（lock内なので衝突なし）
  v_prefix := 'KD-' || to_char(v_lend::date, 'YYMM') || '-';
  select coalesce(max( nullif(substring(id from char_length(v_prefix)+1), '')::int ), 0)
    into v_max
  from reservations
  where id like v_prefix || '%';
  v_id := v_prefix || lpad((v_max + 1)::text, 4, '0');

  -- reservations INSERT（金額はサーバ計算値 v_total を採用）
  insert into reservations
    (id, ota, vehicle, lend_date, return_date, name, mail, tel, people,
     base_price, option_price, discount, price, status, insurance,
     del_place, col_place, visit_type, return_type)
  values
    (v_id, 'KEYDROP', v_class, v_lend, v_ret,
     p->>'name', p->>'mail', p->>'tel', coalesce((p->>'people')::int, 1),
     v_total, 0, 0, v_total,
     'pending_payment', coalesce(p->>'insurance','なし'),
     coalesce(p->>'del_place',''), coalesce(p->>'col_place',''),
     coalesce(nullif(p->>'visit_type',''),'DEL'), coalesce(nullif(p->>'return_type',''),'COL'));

  if v_code is not null then
    insert into fleet (reservation_id, vehicle_code) values (v_id, v_code);
    v_assigned := coalesce(v_name,'') || '(' || v_code || ')';
  end if;

  return jsonb_build_object(
    'reservationId', v_id, 'assigned', v_assigned, 'vehicleCode', v_code,
    'status','pending_payment', 'price', v_total);
end;
$$;

revoke all on function public.keydrop_book(jsonb) from public, anon, authenticated;
