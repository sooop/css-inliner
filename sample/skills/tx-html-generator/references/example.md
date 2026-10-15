# .txmd 예시 (세 언어 메일 + 공지)

아래 두 블록은 **실제로 `tx_generate.py` 로 검증을 통과한 완성 예시**다(`tests/test_parity.py` 의 `ExampleDocs` 가 이 파일의 ` ```txmd ` 블록을 전부 꺼내 오류 0건·경고 0건인지 확인한다).
블록 전체(머리말 `---` 포함)를 그대로 `.txmd` 파일로 저장하면 앱 '프로젝트 > .txmd 불러오기' 로 읽힌다. 문법 설명은 `MARKUP_SYNTAX.md`.

## 1. 메일 예시 (kind: mail) — 치환자·동적 표·버튼 포함

```txmd
---
kind: mail
name: 배송 시작 안내
templateCode: SHIP_START
subject.ko: |!#-cust_nm|님, 주문하신 상품의 배송이 시작되었습니다
subject.en: |!#-cust_nm|, your order is on its way
subject.ja: |!#-cust_nm|様、ご注文の商品を発送しました
---
# 배송이 시작되었습니다
@en Your order is on its way
@ja 発送を開始しました

안녕하세요, |!#-cust_nm|님!
주문하신 상품이 **오늘 출고**되었습니다.
@en Hello, |!#-cust_nm|!
@en Your order **shipped today**.
@ja |!#-cust_nm|様、こんにちは。
@ja ご注文の商品を**本日出荷**しました。

[표: 세로형]
- 주문번호: |!#-order_no|
@en - Order No.: |!#-order_no|
@ja - 注文番号: |!#-order_no|
- 운송장번호: |!#-tracking_no|
@en - Tracking No.: |!#-tracking_no|
@ja - 送り状番号: |!#-tracking_no|
- 배송업체: CJ대한통운
@en - Carrier: CJ Logistics
@ja - 配送業者: CJ大韓通運
- 예상 도착| |!#-est_delivery_date|
@en - Estimated arrival| |!#-est_delivery_date|
@ja - 到着予定| |!#-est_delivery_date|
[/표]

## 주문 상품
@en Items in your order
@ja ご注文の商品

[표: 가로형, 동적: items]
{상품명| 수량| 금액}
@en {Item| Qty| Amount}
@ja {商品名| 数量| 金額}
- {{name}}| {{qty}}개| ~~{{list_price}}원~~ {{price}}원
@en - {{name}}| {{qty}} pcs| ~~{{list_price}} KRW~~ {{price}} KRW
@ja - {{name}}| {{qty}}個| ~~{{list_price}}ウォン~~ {{price}}ウォン
@var name 상품명
@var qty 수량
@var list_price 정가
@var price 판매가
@sample name=무선 이어폰| qty=2| list_price=100,000| price=90,000
@sample name=보조배터리| qty=1| list_price=40,000| price=32,000
[/표]

[정보: 배송 추적]
@en Track your shipment
@ja 配送状況の確認
택배사 사정에 따라 **배송 조회가 반영되기까지 최대 2시간**이 걸릴 수 있습니다.
@en It may take **up to 2 hours** for tracking updates to appear, depending on the carrier.
@ja 配送業者の都合により、**配送状況が反映されるまで最大2時間**かかる場合があります。

- 부재 시 경비실 또는 택배함에 보관됩니다.
@en If you are out, the parcel is left with the security desk or in the parcel locker.
@ja ご不在の場合は、管理室または宅配ボックスに預けられます。
- 3일 이내에 수령하지 않으면 반송될 수 있습니다.
@en Parcels not collected within 3 days may be returned.
@ja 3日以内に受け取られない場合は、返送されることがあります。

[버튼, 배송 추적하기, https://tracking.tracxlogis.com?no=|!#-tracking_no|, primary]
@en Track shipment
@ja 配送を追跡する
[버튼, 고객센터 문의, https://support.tracxlogis.com, secondary]
@en Contact support
@ja お問い合わせ
[/정보]

> 이 메일은 발신 전용입니다. 문의는 고객센터를 이용해 주세요.
@en This email is send-only. Please contact our support center for inquiries.
@ja このメールは送信専用です。お問い合わせはサポートセンターをご利用ください。
```

## 2. 공지 예시 (kind: notice) — 치환자·동적 표 없음

```txmd
---
kind: notice
name: 정기 점검 안내
subject.ko: [공지] 시스템 정기 점검 안내 (10/20)
subject.en: [Notice] Scheduled system maintenance (Oct 20)
subject.ja: [お知らせ] システム定期メンテナンスのご案内 (10/20)
---
# 시스템 정기 점검 안내
@en Scheduled system maintenance
@ja システム定期メンテナンスのご案内

고객 여러분께 안내드립니다.
서비스 안정성 향상을 위해 아래 일정으로 정기 점검을 실시합니다.
@en We would like to inform you that scheduled maintenance will be carried out as follows to improve service stability.
@ja サービスの安定性向上のため、下記の日程で定期メンテナンスを実施いたします。

[표: 가로형]
{일자| 시간| 영향 범위}
@en {Date| Time| Impact}
@ja {日付| 時間| 影響範囲}
- 10월 20일| 02:00-04:00| 전체 서비스 중단
@en - Oct 20| 02:00-04:00| Full service outage
@ja - 10月20日| 02:00-04:00| 全サービス停止
- 10월 22일| 01:00-02:00| 주문 수집 일시 지연
@en - Oct 22| 01:00-02:00| Order collection temporarily delayed
@ja - 10月22日| 01:00-02:00| 注文収集の一時遅延
[/표]

[경고: 서비스 중단]
@en Service outage
@ja サービス停止
점검 시간 동안 다음 기능을 이용하실 수 없습니다.
@en The following features are unavailable during maintenance.
@ja メンテナンス中は、以下の機能をご利用いただけません。

- 주문 및 결제
@en Orders and payments
@ja ご注文・お支払い
- 배송 조회
@en Shipment tracking
@ja 配送状況の確認
[/경고]

[강조: 사전 조치]
@en Before maintenance begins
@ja 事前のお願い
점검 시작 전에 진행 중인 작업을 **저장**해 주세요.
@en Please **save** any work in progress before maintenance begins.
@ja メンテナンス開始前に、作業中の内容を**保存**してください。
[/강조]

[버튼, 공지사항 전체보기, https://notice.tracxlogis.com, secondary]
@en View all notices
@ja お知らせ一覧を見る
```
