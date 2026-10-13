# KEYDROP（札幌カーデリバリー直販・hdm-car-delivery）— 入口
- ルール＝`~/.claude/CLAUDE.md`（核・自動読込）。KEYDROP の手順・決済・Edge Function・マイページ＝スキル `handyman-keydrop`。本番 DB 変更＝`handyman-db-change`。
- 経緯・障害記録は `~/.claude/knowledge/keydrop.md`（旧 CLAUDE.md 全文も退避済み）を grep。CLAUDE.md には書かない。
- 本番 https://nosh2318.github.io/hdm-car-delivery/（keydrop.jp）／Edge Functions は `supabase/functions/`（create-booking・keydrop-pay・payment-webhook・keydrop-mypage・keydrop-refund・keydrop-send-mail 等）。
- Supabase main `ckrxttbnawkclshczsia`（札幌と同じ DB）。予約＝`reservations.ota='KEYDROP'`、決済/返金＝`keydrop_payments`。
- マイページの変更締切（実コード）：お届けは出発48時間前まで・回収は返却2時間前まで（リクエスト→運営承認で反映）。
