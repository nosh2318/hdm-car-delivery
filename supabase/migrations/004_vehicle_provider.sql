-- ============================================================
-- 顧客UIに「提供会社」を出すため、公開ビューに owner_company / owner_label を追加
-- 2026-06-10 / omni  ※DBはまとめてRUN（顧客UIは select=* で自動取得・RUNまでは非表示）
-- 提供会社の正＝adminの vehicles.owner_company / owner_label（自社=HANDYMAN / 預かり=協力会社名）
-- ============================================================

create or replace view public.public_vehicles_v
  with (security_invoker = off) as
  select code, type, name, seats,
         owner_company, owner_label
  from public.vehicles
  where coalesce(insurance_veh, false) = false
    and coalesce(active, true) = true;

grant select on public.public_vehicles_v to anon;

-- 確認: select code,type,name,owner_company,owner_label from public_vehicles_v;
