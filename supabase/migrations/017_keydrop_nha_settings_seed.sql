-- ============================================================
-- 017 KEYDROP 那覇(NHA)拡張: nha_app_settings に KEYDROP 設定をseed
-- 2026-06-11 / omni
-- 設計: 那覇のKEYDROP設定は SPKの app_settings とは別テーブル nha_app_settings(key/value) に置く。
--       これにより札幌設定(app_settings)を一切汚さない(クリーン店舗分離)。
-- ★ 値はすべて「暫定の仮値」。オーナーが管理UI(KEYDROP価格/車両紹介/配達範囲)で実値に調整する。
--   on conflict do nothing ＝ 既にオーナーが編集済みなら上書きしない。
-- NHA実クラス(nha_vehicles.type)= A/B/C/D/F/H/S （A2/B2は札幌の預かり専用なので無し）
-- ============================================================

-- 1) 価格マスター（クラス×tier[閑散,通常,繁忙] の1日料金・税込）★暫定仮値
insert into public.nha_app_settings (key, value)
values ('hdm_keydrop_price',
  '{"prices":{"A":[16000,18000,22000],"B":[9000,10000,13000],"C":[6000,7000,9000],"D":[8000,9000,11000],"F":[5000,5500,7000],"H":[5500,6000,8000],"S":[11000,12000,15000]},"presets":[{"name":"GW","start":"04-27","end":"05-06","tier":2},{"name":"お盆","start":"08-08","end":"08-17","tier":2},{"name":"年末年始","start":"12-29","end":"01-03","tier":2}],"default":1}'
)
on conflict (key) do nothing;

-- 2) クラス紹介（顧客サイト「車両と料金」用）★暫定仮値
insert into public.nha_app_settings (key, value)
values ('hdm_keydrop_classes',
  '{"order":["A","B","C","D","F","H","S"],"items":{"A":{"label":"プレミアムミニバン","seats":"7","vehicles":"アルファード/ヴェルファイア","price":18000,"show":true},"B":{"label":"ミニバン(高年式)","seats":"8","vehicles":"ノア/ヴォクシー","price":10000,"show":true},"C":{"label":"コンパクトSUV","seats":"5","vehicles":"ライズ/ヤリスクロス","price":7000,"show":true},"D":{"label":"ミニバン(標準)","seats":"8","vehicles":"ノア/セレナ","price":9000,"show":true},"F":{"label":"コンパクト","seats":"5","vehicles":"アクア/フィット","price":5500,"show":true},"H":{"label":"ハッチバック","seats":"5","vehicles":"プリウスα/カローラ","price":6000,"show":true},"S":{"label":"SUV","seats":"5","vehicles":"ハリアー/CX-5","price":12000,"show":true}},"equipment":["ETC車載器","ナビ","Bluetooth","バックカメラ"],"note":"沖縄エリア・デリバリー対応"}'
)
on conflict (key) do nothing;

-- 3) 配達可能範囲（那覇空港を中心に暫定半径30km・市区フィルタ空=距離のみ判定）★暫定仮値
insert into public.nha_app_settings (key, value)
values ('hdm_delivery_config',
  '{"centerLat":26.1958,"centerLng":127.6489,"centerName":"那覇空港","radiusKm":30,"cityFilter":""}'
)
on conflict (key) do nothing;

-- 確認: select key,value from nha_app_settings where key like 'hdm_keydrop%' or key='hdm_delivery_config';
