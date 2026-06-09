-- ============================================================
-- 005 KEYDROP 予約のアトミック化（ダブルブッキング/採番衝突 防止）
-- 2026-06-10 / omni
-- create-booking(Edge Fn) の「在庫確認→採番→reservations/fleet INSERT」を
-- 1関数・1トランザクション・グローバルadvisory lockで直列化する。
-- 除外ロジックは表示(public_*_v)/GAS自動配車と同一：
--   保険車両/除却(active) ・ 月別除外(vehicle_monthly_kpi active=false) ・
--   予約稼働(fleet×reservations cancelled除外・期間重複) ・ メンテ+入庫+協力会社予約(maintenance 期間重複)
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
begin
  if v_class is null then
    return jsonb_build_object('error', 'クラス未指定');
  end if;

  -- 全KEYDROP予約を直列化（チェック〜INSERTをアトミックに）。低頻度ゆえ性能影響なし。
  perform pg_advisory_xact_lock(hashtext('keydrop_booking'));

  -- 空き車両を1台（表示/GASと同一の除外条件）
  select v.code, v.name into v_code, v_name
  from vehicles v
  where v.type = v_class
    and coalesce(v.insurance_veh, false) = false
    and coalesce(v.active, true) = true
    and ( v_model = ''
          or upper(regexp_replace(coalesce(v.name,''), '[0-9①-⑩]+$', '')) = upper(v_model)
          or replace(replace(upper(coalesce(v.name,'')),' ',''),'-','') = replace(replace(upper(v_model),' ',''),'-','') )
    -- 月別除外フラグ（期間に重なる年月のいずれかで active=false なら不可）
    and not exists (
      select 1 from vehicle_monthly_kpi k
      where k.vehicle_code = v.code and k.active = false
        and k.year_month in (
          select to_char(d, 'YYYY-MM')
          from generate_series(date_trunc('month', v_lend::date), v_ret::date, interval '1 month') d
        )
    )
    -- 予約稼働の重複（cancelled除外）
    and not exists (
      select 1 from fleet f join reservations r on r.id = f.reservation_id
      where f.vehicle_code = v.code
        and coalesce(r.status,'') not in ('cancelled','キャンセル','cancel')
        and r.lend_date <= v_ret and r.return_date >= v_lend
    )
    -- メンテ＋入庫＋協力会社予約の重複（maintenance全block_type）
    and not exists (
      select 1 from maintenance m
      where m.vehicle_code = v.code
        and m.start_date <= v_ret and m.end_date >= v_lend
    )
  order by v.code
  limit 1;

  -- requireStock=true なら、空きが無ければ予約を作らず満車で返す（lockはtxn終了で解放）
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

  -- reservations INSERT
  insert into reservations
    (id, ota, vehicle, lend_date, return_date, name, mail, tel, people,
     base_price, option_price, discount, price, status, insurance,
     del_place, col_place, visit_type, return_type)
  values
    (v_id, 'KEYDROP', v_class, v_lend, v_ret,
     p->>'name', p->>'mail', p->>'tel', coalesce((p->>'people')::int, 1),
     coalesce((p->>'base_price')::numeric, 0), coalesce((p->>'option_price')::numeric, 0),
     coalesce((p->>'discount')::numeric, 0), coalesce((p->>'price')::numeric, 0),
     'pending_payment', coalesce(p->>'insurance','なし'),
     coalesce(p->>'del_place',''), coalesce(p->>'col_place',''),
     coalesce(nullif(p->>'visit_type',''),'DEL'), coalesce(nullif(p->>'return_type',''),'COL'));

  -- fleet 割当（取れた場合のみ）
  if v_code is not null then
    insert into fleet (reservation_id, vehicle_code) values (v_id, v_code);
    v_assigned := coalesce(v_name,'') || '(' || v_code || ')';
  end if;

  return jsonb_build_object('reservationId', v_id, 'assigned', v_assigned, 'vehicleCode', v_code, 'status','pending_payment');
end;
$$;

-- service_role のみ実行（Edge Function 経由）。anon/authenticated には付与しない。
revoke all on function public.keydrop_book(jsonb) from public, anon, authenticated;
