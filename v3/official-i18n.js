/* HANDYMAN 公式サイト 共有 多言語エンジン（KEYDROP方式・ja/en/zh/ko）
   使い方: <script src="official-i18n.js"></script> を読み込み、
   ・テキスト: <span data-i18n="key">…</span>（innerHTML置換。<br>可）
   ・プレースホルダ: <input data-i18n-ph="key">
   ・属性/JS側: hdmT('key') で取得。言語変更時に window.hdmOnLang があれば呼ぶ（JS生成部の再描画用）。*/
(function(){
  var DICT={
    ja:{
      nav_cars:'車種一覧', nav_price:'ラインナップ', nav_news:'お知らせ', nav_book:'予約する',
      hero_copy:'旅は、目的地に着く前から<br>始まっている。',
      s_store:'📍 店舗を選択', s_store_ph:'店舗を選択', s_naha:'那覇空港店（沖縄）', s_sapporo:'札幌店（北海道）',
      s_method:'🚗 受取方法を選択', m_delivery:'デリバリー', m_airport:'無料送迎（空港/駅）', m_store:'来店',
      spk_msg:'<b>❄️ 札幌はデリバリー専門</b>　お届け先を地図で指定して予約します。「検索する」で予約画面へ進みます。',
      s_pick:'📅 出発 日時', s_ret:'📅 返却 日時', s_time:'時間',
      avail_msg:'🚙 ご利用日程に提供できる空車を次の画面にすべて表示します。',
      s_btn:'空車を検索する',
      cars_en:'CAR TYPE', cars_jp:'ラインナップ',
      tab_naha:'那覇空港店', tab_sapporo:'札幌店',
      car_more:'全車種・料金を見る →',
      news_en:'NEWS', news_jp:'運営からのお知らせ',
      f_news:'お知らせ', f_company:'会社概要', f_terms:'貸渡約款', f_privacy:'プライバシー', f_law:'特定商取引法',
      note_naha:'🌺 那覇店：デリバリー・無料送迎（空港/駅）・来店に対応。',
      note_sapporo:'❄️ 札幌店：デリバリー専門。札幌市・北広島市へお届け／回収します。',
      seats:'名', perday:'〜 / 1日', azukari:'預かり'
    },
    en:{
      nav_cars:'Car Types', nav_price:'Cars & Rates', nav_news:'News', nav_book:'Book Now',
      hero_copy:'The journey begins<br>before you arrive.',
      s_store:'📍 Select store', s_store_ph:'Select store', s_naha:'Naha Airport (Okinawa)', s_sapporo:'Sapporo (Hokkaido)',
      s_method:'🚗 Pickup method', m_delivery:'Delivery', m_airport:'Free shuttle (airport/station)', m_store:'In-store',
      spk_msg:'<b>❄️ Sapporo is delivery-only.</b>  Set your delivery spot on the map. Tap “Search” to continue.',
      s_pick:'📅 Pick-up', s_ret:'📅 Return', s_time:'Time',
      avail_msg:'🚙 All cars available for your dates will be shown on the next screen.',
      s_btn:'Search available cars',
      cars_en:'CAR TYPE', cars_jp:'Lineup',
      tab_naha:'Naha Airport', tab_sapporo:'Sapporo',
      car_more:'See all cars & rates →',
      news_en:'NEWS', news_jp:'Announcements',
      f_news:'News', f_company:'Company', f_terms:'Rental Terms', f_privacy:'Privacy', f_law:'Legal Notice',
      note_naha:'🌺 Naha: delivery, free shuttle (airport/station) & in-store pickup.',
      note_sapporo:'❄️ Sapporo: delivery-only. We deliver/collect in Sapporo & Kitahiroshima.',
      seats:'pax', perday:'~ / day', azukari:'Consignment'
    },
    zh:{
      nav_cars:'車型一覽', nav_price:'車輛與費用', nav_news:'公告', nav_book:'立即預約',
      hero_copy:'旅程，早在抵達之前<br>就已開始。',
      s_store:'📍 選擇門市', s_store_ph:'選擇門市', s_naha:'那覇機場店（沖繩）', s_sapporo:'札幌店（北海道）',
      s_method:'🚗 選擇取車方式', m_delivery:'送車', m_airport:'免費接送（機場/車站）', m_store:'到店',
      spk_msg:'<b>❄️ 札幌僅提供送車服務。</b>  請於地圖指定送車地點，點「搜尋」進入預約。',
      s_pick:'📅 取車 日期時間', s_ret:'📅 還車 日期時間', s_time:'時間',
      avail_msg:'🚙 符合您日期的所有可預約車輛將顯示於下一頁。',
      s_btn:'搜尋可預約車輛',
      cars_en:'CAR TYPE', cars_jp:'車型一覽',
      tab_naha:'那覇機場店', tab_sapporo:'札幌店',
      car_more:'查看所有車型與費用 →',
      news_en:'NEWS', news_jp:'營運公告',
      f_news:'公告', f_company:'公司簡介', f_terms:'租賃條款', f_privacy:'隱私權', f_law:'特定商業交易法',
      note_naha:'🌺 那覇店：提供送車・免費接送（機場/車站）・到店取車。',
      note_sapporo:'❄️ 札幌店：僅送車。於札幌市・北廣島市送車／收車。',
      seats:'人', perday:'～ / 每日', azukari:'寄放車'
    },
    ko:{
      nav_cars:'차종 목록', nav_price:'차량 및 요금', nav_news:'공지', nav_book:'예약하기',
      hero_copy:'여행은 목적지에 도착하기 전부터<br>시작됩니다.',
      s_store:'📍 매장 선택', s_store_ph:'매장 선택', s_naha:'나하공항점(오키나와)', s_sapporo:'삿포로점(홋카이도)',
      s_method:'🚗 수령 방법 선택', m_delivery:'배달', m_airport:'무료 셔틀(공항/역)', m_store:'방문',
      spk_msg:'<b>❄️ 삿포로는 배달 전용입니다.</b>  지도에서 배달 장소를 지정하고 「검색」으로 진행하세요.',
      s_pick:'📅 대여 일시', s_ret:'📅 반납 일시', s_time:'시간',
      avail_msg:'🚙 선택하신 일정에 예약 가능한 모든 차량을 다음 화면에 표시합니다.',
      s_btn:'빈 차량 검색',
      cars_en:'CAR TYPE', cars_jp:'라인업',
      tab_naha:'나하공항점', tab_sapporo:'삿포로점',
      car_more:'전체 차종·요금 보기 →',
      news_en:'NEWS', news_jp:'운영 공지',
      f_news:'공지', f_company:'회사 소개', f_terms:'대여 약관', f_privacy:'개인정보', f_law:'특정상거래법',
      note_naha:'🌺 나하점: 배달·무료 셔틀(공항/역)·방문 수령 가능.',
      note_sapporo:'❄️ 삿포로점: 배달 전용. 삿포로시·기타히로시마시로 배달/회수.',
      seats:'명', perday:'~ / 1일', azukari:'위탁'
    }
  };
  // ===== 予約フロー(official-flow.html)用キー =====
  var FLOW={
   ja:{fl_change:'条件を変更',resv_jp:'ご予約',
    st_cond:'条件選択',st_opt:'オプション<br>・補償',st_cust:'お客様情報',st_pay:'確認・決済',
    st_recv_del:'お届け・車両',st_recv_air:'送迎・車両',st_recv_store:'来店・車両',
    fl_pick_head:'🚙 ご利用日程の空車から選択',fl_allfull:'🈵 選択された日程は、あいにく全クラス満車です。日程を変更してお試しください。',
    fl_car_hint:'車種・色・仕様はお選びいただけません（同クラス内からランダム）。全車禁煙・ペット同乗不可。料金は1日（24時間）あたりの目安です。',
    fl_lockmsg:'🔒 まず上で車両を選び「この車両に決める」を押すと、こちらをご指定いただけます。',
    fl_decide:'この車両に決める',fl_decided:'✓ この車両に決定',fl_full:'満車',fl_nostock:'この日程は空車なし',fl_detail:'🔍 詳細をみる',fl_nostock2:'この日程は空車がありません',
    mt_del:'🚗 デリバリー（お届け）',mt_air:'✈️ 無料送迎（空港/駅）',mt_store:'🏠 来店',
    opt_head:'🧷 オプション',opt_child:'チャイルドシート',opt_child_d:'乳児・幼児用・最大5個',opt_junior:'ジュニアシート',opt_junior_d:'学童用・最大5個',opt_usb:'USB充電ケーブル',opt_usb_d:'貸出',opt_per:'¥550 / 個・日',
    ins_head:'🛡 補償プラン',ins_basic:'基本補償',ins_free:'無料',ins_basic_d:'対人・対物無制限／車両保証（免責15万円）／人身傷害3,000万円',ins_cdw:'基本＋免責補償',ins_cdw_p:'¥1,100 / 日',ins_cdw_d:'免責額（自己負担15万円）を免除',ins_noc:'基本＋免責＋NOC',ins_noc_p:'¥1,650 / 日',ins_noc_d:'タイヤ・ホイール等も補償。NOC（営業補償）も免除',
    cust_head:'👤 ご予約者さま情報',l_name:'お名前',l_kana:'フリガナ',l_phone:'電話番号',l_email:'メールアドレス',req:'必須',ph_name:'山田 太郎',ph_kana:'ヤマダ タロウ',ph_phone:'090-1234-5678',ph_email:'example@mail.com',email_note:'※ メールアドレスはマイページ（予約確認・変更）のログインに使用します。',l_notes:'備考・ご要望（任意）',drv_diff:'運転される方がご予約者さまと異なる',drv_head:'運転される方',ph_dname:'山田 花子',ph_dkana:'ヤマダ ハナコ',
    chosen_head:'🚙 選択中の車両',confirm_head:'📋 ご予約内容の確認',pay_head:'💳 お支払い',pay_desc:'事前カード決済（Square）または店頭でのお支払いに対応しています。<br>「予約を確定する」を押すと予約が確定し、確認メールをお送りします。',pay_desc2:'お支払い方法をお選びください。「予約を確定する」を押すと予約が確定し、確認メールをお送りします。',pay_card:'💳 事前カード決済（Square）',pay_card_d:'ご予約確定後、決済リンク（Square）をメールでお送りします。',pay_store:'🏬 店頭でお支払い',pay_store_d:'当日の受け渡し時に店頭でお支払いいただけます。',pay_desc3:'クレジットカードでのお支払いです。「予約を確定する」を押すと、ご予約とお支払いが確定します。',pc_accept:'ご利用可能：',pc_num:'カード番号',pc_exp:'有効期限（MM/YY）',pc_cvc:'セキュリティコード',pc_name:'カード名義（ローマ字）',pc_name_ph:'TARO YAMADA',pc_secure:'🔒 カード情報はSSLで暗号化して安全に送信されます。当サイトにカード番号は保存されません。',pc_err_num:'カード番号が正しくありません。',pc_err_exp:'有効期限が正しくありません。',pc_err_cvc:'セキュリティコードが正しくありません。',pc_err_name:'カード名義をご入力ください。',pc_secure_sq:'🔒 カード情報はSquareの安全な決済システムで暗号化して処理されます。当サイト・当社サーバーにカード番号は保存されません。',pc_proc:'処理中…',pc_prep:'カードフォームを準備中です。数秒お待ちください。',pc_card_check:'カード情報をご確認ください。',pc_card_fail:'カード情報の処理に失敗しました。',pc_pay_fail:'決済に失敗しました。',pc_net_fail:'通信に失敗しました。時間をおいてお試しください。',pc_sdk_err:'決済フォームの読み込みに失敗しました。ページを再読み込みしてください。',terms_head:'📄 貸渡約款',terms_read:'ご予約前に貸渡約款を必ずお読みください（下記をスクロールしてご確認いただけます）。',terms_agree:'貸渡約款に同意します（同意しないとご予約を確定できません）',terms_view:'📄 別タブで全文を開く',terms_need:'貸渡約款へのご同意が必要です。',done_head:'ご予約が完了しました',
    cta_back:'← 戻る',cta_total:'合計（1日あたり）',cta_options:'オプション・補償へ →',cta_customer:'お客様情報へ →',cta_confirm:'入力内容を確認する →',cta_pay:'お支払いに進む →',cta_done:'予約を確定する',
    bus_head:'🚌 無料シャトルバス 運行時刻表',bus_sub:'コースター／定員20名・空港⇔ヤード往復',bus_note1:'✅ 無料・定時運行のため',bus_note2:'ご予約は必要ありません。',bus_note3:'お時間に合わせて、そのままバス乗り場へお越しください。',bus_air:'✈ 空港出発便',bus_air_rt:'那覇空港 レンタカー送迎バス乗り場11番 → HANDYMAN',bus_yard:'🏢 ヤード出発便',bus_yard_rt:'HANDYMAN → 那覇空港 出発口',bus_hint:'※ 運行時刻は目安です。当日の交通状況により多少前後する場合があります。営業時間 9:00〜19:00。',
    air_go_place:'送迎（行き）場所',air_ret_place:'送迎（帰り）場所',air_selectable:'（選べます）',air_sel:'選択してください',air_time_go:'ご予約時間',air_time_ret:'返却時間',air_flight:'到着便名（任意）',ph_flight:'例）NH1234',air_hint:'無料送迎（那覇空港／赤嶺駅）に対応。行き・帰りの送迎場所をそれぞれお選びください。時間は前画面で選択した出発／返却時間です（変更は「変更」から）。',store_l:'来店店舗',store_hint:'店舗にてお引き渡し・ご返却を行います。来店時間は日時選択に準じます。ご連絡先はお客様情報でご入力いただきます。',store_p2:'🅿️ HANDYMAN 那覇空港店（第2駐車場）',store_addr:'〒901-0235 沖縄県豊見城市名嘉地180-1',store_map:'🗺 地図で見る',
    dt_seats:'乗車定員',dt_price:'料金',dt_equip:'標準装備',dt_pick:'このクラスを選択する',
    al_pickfirst:'先に車両を選び「この車両に決める」を押してください',al_deldest:'お届け先を地図で選び「決定」してください',al_coldest:'回収先を地図で選び「決定」してください',
    sum_area:'エリア',sum_recv:'受取',sum_dep:'出発',sum_ret:'返却',sum_change:'変更',mock_note:'※これはデザインモックです。実際の予約・決済は行われていません。',
    dn_resno:'予約番号',dn_sent1:'確認メールを',dn_sent2:'宛にお送りしました。予約内容の確認・変更は、メールアドレス＋予約番号でログインできるマイページから行えます。',dn_top:'トップへ戻る', dn_mypage:'予約を確認・変更する（マイページ）',
    cf_car:'車両',cf_opt:'オプション',cf_ins:'補償',cf_period:'利用期間',cf_recv:'受取',cf_contact:'ご連絡先',cf_driver:'運転者',cf_price:'料金',cf_days:'日'},
   en:{fl_change:'Change search',resv_jp:'Reservation',
    st_cond:'Conditions',st_opt:'Options &<br>Coverage',st_cust:'Your info',st_pay:'Confirm & Pay',
    st_recv_del:'Delivery & Car',st_recv_air:'Shuttle & Car',st_recv_store:'Pickup & Car',
    fl_pick_head:'🚙 Select from cars available for your dates',fl_allfull:'🈵 Sorry, all classes are fully booked for the selected dates. Please try different dates.',
    fl_car_hint:'Specific model, color and trim cannot be chosen (random within the class). All cars non-smoking, no pets. Prices are a guide per day (24h).',
    fl_lockmsg:'🔒 First choose a car above and tap “Select this car” to set this section.',
    fl_decide:'Select this car',fl_decided:'✓ Selected',fl_full:'Full',fl_nostock:'No cars for these dates',fl_detail:'🔍 View details',fl_nostock2:'No cars available for these dates',
    mt_del:'🚗 Delivery',mt_air:'✈️ Free shuttle (airport/station)',mt_store:'🏠 In-store',
    opt_head:'🧷 Options',opt_child:'Child seat',opt_child_d:'Infant/toddler · up to 5',opt_junior:'Junior seat',opt_junior_d:'For children · up to 5',opt_usb:'USB charging cable',opt_usb_d:'Loan',opt_per:'¥550 / each·day',
    ins_head:'🛡 Coverage plan',ins_basic:'Basic',ins_free:'Free',ins_basic_d:'Unlimited liability / vehicle damage (¥150k deductible) / personal injury ¥30M',ins_cdw:'Basic + CDW',ins_cdw_p:'¥1,100 / day',ins_cdw_d:'Waives the ¥150k deductible',ins_noc:'Basic + CDW + NOP',ins_noc_p:'¥1,650 / day',ins_noc_d:'Also covers tires/wheels & waives Non-Operation Charge',
    cust_head:'👤 Booker details',l_name:'Name',l_kana:'Name (kana)',l_phone:'Phone',l_email:'Email',req:'required',ph_name:'Taro Yamada',ph_kana:'ヤマダ タロウ',ph_phone:'090-1234-5678',ph_email:'example@mail.com',email_note:'※ Your email is used to log in to My Page (view/change booking).',l_notes:'Notes / requests (optional)',drv_diff:'Driver is different from the booker',drv_head:'Driver',ph_dname:'Hanako Yamada',ph_dkana:'ヤマダ ハナコ',
    chosen_head:'🚙 Selected car',confirm_head:'📋 Confirm your booking',pay_head:'💳 Payment',pay_desc:'Pay by card in advance (Square) or at the store.<br>Tap “Confirm booking” to finalize; a confirmation email will be sent.',pay_desc2:'Please choose your payment method. Tap “Confirm booking” to finalize; a confirmation email will be sent.',pay_card:'💳 Pay by card in advance (Square)',pay_card_d:'After confirming, we will email you a Square payment link.',pay_store:'🏬 Pay at the store',pay_store_d:'You may pay at the store when you pick up the car.',pay_desc3:'Payment by credit card. Tapping “Confirm booking” finalizes your reservation and payment.',pc_accept:'Accepted:',pc_num:'Card number',pc_exp:'Expiry (MM/YY)',pc_cvc:'Security code',pc_name:'Cardholder name',pc_name_ph:'TARO YAMADA',pc_secure:'🔒 Your card details are encrypted via SSL. We do not store your card number.',pc_err_num:'Invalid card number.',pc_err_exp:'Invalid expiry date.',pc_err_cvc:'Invalid security code.',pc_err_name:'Please enter the cardholder name.',pc_secure_sq:'🔒 Your card details are encrypted and processed by Square’s secure payment system. We never store your card number.',pc_proc:'Processing…',pc_prep:'Preparing the card form. Please wait a moment.',pc_card_check:'Please check your card details.',pc_card_fail:'Failed to process card details.',pc_pay_fail:'Payment failed.',pc_net_fail:'Connection failed. Please try again later.',pc_sdk_err:'Failed to load the payment form. Please reload the page.',terms_head:'📄 Rental Agreement',terms_read:'Please read the Rental Agreement before booking (scroll below to review).',terms_agree:'I agree to the Rental Agreement (required to confirm your booking)',terms_view:'📄 Open full text in a new tab',terms_need:'You must agree to the Rental Agreement.',done_head:'Your booking is complete',
    cta_back:'← Back',cta_total:'Total (per day)',cta_options:'To options & coverage →',cta_customer:'To your info →',cta_confirm:'Review details →',cta_pay:'Proceed to payment →',cta_done:'Confirm booking',
    bus_head:'🚌 Free shuttle bus timetable',bus_sub:'Coaster / 20 seats · Airport ⇔ Yard round trip',bus_note1:'✅ Free, scheduled service —',bus_note2:'no reservation needed.',bus_note3:'Just come to the bus stop at your time.',bus_air:'✈ From airport',bus_air_rt:'Naha Airport rental shuttle stop No.11 → HANDYMAN',bus_yard:'🏢 From yard',bus_yard_rt:'HANDYMAN → Naha Airport departures',bus_hint:'※ Times are approximate and may shift with traffic. Hours 9:00–19:00.',
    air_go_place:'Shuttle (outbound) place',air_ret_place:'Shuttle (return) place',air_selectable:'(selectable)',air_sel:'Please select',air_time_go:'Booking time',air_time_ret:'Return time',air_flight:'Arrival flight no. (optional)',ph_flight:'e.g. NH1234',air_hint:'Free shuttle (Naha Airport / Akamine Sta.). Choose outbound & return places. Times follow your pick-up/return from the previous screen (edit via “Change”).',store_l:'Pickup store',store_hint:'Handover/return at the store. Pickup time follows your date/time. Enter contact in your info.',store_p2:'🅿️ HANDYMAN Naha Airport Store (2nd Parking)',store_addr:'180-1 Nakachi, Tomigusuku, Okinawa 901-0235',store_map:'🗺 View on map',
    dt_seats:'Seats',dt_price:'Price',dt_equip:'Standard equipment',dt_pick:'Select this class',
    al_pickfirst:'Please choose a car first and tap “Select this car”.',al_deldest:'Please set the delivery spot on the map and tap “Confirm”.',al_coldest:'Please set the collection spot on the map and tap “Confirm”.',
    sum_area:'Area',sum_recv:'Pickup',sum_dep:'Out',sum_ret:'Return',sum_change:'Change',mock_note:'※ This is a design mock. No real booking/payment is made.',
    dn_resno:'Booking No.',dn_sent1:'A confirmation email was sent to',dn_sent2:'. You can view/change your booking on My Page by logging in with your email + booking number.',dn_top:'Back to top', dn_mypage:'View / change booking (My Page)',
    cf_car:'Car',cf_opt:'Options',cf_ins:'Coverage',cf_period:'Period',cf_recv:'Pickup',cf_contact:'Contact',cf_driver:'Driver',cf_price:'Total',cf_days:'day(s)'},
   zh:{fl_change:'變更條件',resv_jp:'預約',
    st_cond:'選擇條件',st_opt:'加購<br>與保障',st_cust:'顧客資料',st_pay:'確認・付款',
    st_recv_del:'送車・車輛',st_recv_air:'接送・車輛',st_recv_store:'到店・車輛',
    fl_pick_head:'🚙 從符合日期的可預約車輛選擇',fl_allfull:'🈵 很抱歉，所選日期全車型皆已額滿。請更改日期再試。',
    fl_car_hint:'無法指定車種・顏色・配備（同車型隨機）。全車禁菸・禁攜寵物。費用為每日（24小時）參考價。',
    fl_lockmsg:'🔒 請先於上方選擇車輛並按「選擇此車」，即可指定此處。',
    fl_decide:'選擇此車',fl_decided:'✓ 已選擇',fl_full:'額滿',fl_nostock:'此日期無可預約車',fl_detail:'🔍 查看詳情',fl_nostock2:'此日期無可預約車輛',
    mt_del:'🚗 送車',mt_air:'✈️ 免費接送（機場/車站）',mt_store:'🏠 到店',
    opt_head:'🧷 加購項目',opt_child:'兒童座椅',opt_child_d:'嬰幼兒用・最多5個',opt_junior:'學童座椅',opt_junior_d:'學童用・最多5個',opt_usb:'USB充電線',opt_usb_d:'租借',opt_per:'¥550 / 個・日',
    ins_head:'🛡 保障方案',ins_basic:'基本保障',ins_free:'免費',ins_basic_d:'對人・對物無上限／車體保障（自負額15萬日圓）／人身傷害3,000萬日圓',ins_cdw:'基本＋免責保障',ins_cdw_p:'¥1,100 / 日',ins_cdw_d:'免除自負額（15萬日圓）',ins_noc:'基本＋免責＋NOC',ins_noc_p:'¥1,650 / 日',ins_noc_d:'另保障輪胎・輪圈等，並免除NOC（營業補償）',
    cust_head:'👤 預約人資料',l_name:'姓名',l_kana:'姓名（片假名）',l_phone:'電話',l_email:'電子郵件',req:'必填',ph_name:'山田 太郎',ph_kana:'ヤマダ タロウ',ph_phone:'090-1234-5678',ph_email:'example@mail.com',email_note:'※ 電子郵件用於登入會員頁（查詢/變更預約）。',l_notes:'備註・需求（選填）',drv_diff:'駕駛人與預約人不同',drv_head:'駕駛人',ph_dname:'山田 花子',ph_dkana:'ヤマダ ハナコ',
    chosen_head:'🚙 已選車輛',confirm_head:'📋 確認預約內容',pay_head:'💳 付款',pay_desc:'可預先刷卡（Square）或到店付款。<br>按「確定預約」即完成預約，並寄送確認信。',pay_desc2:'請選擇付款方式。按「確定預約」即完成預約，並寄送確認信。',pay_card:'💳 預先刷卡（Square）',pay_card_d:'預約確定後，我們將以電子郵件寄送 Square 付款連結。',pay_store:'🏬 到店付款',pay_store_d:'可於當天取車時到店付款。',pay_desc3:'以信用卡付款。按「確定預約」即完成預約與付款。',pc_accept:'可使用：',pc_num:'卡號',pc_exp:'有效期限（MM/YY）',pc_cvc:'安全碼',pc_name:'持卡人姓名（英文）',pc_name_ph:'TARO YAMADA',pc_secure:'🔒 卡片資訊以 SSL 加密安全傳送，本站不會儲存卡號。',pc_err_num:'卡號不正確。',pc_err_exp:'有效期限不正確。',pc_err_cvc:'安全碼不正確。',pc_err_name:'請輸入持卡人姓名。',pc_secure_sq:'🔒 卡片資訊由 Square 安全付款系統加密處理，本站與本公司伺服器不會儲存卡號。',pc_proc:'處理中…',pc_prep:'正在準備卡片表單，請稍候。',pc_card_check:'請確認卡片資訊。',pc_card_fail:'卡片資訊處理失敗。',pc_pay_fail:'付款失敗。',pc_net_fail:'連線失敗，請稍後再試。',pc_sdk_err:'付款表單載入失敗，請重新整理頁面。',terms_head:'📄 租車約款',terms_read:'預約前請務必閱讀租車約款（可向下捲動確認）。',terms_agree:'我同意租車約款（未同意將無法確定預約）',terms_view:'📄 於新分頁開啟全文',terms_need:'需要同意租車約款。',done_head:'預約完成',
    cta_back:'← 返回',cta_total:'合計（每日）',cta_options:'前往加購・保障 →',cta_customer:'前往顧客資料 →',cta_confirm:'確認輸入內容 →',cta_pay:'前往付款 →',cta_done:'確定預約',
    bus_head:'🚌 免費接駁巴士 時刻表',bus_sub:'Coaster／定員20名・機場⇔停車場往返',bus_note1:'✅ 免費・定時運行，',bus_note2:'無需預約。',bus_note3:'請於時間直接前往乘車處。',bus_air:'✈ 機場出發',bus_air_rt:'那覇機場 租車接送巴士11號乘車處 → HANDYMAN',bus_yard:'🏢 停車場出發',bus_yard_rt:'HANDYMAN → 那覇機場 出境口',bus_hint:'※ 時刻為參考，當日可能因交通狀況略有變動。營業時間 9:00〜19:00。',
    air_go_place:'接送（去程）地點',air_ret_place:'接送（回程）地點',air_selectable:'（可選）',air_sel:'請選擇',air_time_go:'預約時間',air_time_ret:'還車時間',air_flight:'抵達航班編號（選填）',ph_flight:'例）NH1234',air_hint:'提供免費接送（那覇機場／赤嶺站）。請分別選擇去程・回程地點。時間依前一頁的取還時間（變更請按「變更」）。',store_l:'到店門市',store_hint:'於門市交還車。到店時間依日期時間。聯絡方式請於顧客資料填寫。',store_p2:'🅿️ HANDYMAN 那覇機場店（第2停車場）',store_addr:'〒901-0235 沖縄県豊見城市名嘉地180-1',store_map:'🗺 在地圖上查看',
    dt_seats:'乘坐人數',dt_price:'費用',dt_equip:'標準配備',dt_pick:'選擇此車型',
    al_pickfirst:'請先選擇車輛並按「選擇此車」。',al_deldest:'請於地圖選擇送車地點並按「確定」。',al_coldest:'請於地圖選擇收車地點並按「確定」。',
    sum_area:'區域',sum_recv:'取車',sum_dep:'出發',sum_ret:'還車',sum_change:'變更',mock_note:'※ 這是設計樣稿，不會進行實際預約/付款。',
    dn_resno:'預約編號',dn_sent1:'確認信已寄至',dn_sent2:'。可用電子郵件＋預約編號登入會員頁查詢/變更預約。',dn_top:'返回首頁', dn_mypage:'查詢／變更預約（我的頁面）',
    cf_car:'車輛',cf_opt:'加購',cf_ins:'保障',cf_period:'租用期間',cf_recv:'取車',cf_contact:'聯絡方式',cf_driver:'駕駛人',cf_price:'費用',cf_days:'日'},
   ko:{fl_change:'조건 변경',resv_jp:'예약',
    st_cond:'조건 선택',st_opt:'옵션<br>·보장',st_cust:'고객 정보',st_pay:'확인·결제',
    st_recv_del:'배달·차량',st_recv_air:'셔틀·차량',st_recv_store:'방문·차량',
    fl_pick_head:'🚙 이용 일정에 예약 가능한 차량에서 선택',fl_allfull:'🈵 선택하신 일정은 모든 클래스가 만차입니다. 일정을 변경해 주세요.',
    fl_car_hint:'차종·색상·사양은 선택할 수 없습니다(같은 클래스 내 랜덤). 전 차량 금연·반려동물 불가. 요금은 1일(24시간) 기준 참고가입니다.',
    fl_lockmsg:'🔒 먼저 위에서 차량을 고르고 「이 차량으로 결정」을 누르면 여기를 지정할 수 있습니다.',
    fl_decide:'이 차량으로 결정',fl_decided:'✓ 선택됨',fl_full:'만차',fl_nostock:'이 일정 예약 불가',fl_detail:'🔍 상세 보기',fl_nostock2:'이 일정에 예약 가능한 차량이 없습니다',
    mt_del:'🚗 배달',mt_air:'✈️ 무료 셔틀(공항/역)',mt_store:'🏠 방문',
    opt_head:'🧷 옵션',opt_child:'유아용 카시트',opt_child_d:'영유아용·최대 5개',opt_junior:'주니어 시트',opt_junior_d:'아동용·최대 5개',opt_usb:'USB 충전 케이블',opt_usb_d:'대여',opt_per:'¥550 / 개·일',
    ins_head:'🛡 보장 플랜',ins_basic:'기본 보장',ins_free:'무료',ins_basic_d:'대인·대물 무제한/차량 보증(면책 15만엔)/인신상해 3,000만엔',ins_cdw:'기본＋면책 보장',ins_cdw_p:'¥1,100 / 일',ins_cdw_d:'면책금(자기부담 15만엔) 면제',ins_noc:'기본＋면책＋NOC',ins_noc_p:'¥1,650 / 일',ins_noc_d:'타이어·휠 등도 보장. NOC(영업보상)도 면제',
    cust_head:'👤 예약자 정보',l_name:'성명',l_kana:'성명(가나)',l_phone:'전화번호',l_email:'이메일',req:'필수',ph_name:'야마다 타로',ph_kana:'ヤマダ タロウ',ph_phone:'090-1234-5678',ph_email:'example@mail.com',email_note:'※ 이메일은 마이페이지(예약 확인·변경) 로그인에 사용됩니다.',l_notes:'비고·요청(선택)',drv_diff:'운전자가 예약자와 다름',drv_head:'운전자',ph_dname:'야마다 하나코',ph_dkana:'ヤマダ ハナコ',
    chosen_head:'🚙 선택한 차량',confirm_head:'📋 예약 내용 확인',pay_head:'💳 결제',pay_desc:'사전 카드 결제(Square) 또는 매장 결제가 가능합니다.<br>「예약 확정」을 누르면 예약이 확정되고 확인 메일이 발송됩니다.',pay_desc2:'결제 방법을 선택해 주세요. 「예약 확정」을 누르면 예약이 확정되고 확인 메일이 발송됩니다.',pay_card:'💳 사전 카드 결제(Square)',pay_card_d:'예약 확정 후 결제 링크(Square)를 이메일로 보내드립니다.',pay_store:'🏬 매장에서 결제',pay_store_d:'당일 차량 인수 시 매장에서 결제하실 수 있습니다.',pay_desc3:'신용카드 결제입니다. 「예약 확정」을 누르면 예약과 결제가 확정됩니다.',pc_accept:'사용 가능:',pc_num:'카드 번호',pc_exp:'유효기간(MM/YY)',pc_cvc:'보안 코드',pc_name:'카드 명의(영문)',pc_name_ph:'TARO YAMADA',pc_secure:'🔒 카드 정보는 SSL로 암호화되어 안전하게 전송되며, 카드 번호는 저장되지 않습니다.',pc_err_num:'카드 번호가 올바르지 않습니다.',pc_err_exp:'유효기간이 올바르지 않습니다.',pc_err_cvc:'보안 코드가 올바르지 않습니다.',pc_err_name:'카드 명의를 입력해 주세요.',pc_secure_sq:'🔒 카드 정보는 Square의 안전한 결제 시스템으로 암호화되어 처리되며, 카드 번호는 저장되지 않습니다.',pc_proc:'처리 중…',pc_prep:'카드 폼을 준비 중입니다. 잠시만 기다려 주세요.',pc_card_check:'카드 정보를 확인해 주세요.',pc_card_fail:'카드 정보 처리에 실패했습니다.',pc_pay_fail:'결제에 실패했습니다.',pc_net_fail:'통신에 실패했습니다. 잠시 후 다시 시도해 주세요.',pc_sdk_err:'결제 폼을 불러오지 못했습니다. 페이지를 새로고침해 주세요.',terms_head:'📄 대여 약관',terms_read:'예약 전에 대여 약관을 반드시 읽어 주세요(아래로 스크롤하여 확인).',terms_agree:'대여 약관에 동의합니다(동의하지 않으면 예약을 확정할 수 없습니다)',terms_view:'📄 새 탭에서 전문 열기',terms_need:'대여 약관 동의가 필요합니다.',done_head:'예약이 완료되었습니다',
    cta_back:'← 뒤로',cta_total:'합계(1일당)',cta_options:'옵션·보장으로 →',cta_customer:'고객 정보로 →',cta_confirm:'입력 내용 확인 →',cta_pay:'결제로 진행 →',cta_done:'예약 확정',
    bus_head:'🚌 무료 셔틀버스 운행 시각표',bus_sub:'코스터/정원 20명·공항⇔야드 왕복',bus_note1:'✅ 무료·정시 운행이므로',bus_note2:'예약이 필요 없습니다.',bus_note3:'시간에 맞춰 바로 승차장으로 오세요.',bus_air:'✈ 공항 출발',bus_air_rt:'나하공항 렌터카 셔틀 승차장 11번 → HANDYMAN',bus_yard:'🏢 야드 출발',bus_yard_rt:'HANDYMAN → 나하공항 출발구',bus_hint:'※ 운행 시각은 기준이며 당일 교통 상황에 따라 다소 변동될 수 있습니다. 영업시간 9:00~19:00.',
    air_go_place:'셔틀(가는편) 장소',air_ret_place:'셔틀(오는편) 장소',air_selectable:'(선택 가능)',air_sel:'선택해 주세요',air_time_go:'예약 시간',air_time_ret:'반납 시간',air_flight:'도착 항공편명(선택)',ph_flight:'예) NH1234',air_hint:'무료 셔틀(나하공항/아카미네역) 대응. 가는편·오는편 장소를 각각 선택하세요. 시간은 이전 화면의 대여/반납 시간입니다(변경은 「변경」에서).',store_l:'방문 매장',store_hint:'매장에서 인수/반납합니다. 방문 시간은 일시 선택에 따릅니다. 연락처는 고객 정보에서 입력합니다.',store_p2:'🅿️ HANDYMAN 나하공항점(제2주차장)',store_addr:'〒901-0235 沖縄県豊見城市名嘉地180-1',store_map:'🗺 지도에서 보기',
    dt_seats:'승차 정원',dt_price:'요금',dt_equip:'표준 장비',dt_pick:'이 클래스 선택',
    al_pickfirst:'먼저 차량을 고르고 「이 차량으로 결정」을 눌러 주세요.',al_deldest:'지도에서 배달 장소를 선택하고 「확정」을 눌러 주세요.',al_coldest:'지도에서 회수 장소를 선택하고 「확정」을 눌러 주세요.',
    sum_area:'지역',sum_recv:'수령',sum_dep:'출발',sum_ret:'반납',sum_change:'변경',mock_note:'※ 디자인 목업입니다. 실제 예약/결제는 이루어지지 않습니다.',
    dn_resno:'예약번호',dn_sent1:'확인 메일을',dn_sent2:' 앞으로 보냈습니다. 이메일＋예약번호로 마이페이지에 로그인해 예약을 확인/변경할 수 있습니다.',dn_top:'처음으로', dn_mypage:'예약 조회·변경(마이페이지)',
    cf_car:'차량',cf_opt:'옵션',cf_ins:'보장',cf_period:'이용 기간',cf_recv:'수령',cf_contact:'연락처',cf_driver:'운전자',cf_price:'요금',cf_days:'일'}
  };
  // ===== 確認明細 / 受取詳細 / 札幌デリバリー地図 =====
  var FLOW2={
   ja:{cf_edit:'✏️ 変更',cf_store:'店舗',cf_recvm:'受取方法',cf_use:'ご利用',cf_booker:'ご予約者',cf_none:'なし',cf_days_unit:'日間',cf_x:'×',
     md_del:'デリバリー／お届け：',md_col:'／回収：',md_same:'同じ',md_unset:'未指定',md_air:'無料送迎／行き：',md_air2:'・帰り：',md_store_a:'来店（',md_store_b:'）',
     dl_place_map:'受け取り・回収の場所を地図で決めてください',dl_place_sel:'受け取り・回収の場所を選んでください',dl_colsame:'回収先はお届け先と同じ',
     dl_ph_park:'駐車場名・住所で検索',dl_ph_addr:'住所・ホテル名で検索',dl_search:'🔍 検索',dl_lt_station:'🚉 駅',dl_lt_hotel:'🏨 ホテル',dl_lt_park:'🅿️ ｺｲﾝﾊﾟｰｷﾝｸﾞ',
     dl_pend_sel:'場所を選び、下の「決定」を押してください。',dl_pend_map:'地図をタップ、または住所で検索して場所を選び、下の「決定」を押してください。',
     dl_decide_a:'この場所を「',dl_decide_b:'」に決定',dl_hint_naha:'駅・ホテルはプルダウン、コインパーキングは地図で指定できます。那覇＝沖縄本島の対応エリアへお届け／回収します。',dl_hint_spk:'札幌＝札幌市・北広島市へお届け／回収します。エリア外はご相談ください。',
     dl_target_del:'📍 お届け先',dl_target_col:'🏁 回収先',lc_undecided:'未決定',lc_change:'変更',lc_del:'お届け先',lc_col:'回収先',dl_selecting:'選択中：',dl_same_as:'お届け先と同じ',dl_next_col:'続けて<b>回収先</b>を地図で選び「決定」してください（お届け先と同じ場合は上のチェック）。'},
   en:{cf_edit:'✏️ Edit',cf_store:'Store',cf_recvm:'Pickup method',cf_use:'Duration',cf_booker:'Booker',cf_none:'None',cf_days_unit:'day(s)',cf_x:'×',
     md_del:'Delivery / Drop-off: ',md_col:' / Collect: ',md_same:'Same',md_unset:'Not set',md_air:'Free shuttle / Out: ',md_air2:' · Return: ',md_store_a:'In-store (',md_store_b:')',
     dl_place_map:'Set the pickup/collection spot on the map',dl_place_sel:'Choose the pickup/collection spot',dl_colsame:'Collection spot same as delivery',
     dl_ph_park:'Search by parking lot / address',dl_ph_addr:'Search by address / hotel',dl_search:'🔍 Search',dl_lt_station:'🚉 Station',dl_lt_hotel:'🏨 Hotel',dl_lt_park:'🅿️ Parking',
     dl_pend_sel:'Choose a spot, then tap “Confirm” below.',dl_pend_map:'Tap the map or search an address, then tap “Confirm” below.',
     dl_decide_a:'Set this spot as “',dl_decide_b:'”',dl_hint_naha:'Station/hotel via dropdown; parking via map. Naha delivers/collects across Okinawa main island.',dl_hint_spk:'Sapporo delivers/collects in Sapporo & Kitahiroshima. Outside the area, please ask.',
     dl_target_del:'📍 Delivery',dl_target_col:'🏁 Collection',lc_undecided:'Not set',lc_change:'Change',lc_del:'Delivery spot',lc_col:'Collection spot',dl_selecting:'Selected: ',dl_same_as:'Same as delivery',dl_next_col:'Now choose the <b>collection spot</b> on the map and tap “Confirm” (or tick the box above if same as delivery).'},
   zh:{cf_edit:'✏️ 變更',cf_store:'門市',cf_recvm:'取車方式',cf_use:'租用',cf_booker:'預約人',cf_none:'無',cf_days_unit:'日',cf_x:'×',
     md_del:'送車／送達：',md_col:'／收車：',md_same:'相同',md_unset:'未指定',md_air:'免費接送／去程：',md_air2:'・回程：',md_store_a:'到店（',md_store_b:'）',
     dl_place_map:'請於地圖指定取車・收車地點',dl_place_sel:'請選擇取車・收車地點',dl_colsame:'收車地點與送車相同',
     dl_ph_park:'以停車場名・地址搜尋',dl_ph_addr:'以地址・飯店名搜尋',dl_search:'🔍 搜尋',dl_lt_station:'🚉 車站',dl_lt_hotel:'🏨 飯店',dl_lt_park:'🅿️ 投幣停車場',
     dl_pend_sel:'請選擇地點後，按下方「確定」。',dl_pend_map:'點地圖或以地址搜尋選擇地點後，按下方「確定」。',
     dl_decide_a:'將此地點設為「',dl_decide_b:'」',dl_hint_naha:'車站・飯店用下拉，投幣停車場用地圖指定。那覇於沖繩本島對應區域送車／收車。',dl_hint_spk:'札幌於札幌市・北廣島市送車／收車。區域外請洽詢。',
     dl_target_del:'📍 送車地點',dl_target_col:'🏁 收車地點',lc_undecided:'未定',lc_change:'變更',lc_del:'送車地點',lc_col:'收車地點',dl_selecting:'選擇中：',dl_same_as:'與送車相同',dl_next_col:'請接著於地圖選擇<b>收車地點</b>並按「確定」（若與送車相同請勾選上方）。'},
   ko:{cf_edit:'✏️ 변경',cf_store:'매장',cf_recvm:'수령 방법',cf_use:'이용',cf_booker:'예약자',cf_none:'없음',cf_days_unit:'일간',cf_x:'×',
     md_del:'배달／전달: ',md_col:' / 회수: ',md_same:'동일',md_unset:'미지정',md_air:'무료 셔틀 / 가는편: ',md_air2:' · 오는편: ',md_store_a:'방문(',md_store_b:')',
     dl_place_map:'지도에서 수령·회수 장소를 지정하세요',dl_place_sel:'수령·회수 장소를 선택하세요',dl_colsame:'회수 장소를 배달과 동일하게',
     dl_ph_park:'주차장명·주소로 검색',dl_ph_addr:'주소·호텔명으로 검색',dl_search:'🔍 검색',dl_lt_station:'🚉 역',dl_lt_hotel:'🏨 호텔',dl_lt_park:'🅿️ 코인주차장',
     dl_pend_sel:'장소를 선택한 뒤 아래 「확정」을 누르세요.',dl_pend_map:'지도를 탭하거나 주소로 검색해 장소를 선택한 뒤 아래 「확정」을 누르세요.',
     dl_decide_a:'이 장소를 「',dl_decide_b:'」(으)로 확정',dl_hint_naha:'역·호텔은 드롭다운, 코인주차장은 지도로 지정. 나하는 오키나와 본섬 대응 지역으로 배달/회수합니다.',dl_hint_spk:'삿포로는 삿포로시·기타히로시마시로 배달/회수합니다. 지역 외는 문의해 주세요.',
     dl_target_del:'📍 배달 장소',dl_target_col:'🏁 회수 장소',lc_undecided:'미정',lc_change:'변경',lc_del:'배달 장소',lc_col:'회수 장소',dl_selecting:'선택 중: ',dl_same_as:'배달과 동일',dl_next_col:'이어서 지도에서 <b>회수 장소</b>를 선택하고 「확정」을 누르세요(배달과 동일하면 위 체크).'}
  };
  // ===== ハンバーガーメニュー項目（全ページ共通） =====
  var MENU={
   ja:{mn_guide_nha:'ご利用方法（沖縄那覇店）',mn_guide_spk:'ご利用方法（札幌店）',mn_cars:'ラインナップ',mn_ins:'保険プラン一覧',mn_faq_nha:'よくある質問（沖縄那覇店）',mn_faq_spk:'よくある質問（札幌店）',mn_contact:'お問い合わせ',mn_bus:'空港送迎バス',
     bp_title:'空港送迎バス',bp_sub:'沖縄・那覇空港店｜無料・定時運行',bp_tt_head:'🚌 運行時刻表',bp_tt_sub:'コースター／定員20名・空港⇔ヤード往復',bp_noreserve:'✅ 無料・定時運行のためご予約は必要ありません。お時間に合わせて、そのままバス乗り場へお越しください。',bp_air:'✈ 空港出発便',bp_air_rt:'那覇空港 レンタカー送迎バス乗り場11番 → HANDYMAN',bp_yard:'🏢 ヤード出発便',bp_yard_rt:'HANDYMAN → 那覇空港 出発口',bp_tt_hint:'※ 運行時刻は目安です。当日の交通状況により多少前後する場合があります。営業時間 9:00〜19:00。',
     bp_guide_head:'🚌 無料送迎バスのご案内',bp_arr_head:'✈ お迎え（ご到着時）',bp_arr_1:'到着ロビーを出て「レンタカー送迎バス 11-B のりば」までお進みください（看板が目印です）。',bp_arr_2:'HANDYMAN（ハンディーマン）の停車場〔11-B・14番〕に無料送迎バスが到着します。ご乗車ください。',bp_ret_head:'🏢 お送り（ご返却時）',bp_ret_1:'ご返却後、第2ヤードの乗り場から無料送迎バスで那覇空港へお送りします。',bp_ret_2:'返却場所の目印：「HANDYMAN Parking area」の看板が第2ヤードです。',bp_map:'🗺 送迎バス乗り場を地図で見る',bp_back:'← トップへ戻る'},
   en:{mn_guide_nha:'How to use (Naha, Okinawa)',mn_guide_spk:'How to use (Sapporo)',mn_cars:'Cars & Rates',mn_ins:'Insurance plans',mn_faq_nha:'FAQ (Naha, Okinawa)',mn_faq_spk:'FAQ (Sapporo)',mn_contact:'Contact',mn_bus:'Airport shuttle bus',
     bp_title:'Airport Shuttle Bus',bp_sub:'Naha Airport, Okinawa｜Free, scheduled service',bp_tt_head:'🚌 Timetable',bp_tt_sub:'Coaster / 20 seats · Airport ⇔ Yard round trip',bp_noreserve:'✅ Free, scheduled service — no reservation needed. Just come to the bus stop at your time.',bp_air:'✈ From airport',bp_air_rt:'Naha Airport rental shuttle stop No.11 → HANDYMAN',bp_yard:'🏢 From yard',bp_yard_rt:'HANDYMAN → Naha Airport departures',bp_tt_hint:'※ Times are approximate and may shift with traffic. Hours 9:00–19:00.',
     bp_guide_head:'🚌 Free shuttle bus guide',bp_arr_head:'✈ Pick-up (on arrival)',bp_arr_1:'Exit the arrivals lobby and head to “Rental Car Shuttle Bus Stop 11-B” (look for the sign).',bp_arr_2:'The free shuttle arrives at HANDYMAN’s stop (11-B / No.14). Please board.',bp_ret_head:'🏢 Drop-off (on return)',bp_ret_1:'After return, the free shuttle takes you from the 2nd Yard stop to Naha Airport.',bp_ret_2:'Landmark: the “HANDYMAN Parking area” sign marks the 2nd Yard.',bp_map:'🗺 View bus stop on map',bp_back:'← Back to top'},
   zh:{mn_guide_nha:'使用方式（沖繩那覇店）',mn_guide_spk:'使用方式（札幌店）',mn_cars:'車輛與費用',mn_ins:'保險方案一覽',mn_faq_nha:'常見問題（沖繩那覇店）',mn_faq_spk:'常見問題（札幌店）',mn_contact:'聯絡我們',mn_bus:'機場接送巴士',
     bp_title:'機場接送巴士',bp_sub:'沖繩・那覇機場店｜免費・定時運行',bp_tt_head:'🚌 運行時刻表',bp_tt_sub:'Coaster／定員20名・機場⇔停車場往返',bp_noreserve:'✅ 免費・定時運行，無需預約。請於時間直接前往乘車處。',bp_air:'✈ 機場出發',bp_air_rt:'那覇機場 租車接送巴士11號乘車處 → HANDYMAN',bp_yard:'🏢 停車場出發',bp_yard_rt:'HANDYMAN → 那覇機場 出境口',bp_tt_hint:'※ 時刻為參考，當日可能因交通狀況略有變動。營業時間 9:00〜19:00。',
     bp_guide_head:'🚌 免費接駁巴士指南',bp_arr_head:'✈ 接機（抵達時）',bp_arr_1:'走出入境大廳，前往「租車接駁巴士 11-B 乘車處」（看板為標記）。',bp_arr_2:'免費接駁巴士會抵達 HANDYMAN 的停靠處（11-B・14號），請上車。',bp_ret_head:'🏢 送機（還車時）',bp_ret_1:'還車後，將由第2停車場乘車處以免費接駁巴士送您至那覇機場。',bp_ret_2:'還車地點標記：此「HANDYMAN Parking area」看板即為第2停車場。',bp_map:'🗺 於地圖查看乘車處',bp_back:'← 返回首頁'},
   ko:{mn_guide_nha:'이용 방법(오키나와 나하점)',mn_guide_spk:'이용 방법(삿포로점)',mn_cars:'차량 및 요금',mn_ins:'보험 플랜 목록',mn_faq_nha:'자주 묻는 질문(오키나와 나하점)',mn_faq_spk:'자주 묻는 질문(삿포로점)',mn_contact:'문의',mn_bus:'공항 셔틀버스',
     bp_title:'공항 셔틀버스',bp_sub:'오키나와・나하공항점｜무료・정시 운행',bp_tt_head:'🚌 운행 시각표',bp_tt_sub:'코스터/정원 20명·공항⇔야드 왕복',bp_noreserve:'✅ 무료・정시 운행이므로 예약이 필요 없습니다. 시간에 맞춰 바로 승차장으로 오세요.',bp_air:'✈ 공항 출발',bp_air_rt:'나하공항 렌터카 셔틀 승차장 11번 → HANDYMAN',bp_yard:'🏢 야드 출발',bp_yard_rt:'HANDYMAN → 나하공항 출발구',bp_tt_hint:'※ 운행 시각은 기준이며 당일 교통 상황에 따라 다소 변동될 수 있습니다. 영업시간 9:00~19:00.',
     bp_guide_head:'🚌 무료 셔틀버스 안내',bp_arr_head:'✈ 픽업(도착 시)',bp_arr_1:'입국장을 나와 「렌터카 셔틀버스 11-B 승차장」으로 이동하세요(간판이 표시).',bp_arr_2:'HANDYMAN 정류장(11-B・14번)에 무료 셔틀버스가 도착합니다. 탑승해 주세요.',bp_ret_head:'🏢 배웅(반납 시)',bp_ret_1:'반납 후 제2야드 승차장에서 무료 셔틀버스로 나하공항까지 모셔다드립니다.',bp_ret_2:'반납 장소 표시: 「HANDYMAN Parking area」 간판이 제2야드입니다.',bp_map:'🗺 지도에서 승차장 보기',bp_back:'← 처음으로'}
  };
  for(var _LM in MENU){if(DICT[_LM])for(var _kM in MENU[_LM])DICT[_LM][_kM]=MENU[_LM][_kM];}
  // ===== 無料送迎バスのご案内（マイページ my-nha と同一） =====
  var BG={
   ja:{bg_hd:'無料送迎バスのご案内',bg_arr:'🛬 那覇空港発 → HANDYMAN第2ヤード（出発場所）',bg_way:'📍 乗り場までの道順',bg_s1:'那覇空港1階の「出口4」から外に出ます。',bg_s2:'正面の横断歩道を渡ります。',bg_s3:'渡ったら右手（→）方向へ進みます。',bg_s4:'「レンタカー送迎バス 11-B のりば」まで進みます。',bg_s5:'HANDYMAN（ハンディーマン）の停車場〔11-B・14番〕に無料送迎バスが到着します。',bg_arr_note:'到着ロビーを出て「11-B のりば」から無料送迎バスにご乗車ください（看板が目印です）。',bg_dep:'🛫 第2ヤード発 → 那覇空港（お見送り）',bg_ret_sign:'返却場所の目印：この「HANDYMAN Parking area」の看板が第2ヤードです。',bg_dep_note:'ご返却後、第2ヤードの乗り場から無料送迎バスで那覇空港へお送りします。',bg_maplink:'🗺 送迎バス乗り場を地図で見る',air_busbtn:'🚌 空港送迎バスについて確認する（時刻表・のりば案内）',air_busbtn_short:'空港送迎バス 時刻表・のりば',ins_recommend:'★ おすすめ'},
   en:{bg_hd:'Free Shuttle Bus',bg_arr:'🛬 From Naha Airport → HANDYMAN 2nd Yard (departure)',bg_way:'📍 How to reach the bus stop',bg_s1:'Exit outside through "Exit 4" on the 1st floor of Naha Airport.',bg_s2:'Cross the pedestrian crossing straight ahead.',bg_s3:'After crossing, head to the right (→).',bg_s4:'Walk to "Rental Car Shuttle Bus, Stop 11-B".',bg_s5:"The free shuttle arrives at HANDYMAN's stop (11-B, No.14).",bg_arr_note:'Exit the arrivals lobby and board the free shuttle at "Bus Stop 11-B" (look for the sign).',bg_dep:'🛫 From 2nd Yard → Naha Airport (drop-off)',bg_ret_sign:'Return landmark: this "HANDYMAN Parking area" sign marks the 2nd Yard.',bg_dep_note:'After return, the free shuttle takes you from the 2nd Yard to Naha Airport.',bg_maplink:'🗺 View bus stop on map',air_busbtn:'🚌 About the airport shuttle bus (timetable & stop)',air_busbtn_short:'Airport shuttle · timetable & stop',ins_recommend:'★ Recommended'},
   zh:{bg_hd:'免費接駁巴士指南',bg_arr:'🛬 那霸機場出發 → HANDYMAN第2號場（出發地）',bg_way:'📍 前往乘車處的路線',bg_s1:'從那霸機場1樓「出口4」走出戶外。',bg_s2:'穿越正前方的斑馬線。',bg_s3:'過馬路後往右手邊（→）前進。',bg_s4:'前往「租車接駁巴士 11-B 乘車處」。',bg_s5:'免費接駁巴士會抵達 HANDYMAN 的停靠處（11-B・14號）。',bg_arr_note:'走出入境大廳，於「11-B」乘車處搭乘免費接駁巴士（看板為標記）。',bg_dep:'🛫 第2號場出發 → 那霸機場（送機）',bg_ret_sign:'還車地點標記：此「HANDYMAN Parking area」看板即為第2號場。',bg_dep_note:'還車後，免費接駁巴士將您從第2號場送往那霸機場。',bg_maplink:'🗺 於地圖查看乘車處',air_busbtn:'🚌 了解機場接送巴士（時刻表・乘車處）',air_busbtn_short:'機場接送巴士 時刻表・乘車處',ins_recommend:'★ 推薦'},
   ko:{bg_hd:'무료 셔틀버스 안내',bg_arr:'🛬 나하공항 출발 → HANDYMAN 제2야드(출발지)',bg_way:'📍 승차장까지 가는 길',bg_s1:'나하공항 1층 "출구 4"로 나갑니다.',bg_s2:'정면의 횡단보도를 건넙니다.',bg_s3:'건넌 뒤 오른쪽(→)으로 이동합니다.',bg_s4:'"렌터카 셔틀버스 11-B 승차장"까지 갑니다.',bg_s5:'HANDYMAN 정류장(11-B·14번)에 무료 셔틀버스가 도착합니다.',bg_arr_note:'도착 로비를 나와 "11-B" 승차장에서 무료 셔틀버스를 이용하세요(간판이 표시).',bg_dep:'🛫 제2야드 출발 → 나하공항(배웅)',bg_ret_sign:'반납 장소 표시: 이 "HANDYMAN Parking area" 간판이 제2야드입니다.',bg_dep_note:'반납 후 무료 셔틀버스가 제2야드에서 나하공항까지 모십니다.',bg_maplink:'🗺 지도에서 승차장 보기',air_busbtn:'🚌 공항 셔틀버스 안내 보기(시각표·승차장)',air_busbtn_short:'공항 셔틀버스 시각표·승차장',ins_recommend:'★ 추천'}
  };
  for(var _LB in BG){if(DICT[_LB])for(var _kB in BG[_LB])DICT[_LB][_kB]=BG[_LB][_kB];}
  for(var _L2 in FLOW2){if(DICT[_L2])for(var _k2 in FLOW2[_L2])DICT[_L2][_k2]=FLOW2[_L2][_k2];}
  for(var _L in FLOW){if(DICT[_L])for(var _k in FLOW[_L])DICT[_L][_k]=FLOW[_L][_k];}
  var SHORT={ja:'日本語',en:'EN',zh:'繁中',ko:'한국어'};
  var NAMES={ja:'日本語',en:'English',zh:'繁體中文',ko:'한국어'};
  function detect(){try{var s=localStorage.getItem('hdm_lang');if(s&&DICT[s])return s;var n=(navigator.language||'ja').toLowerCase();if(n.indexOf('ko')===0)return 'ko';if(n.indexOf('zh')===0)return 'zh';if(n.indexOf('en')===0)return 'en';}catch(e){}return 'ja';}
  var LANG=detect();
  window.hdmLang=function(){return LANG;};
  window.hdmT=function(k){var d=DICT[LANG]||DICT.ja;return (d[k]!=null?d[k]:(DICT.ja[k]!=null?DICT.ja[k]:k));};
  window.hdmApplyLang=function(){
    document.querySelectorAll('[data-i18n]').forEach(function(el){el.innerHTML=window.hdmT(el.getAttribute('data-i18n'));});
    document.querySelectorAll('[data-i18n-ph]').forEach(function(el){el.setAttribute('placeholder',window.hdmT(el.getAttribute('data-i18n-ph')));});
    document.querySelectorAll('option[data-i18n-opt]').forEach(function(el){el.textContent=window.hdmT(el.getAttribute('data-i18n-opt'));});
    try{document.documentElement.lang=LANG;}catch(e){}
    if(typeof window.hdmOnLang==='function'){try{window.hdmOnLang(LANG);}catch(e){}}
  };
  window.hdmSetLang=function(l){if(!DICT[l])return;LANG=l;try{localStorage.setItem('hdm_lang',l);}catch(e){}renderBtn();window.hdmApplyLang();};
  var wrap;
  function renderBtn(){if(!wrap)return;wrap.querySelector('.hdmlang-cur').textContent=SHORT[LANG];
    wrap.querySelectorAll('.hdmlang-menu button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-l')===LANG);});}
  function build(){
    var st=document.createElement('style');
    st.textContent='.hdmlang{position:fixed;top:10px;right:12px;z-index:9999;font-family:inherit}'+
      '.hdmlang.inslot{position:static;top:auto;right:auto}'+  /* メニュー枠内に置く時 */
      '.hdmlang-btn{display:flex;align-items:center;gap:6px;background:rgba(0,32,99,.92);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:7px 13px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit}'+
      '.hdmlang-menu{position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid #d8e0ee;border-radius:12px;box-shadow:0 10px 30px rgba(0,16,48,.18);overflow:hidden;display:none;min-width:150px;z-index:30}'+
      '.hdmlang.open .hdmlang-menu{display:block}'+
      '.hdmlang-menu button{display:block;width:100%;text-align:left;background:#fff;border:0;padding:11px 15px;font-size:13px;font-weight:700;color:#0a1f44;cursor:pointer;font-family:inherit}'+
      '.hdmlang-menu button:hover{background:#f2f6fc}.hdmlang-menu button.on{background:#002063;color:#fff}';
    document.head.appendChild(st);
    wrap=document.createElement('div');
    wrap.innerHTML='<button type="button" class="hdmlang-btn">🌐 <span class="hdmlang-cur"></span> ▾</button>'+
      '<div class="hdmlang-menu">'+['ja','en','zh','ko'].map(function(l){return '<button type="button" data-l="'+l+'">'+NAMES[l]+'</button>';}).join('')+'</div>';
    var slot=document.getElementById('hdmlang-slot');
    if(slot){wrap.className='hdmlang inslot';slot.appendChild(wrap);}
    else{wrap.className='hdmlang';document.body.appendChild(wrap);}
    wrap.querySelector('.hdmlang-btn').addEventListener('click',function(e){e.stopPropagation();wrap.classList.toggle('open');});
    wrap.querySelectorAll('.hdmlang-menu button').forEach(function(b){b.addEventListener('click',function(){window.hdmSetLang(b.getAttribute('data-l'));wrap.classList.remove('open');});});
    document.addEventListener('click',function(){wrap.classList.remove('open');});
    renderBtn();
  }
  function init(){build();window.hdmApplyLang();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
