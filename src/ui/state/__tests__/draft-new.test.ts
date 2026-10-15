import { describe, expect, it } from 'vitest';
import { analyzeDraft, createProjectFromDraft, draftTitle } from '../draft';
import { createSampleProject, SAMPLE_TXMD } from '../sample';

const KO_ONLY = SAMPLE_TXMD.split('\n').filter((l) => !/^@(en|ja) /.test(l)).join('\n');

describe('초안 → 새 프로젝트(+ 초안 흐름)', () => {
  it('첫 제목에서 이름 후보를 뽑는다(강조 기호 제거, 제목이 없으면 빈 문자열)', () => {
    expect(draftTitle(SAMPLE_TXMD)).toBe('배송이 시작되었습니다');
    expect(draftTitle('본문\n\n## **굵은** 제목 ~~x~~\n')).toBe('굵은 제목 x');
    expect(draftTitle('제목 없음\n@en x')).toBe('');
  });

  it('빈 초안은 오류, 경고는 오류가 아니다', () => {
    expect(analyzeDraft('  \n ').error).toBeTruthy();
    expect(() => createProjectFromDraft('', { name: 'x' })).toThrow();
    const a = analyzeDraft(SAMPLE_TXMD);
    expect(a.error).toBeNull();
    expect([...a.langsFound].sort()).toEqual(['en', 'ja']);
    expect(a.blockCount).toBeGreaterThan(10);
  });

  it('새 프로젝트: @en/@ja 줄이 초기 번역, templateCode·draftMarkup 반영, 샘플 프로젝트와 같은 구조', () => {
    const { project: p, warnings } = createProjectFromDraft(SAMPLE_TXMD, { name: '새 이름', templateCode: ' CODE_1 ' });
    expect(warnings).toEqual([]);
    expect(p.name).toBe('새 이름');
    expect(p.templateCode).toBe('CODE_1');
    expect(p.draftMarkup).toBe(SAMPLE_TXMD);
    expect(p.langs).toEqual(['ko', 'en', 'ja']);
    const s = createSampleProject(1);
    expect(p.structure).toBe(s.structure);
    expect(p.strings).toEqual(s.strings);
    const h = Object.entries(p.strings).find(([, v]) => v.ko === '배송이 시작되었습니다')!;
    expect(h[1].en).toBe('Your shipment is on its way');
    expect(h[1].ja).toBe('発送を開始しました');
    expect(createProjectFromDraft('# 제목\n\n본문\n', { name: 'n', templateCode: '  ' }).project.templateCode).toBeUndefined();
  });

  it('번역 줄이 없으면 en·ja 는 미번역으로 시작한다', () => {
    const { project: p } = createProjectFromDraft(KO_ONLY, { name: 'n' });
    const id = Object.keys(p.strings).find((k) => p.strings[k].ko === '배송이 시작되었습니다')!;
    expect(p.strings[id].en ?? '').toBe('');
  });

  it('파서 경고(콜아웃 안 동적 표)는 오류가 아니라 경고로만 나온다', () => {
    const txt = '# 제목\n\n[정보: 안내]\n제목\n\n[표: 가로형, 동적: t]\n{a| b}\n- {{a}}| {{b}}\n[/표]\n[/정보]\n';
    const a = analyzeDraft(txt);
    expect(a.error).toBeNull();
    expect(a.warnings.length).toBeGreaterThan(0);
    expect(createProjectFromDraft(txt, { name: 'n' }).warnings.length).toBeGreaterThan(0);
  });
});
