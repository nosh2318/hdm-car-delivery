-- ============================================================
-- 配達可能範囲 設定（オーナーがadminで設定する値・DBが正）
-- 2026-06-09 / omni
-- オーナー指定の基本仕様: 札幌駅(43.0687,141.3508)を中心に半径20km圏内 かつ 札幌市内
--   - centerLat/Lng : 配達拠点（札幌駅）
--   - radiusKm      : 配達半径(km)
--   - cityFilter    : 住所に含まれる必須文字（市区フィルタ）。空なら距離のみ判定
-- 顧客UIはこの設定を public_delivery_config_v 経由で読み、配達可否を判定する。
-- ハードコード(VEHICLE_YARDS)は廃止。値の変更は app_settings.hdm_delivery_config を更新するだけ。
-- ============================================================

insert into public.app_settings (key, value)
values (
  'hdm_delivery_config',
  '{"centerLat":43.0687,"centerLng":141.3508,"centerName":"札幌駅","radiusKm":20,"cityFilter":"札幌市"}'
)
on conflict (key) do update set value = excluded.value;

-- 顧客UI用 公開ビュー（この設定だけ anon で読める・基テーブルapp_settingsは閉じたまま）
create or replace view public.public_delivery_config_v
  with (security_invoker = off) as
  select value
  from public.app_settings
  where key = 'hdm_delivery_config';

grant select on public.public_delivery_config_v to anon;

-- 確認: select * from public_delivery_config_v;
