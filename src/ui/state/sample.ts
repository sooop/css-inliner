/** 빈 상태용 샘플 프로젝트(배송 시작 안내, 동적 표 1개 포함). .txmd 에서 만들어 실제 파서·ID 체계를 그대로 쓴다. */
import { createProject, type Project } from '../../project/model';
import { planDraft } from './draft';

export const SAMPLE_TXMD = `# 배송이 시작되었습니다
@en Your shipment is on its way
@ja 発送を開始しました

안녕하세요, |!#-cust_nm|님. 주문하신 **|!#-item_cnt|개** 상품이 물류센터를 출발했습니다.
@en Hello, |!#-cust_nm|. Your **|!#-item_cnt| items** have left our logistics center.
@ja |!#-cust_nm|様、ご注文の**|!#-item_cnt|点**が物流センターを出発しました。

[표: 세로형]
- 운송장 번호: |!#-tracking_no|
@en - Tracking no.: |!#-tracking_no|
@ja - 送り状番号: |!#-tracking_no|
- 택배사: |!#-carrier_nm|
@en - Carrier: |!#-carrier_nm|
@ja - 配送会社: |!#-carrier_nm|
- 도착 예정: |!#-eta_dt|
@en - Estimated arrival: |!#-eta_dt|
@ja - お届け予定: |!#-eta_dt|
[/표]

[표: 가로형, 동적: stock]
{SKU| 상품명| 수량}
@en {SKU| Product| Qty}
@ja {SKU| 商品名| 数量}
- {{sku}}| {{name}}| {{qty}}개
@en - {{sku}}| {{name}}| {{qty}}
@ja - {{sku}}| {{name}}| {{qty}}個
@var sku 상품 SKU 코드
@var name 상품명(서버가 언어에 맞게 제공)
@var qty 입고 수량(정수)
@sample sku=WM-1001| name=Wireless Mouse| qty=12
@sample sku=KB-2040| name=Mechanical Keyboard| qty=5
@sample sku=HB-3310| name=USB-C Hub| qty=28
[/표]

[정보: 수령 안내]
@en Receiving your parcel
@ja 受け取りについて
부재 시 경비실 또는 문 앞에 보관될 수 있으며, 도착 예정일은 변동될 수 있습니다.
@en If no one is home, the parcel may be left with building security. The estimated date may change.
@ja 不在の場合は管理室に預けられることがあります。お届け予定日は変更になる場合があります。
[/정보]

[버튼, 배송 조회하기, https://track.example.com/|!#-tracking_no|, primary]
@en Track shipment
@ja 配送状況を確認

본 메일은 발신 전용입니다. 문의: 고객센터 1588-0000
@en This is a send-only address. Support: 1588-0000
@ja このメールは送信専用です。お問い合わせ:1588-0000
`;

const VAR_DESC: Record<string, { description: string; sample: string }> = {
  cust_nm: { description: '고객명(받는 사람)', sample: '홍길동' },
  item_cnt: { description: '상품 수량', sample: '3' },
  tracking_no: { description: '운송장 번호', sample: '6048 2291 7734' },
  carrier_nm: { description: '택배사 이름', sample: 'TX 익스프레스' },
  eta_dt: { description: '도착 예정일', sample: '2026-10-16(금)' },
};

export function createSampleProject(now: number = Date.now()): Project {
  const blank = createProject({
    name: '배송 시작 안내 (샘플)',
    templateCode: 'SHIP_START',
    subject: {
      ko: '[TRACXLOGIS] 주문하신 상품의 배송이 시작되었습니다',
      en: '[TRACXLOGIS] Your shipment is on its way',
      ja: '【TRACXLOGIS】ご注文商品の発送を開始しました',
    },
    updatedAt: now,
  });
  const p = planDraft(blank, SAMPLE_TXMD).next;
  return { ...p, variables: p.variables.map((v) => ({ ...v, ...(VAR_DESC[v.name] ?? {}) })) };
}

/** 새(빈) 프로젝트 */
export function createBlankProject(name: string): Project {
  return createProject({ name, subject: { ko: '', en: '', ja: '' } });
}
