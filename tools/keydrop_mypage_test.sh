#!/usr/bin/env bash
# KEYDROP マイページ ログイン 回帰テスト（店舗ルーティング/大文字小文字の再発防止）
# 使い方:
#   RESID=KD-XXXX-XXXX-XXX MAIL=you@example.com ANON=<anon_key> bash tools/keydrop_mypage_test.sh
# 期待:
#   1) 正常(store未指定)              -> ok(200)
#   2) store=nha + KD-(札幌)予約       -> ok(200)  ※自己修復/接頭辞優先が効いている証拠
#   3) 予約番号を小文字で入力          -> ok(200)  ※resId大文字正規化
#   4) メール不一致                    -> 404      ※本人確認は維持(総当たり防止)
#   5) 存在しない予約番号              -> 404
# ※ 2)3) は Edge Function 未デプロイ時は 404 になる（LP側は既に正しいstore/大文字で送るため実害なし）。
set -u
URL="https://ckrxttbnawkclshczsia.supabase.co/functions/v1/keydrop-mypage"
: "${RESID:?RESID required}"; : "${MAIL:?MAIL required}"; : "${ANON:?ANON required}"
low=$(printf '%s' "$RESID" | tr 'A-Z' 'a-z')
call(){ # $1=json body ; echoes HTTP code
  curl -s -o /tmp/kdmp_body -w '%{http_code}' -X POST "$URL" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "$1"
}
chk(){ # $1=name $2=expectedHTTP $3=body
  code=$(call "$3"); ok="✅"; [ "$code" = "$2" ] || ok="❌"
  echo "$ok $1 : HTTP $code (expect $2)"
}
chk "1 正常(store未指定)"        200 "{\"action\":\"lookup\",\"resId\":\"$RESID\",\"mail\":\"$MAIL\"}"
chk "2 store=nha + KD-予約"      200 "{\"action\":\"lookup\",\"store\":\"nha\",\"resId\":\"$RESID\",\"mail\":\"$MAIL\"}"
chk "3 予約番号 小文字"          200 "{\"action\":\"lookup\",\"resId\":\"$low\",\"mail\":\"$MAIL\"}"
chk "4 メール不一致"            404 "{\"action\":\"lookup\",\"resId\":\"$RESID\",\"mail\":\"nope-$MAIL\"}"
chk "5 存在しない予約番号"        404 "{\"action\":\"lookup\",\"resId\":\"KD-0000-0000-XXX\",\"mail\":\"$MAIL\"}"
