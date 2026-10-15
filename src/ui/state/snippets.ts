/** 내장 스니펫(복사형): 삽입하면 사본이 만들어지고 원본을 고쳐도 이미 넣은 곳은 바뀌지 않는다. 사용자 스니펫 저장은 P6. */
import type { AddKind } from './ops';

export interface SnippetDef {
  id: string;
  name: string;
  desc: string;
  kind: AddKind;
  texts: Record<string, string[]>;
}

export const SNIPPETS: SnippetDef[] = [
  {
    id: 'support-callout',
    name: '고객센터 안내 콜아웃',
    desc: '정보 박스 + 운영 시간·연락처',
    kind: 'callout',
    texts: {
      ko: ['고객센터 안내', '평일 09:00-18:00 · 1588-0000'],
      en: ['Customer Support', 'Weekdays 09:00-18:00 · 1588-0000'],
      ja: ['カスタマーセンター', '平日 09:00-18:00 · 1588-0000'],
    },
  },
  {
    id: 'delay-notice',
    name: '배송 지연 안내 문단',
    desc: '기상 악화 등으로 인한 지연 사과 문구',
    kind: 'paragraph',
    texts: {
      ko: ['기상 악화로 배송이 지연될 수 있습니다. 불편을 드려 죄송합니다.'],
      en: ['Delivery may be delayed due to bad weather. We apologize for the inconvenience.'],
      ja: ['悪天候により配送が遅れる場合があります。ご不便をおかけし申し訳ございません。'],
    },
  },
  {
    id: 'cta-button',
    name: 'CTA 버튼',
    desc: '기본 버튼 1개(링크는 속성 패널에서 지정)',
    kind: 'button',
    texts: { ko: ['자세히 보기'], en: ['View details'], ja: ['詳細を見る'] },
  },
];
