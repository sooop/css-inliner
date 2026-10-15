/** 왕복 테스트용 .txmd 입력들(번역 줄·동적 표·콜아웃 본문·인라인 서식 등 골든에 없는 문법) */
export const FIXTURES: Record<string, string> = {
  'TXMD §1 예': `# 배송 시작 안내
@en Your shipment is on its way
@ja 発送開始のお知らせ

안녕하세요, |!#-cust_nm|님!
@en Hello, |!#-cust_nm|!
@ja |!#-cust_nm|様、こんにちは。

[표: 세로형]
- 주문번호: |!#-order_no|
@en - Order No: |!#-order_no|
[/표]

[정보: 배송 추적]
@en Track shipment
실시간으로 확인하세요.
@en Check in real time.
[/정보]

[버튼, 배송 추적하기, https://t.com/|!#-tracking_no|, primary]
@en Track shipment
`,
  'TXMD §3 동적 표': `[표: 가로형, 동적: orders]
{상품명| 수량| 금액}
@en {Item| Qty| Amount}
- {{name}}| {{qty}}개| {{amount}}원
@en - {{name}}| {{qty}} pcs| {{amount}} KRW
@var name 상품명
@var qty 수량
@sample name=무선 이어폰| qty=2| amount=90,000
@sample name=보조배터리| qty=1| amount=32,000
[/표]
`,
  'TXMD §4-A 콜아웃 본문': `[정보: 연동 확인]
@en Check before linking
시작 전에 **준비**하세요.
@en Prepare **first**.

- 계정
@en Account

[표: 세로형]
- 업체: CJ
@en - Carrier: CJ
[/표]

[버튼, 추적, https://t.com/|!#-no|, primary]
@en Track
[/정보]
`,
  '중첩 목록 + 번역': `- 부모 항목
@en Parent
  - 자식 1
  @en Child 1
  - 자식 2
    1. 손자 순서
    2. 손자 둘
- 다음 부모
@ja 次の親
`,
  '인용 번역 두 형태': `> 인용 첫 줄
> 둘째 줄
@en Quote first
@en Second

> 다른 인용
> @en Another quote
`,
  '버튼 그룹 번역': `[버튼, 신청하기, https://a.com]
@en Apply
[버튼, 취소, https://b.com, warn]
@en Cancel
@ja キャンセル
`,
  '콜아웃 안 인용·구분선·중첩 콜아웃': `[경고: 주의]
첫 문단

> 인용
---
[정보]
안쪽 콜아웃
[/정보]
[/경고]
`,
  '인라인 서식 조합': `**굵게** *기울임* ~~취소선~~ ***둘 다*** **~~굵은 취소~~** [**링크**](https://a.com/x?a=1&b=2) 와 월~금 그리고 2 * 3
단일 중괄호 {name} 과 |!#-code| 와 **|!#-var|**
`,
  '문단 사이 번역 줄 섞임': `첫 줄
@en First
둘째 줄
@en Second
`,
  '연결되지 않은 번역 줄': `---
@en dangling

문단
`,
  '제목 번역과 h1~h3': `# 제목1
@en Title1
## 제목2
### 제목3
@ja 見出し3
`,
  '빈 입력': ``,
  '표 안 빈 칸·경계': `[표: 가로형]
{a| b| c}
- 1| | 3
- | 5| 
[/표]
`,
  '번역 줄 없는 ko 전용': `그냥 문단입니다.

- 항목
- 항목2
`,
};
