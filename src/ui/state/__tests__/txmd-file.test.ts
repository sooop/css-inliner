import { describe, expect, it } from 'vitest';
import { createProjectFromTxmdFile } from '../draft';
import { projectKind } from '../../../project/model';

const BODY = '# 배송 시작 안내\n\n주문이 출발했습니다.\n@en Your order is on its way.\n';

describe('머리말 포함 .txmd → 프로젝트', () => {
  it('메일: 이름·코드·제목·번역', () => {
    const t = '---\nname: 배송 시작\ntemplateCode: SHIP_START\nsubject.ko: 배송 시작\nsubject.en: Shipped\nsubject.ja: 発送\n---\n' + BODY;
    const { project: p, warnings } = createProjectFromTxmdFile(t, 'fb');
    expect(warnings).toEqual([]);
    expect(projectKind(p)).toBe('mail');
    expect(p.name).toBe('배송 시작');
    expect(p.templateCode).toBe('SHIP_START');
    expect(p.subject).toEqual({ ko: '배송 시작', en: 'Shipped', ja: '発送' });
    expect(Object.values(p.strings).some((s) => s.en === 'Your order is on its way.')).toBe(true);
    expect(p.draftMarkup).toBe(BODY);
  });

  it('머리말이 없으면 본문만: 이름은 첫 제목, 제목은 빈 문자열', () => {
    const { project: p } = createProjectFromTxmdFile(BODY, 'fb');
    expect(p.name).toBe('배송 시작 안내');
    expect(p.subject).toEqual({ ko: '', en: '', ja: '' });
    expect(createProjectFromTxmdFile('본문\n', 'fb').project.name).toBe('fb');
  });

  it('공지: 셸 없음, 일부 언어만 제목, 잘못된 kind 는 경고 후 메일', () => {
    const n = createProjectFromTxmdFile('---\nkind: notice\nsubject.ko: 점검 안내\n---\n' + BODY, 'fb').project;
    expect(projectKind(n)).toBe('notice');
    expect(n.subject.ko).toBe('점검 안내');
    expect(n.subject.en).toBe('');
    expect(n.structure).not.toContain('data-tx-shell');
    const m = createProjectFromTxmdFile('---\nkind: x\n---\n' + BODY, 'fb');
    expect(projectKind(m.project)).toBe('mail');
    expect(m.warnings.length).toBe(1);
  });

  it('공지 + 동적 표, 빈 본문은 예외(프로젝트를 만들지 않음)', () => {
    const dyn = '---\nkind: notice\n---\n[표: 가로형, 동적: orders]\n{상품명| 수량}\n- {{name}}| {{qty}}\n[/표]\n';
    expect(() => createProjectFromTxmdFile(dyn, 'fb')).toThrow();
    expect(() => createProjectFromTxmdFile('---\nname: x\n---\n', 'fb')).toThrow();
  });
});
