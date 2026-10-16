import elements from '../samples/elements.html?raw';
import maintenance from '../samples/maintenance.html?raw';
import lowStock from '../samples/low-stock.html?raw';
import pendingOrder from '../samples/pending-order.html?raw';
import welcome from '../samples/welcome.html?raw';
import passwordChanged from '../samples/password-changed.html?raw';

export const DEFAULT_SAMPLE_ID = 'elements';

export const SAMPLES = [
  { id: 'elements', label: '요소 확인 샘플', html: elements },
  { id: 'maintenance', label: '시스템 점검 안내', html: maintenance },
  { id: 'low-stock', label: '재고 부족 알림', html: lowStock },
  { id: 'pending-order', label: '펜딩 주문 알림', html: pendingOrder },
  { id: 'welcome', label: '회원 가입 감사', html: welcome },
  { id: 'password-changed', label: '비밀번호 변경', html: passwordChanged }
];

export function getSample(id) {
  return SAMPLES.find(s => s.id === id);
}
