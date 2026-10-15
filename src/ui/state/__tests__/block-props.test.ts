import { describe, expect, it } from 'vitest';
import { listTopBlocks } from '../ops';
import {
  getButtonGroupInfo,
  getButtonStyle,
  getCalloutKind,
  getHeadingLevel,
  getListType,
  groupButtonWithNext,
  setButtonStyle,
  setCalloutKind,
  setHeadingLevel,
  setListType,
  ungroupButtons,
} from '../block-props';
import { cellState, staleSet } from '../strings';
import { createSampleProject } from '../sample';
import { listBlocks } from '../../../markup/ids';

const S = [
  '<h1 data-t="a1">제목</h1>',
  '<h2 data-t="a2">소제목</h2>',
  '<div class="callout callout-info">',
  '<h3 data-t="c1">콜아웃 제목</h3>',
  '<p data-t="c2">본문</p>',
  '<ul>',
  '<li data-t="c3">콜 안 목록 <ol><li data-t="c4">중첩</li></ol></li>',
  '</ul>',
  '</div>',
  '<ul>',
  '<li data-t="l1">하나</li>',
  '<li data-t="l2">둘 <ol><li data-t="l3">중첩 하나</li></ol></li>',
  '</ul>',
  '<p><a href="https://x.test/a?b=1&amp;c=2" class="btn btn-primary" data-t="b1">확인</a></p>',
  '<p><a href="#" class="btn btn-ghost" data-t="b2">취소</a></p>',
  '<p class="btn-group"><a href="#" class="btn btn-secondary" data-t="b3">셋</a><a href="#" class="btn btn-outline" data-t="b4">넷</a></p>',
].join('\n');

function proj() {
  const base = createSampleProject(1);
  const strings: Record<string, Record<string, string>> = {};
  const sourceHash: typeof base.sourceHash = {};
  for (const b of listBlocks(S)) strings[b.id] = { ko: `ko-${b.id}`, en: `en-${b.id}`, ja: `ja-${b.id}` };
  return { ...base, structure: S, strings, sourceHash, dynamicTables: [] };
}

describe('콜아웃 종류', () => {
  it('종류를 읽고 바꾼다(콜아웃 안 다른 블록·문자열은 그대로)', () => {
    const p = proj();
    expect(getCalloutKind(p.structure, 'c2')).toBe('info');
    expect(getCalloutKind(p.structure, 'a1')).toBeUndefined();
    const n = setCalloutKind(p, 'c2', 'warn')!;
    expect(n.structure).toBe(p.structure.replace('callout callout-info', 'callout callout-warn'));
    expect(n.strings).toBe(p.strings);
    expect(n.sourceHash).toBe(p.sourceHash);
    expect(getCalloutKind(n.structure, 'c1')).toBe('warn');
    expect(listTopBlocks(n.structure).map((b) => b.kind)).toEqual(listTopBlocks(p.structure).map((b) => b.kind));
  });
  it('같은 종류거나 콜아웃이 아니면 null', () => {
    const p = proj();
    expect(setCalloutKind(p, 'c1', 'info')).toBeNull();
    expect(setCalloutKind(p, 'a1', 'warn')).toBeNull();
  });
  it('종류 클래스가 없으면 추가하고, 다른 클래스는 보존', () => {
    const p = { ...proj(), structure: '<div class="callout x"><p data-t="z">t</p></div>' };
    const n = setCalloutKind(p, 'z', 'accent')!;
    expect(n.structure).toBe('<div class="callout x callout-accent"><p data-t="z">t</p></div>');
  });
  it('번역은 오래됨이 되지 않는다', () => {
    const base = createSampleProject(1);
    const id = listTopBlocks(base.structure).find((b) => b.kind === 'callout')!.ids[0];
    const n = setCalloutKind(base, id, 'warn')!;
    const stale = staleSet(n);
    expect(stale).toEqual(staleSet(base));
    for (const l of n.langs) expect(cellState(n, id, l, stale)).toBe(cellState(base, id, l, staleSet(base)));
  });
});

describe('제목 레벨', () => {
  it('태그만 교체(여는·닫는 태그)', () => {
    const p = proj();
    expect(getHeadingLevel(p.structure, 'a2')).toBe(2);
    const n = setHeadingLevel(p, 'a2', 3)!;
    expect(n.structure).toBe(p.structure.replace('<h2 data-t="a2">소제목</h2>', '<h3 data-t="a2">소제목</h3>'));
    expect(n.structure).toContain('<h3 data-t="a2">소제목</h3>');
    expect(n.strings).toBe(p.strings);
  });
  it('콜아웃 제목·제목 아님·같은 레벨은 null', () => {
    const p = proj();
    expect(getHeadingLevel(p.structure, 'c1')).toBeUndefined();
    expect(setHeadingLevel(p, 'c1', 2)).toBeNull();
    expect(setHeadingLevel(p, 'l1', 2)).toBeNull();
    expect(setHeadingLevel(p, 'a1', 1)).toBeNull();
  });
});

describe('목록 ul↔ol', () => {
  it('해당 레벨 한 곳만 바꾼다(중첩 포함)', () => {
    const p = proj();
    expect(getListType(p.structure, 'l1')).toBe('ul');
    expect(getListType(p.structure, 'l3')).toBe('ol');
    const outer = setListType(p, 'l1', 'ol')!;
    expect(outer.structure).toContain('<ol>\n<li data-t="l1">하나</li>\n<li data-t="l2">둘 <ol><li data-t="l3">중첩 하나</li></ol></li>\n</ol>');
    expect(outer.structure).toContain('<ul>\n<li data-t="c3">'); // 콜아웃 안 목록은 그대로
    const inner = setListType(p, 'l3', 'ul')!;
    expect(inner.structure).toContain('<ul><li data-t="l3">중첩 하나</li></ul>');
    expect(inner.structure).toContain('<ul>\n<li data-t="l1">'); // 바깥 목록은 그대로
    expect(inner.strings).toBe(p.strings);
  });
  it('같은 종류면 null, 목록 밖이면 null', () => {
    const p = proj();
    expect(setListType(p, 'l1', 'ul')).toBeNull();
    expect(setListType(p, 'a1', 'ol')).toBeNull();
  });
  it('왕복하면 원본과 같다', () => {
    const p = proj();
    const back = setListType(setListType(p, 'l2', 'ol')!, 'l2', 'ul')!;
    expect(back.structure).toBe(p.structure);
  });
});

describe('버튼 스타일·그룹', () => {
  it('스타일만 바뀌고 href 등 다른 속성은 보존', () => {
    const p = proj();
    expect(getButtonStyle(p.structure, 'b1')).toBe('primary');
    const n = setButtonStyle(p, 'b1', 'outline')!;
    expect(n.structure).toBe(p.structure.replace('btn btn-primary', 'btn btn-outline'));
    expect(setButtonStyle(p, 'b1', 'primary')).toBeNull();
    expect(setButtonStyle(p, 'a1', 'outline')).toBeNull();
  });
  it('그룹 정보', () => {
    const p = proj();
    expect(getButtonGroupInfo(p.structure, 'b1')).toEqual({ count: 1, grouped: false, canGroupWithNext: true });
    expect(getButtonGroupInfo(p.structure, 'b2')).toEqual({ count: 1, grouped: false, canGroupWithNext: true }); // 다음이 그룹 문단도 합칠 수 있음
    expect(getButtonGroupInfo(p.structure, 'b4')).toEqual({ count: 2, grouped: true, canGroupWithNext: false });
    expect(getButtonGroupInfo(p.structure, 'a1')).toBeUndefined();
  });
  it('단일 둘 → 그룹 → 풀기(문자열 ID·내용 보존)', () => {
    const p = proj();
    const g = groupButtonWithNext(p, 'b1')!;
    expect(g.structure).toContain('<p class="btn-group"><a href="https://x.test/a?b=1&amp;c=2" class="btn btn-primary" data-t="b1">확인</a><a href="#" class="btn btn-ghost" data-t="b2">취소</a></p>');
    expect(getButtonGroupInfo(g.structure, 'b2')).toMatchObject({ count: 2, grouped: true });
    const u = ungroupButtons(g, 'b1')!;
    expect(u.structure).toContain('<p><a href="https://x.test/a?b=1&amp;c=2" class="btn btn-primary" data-t="b1">확인</a></p>\n<p><a href="#" class="btn btn-ghost" data-t="b2">취소</a></p>');
    expect(u.strings).toBe(p.strings);
    expect(listBlocks(u.structure).map((b) => b.id)).toEqual(listBlocks(p.structure).map((b) => b.id));
  });
  it('이미 그룹인 문단에 다음 버튼 문단을 합치면 그룹이 커진다', () => {
    const p = proj();
    const g1 = groupButtonWithNext(p, 'b2')!; // b2 + (그룹 b3,b4)
    expect(getButtonGroupInfo(g1.structure, 'b4')).toMatchObject({ count: 3, grouped: true });
  });
  it('그룹이 아니면 풀 수 없고, 다음이 버튼이 아니면 합칠 수 없다', () => {
    const p = proj();
    expect(ungroupButtons(p, 'b1')).toBeNull();
    expect(groupButtonWithNext(p, 'b4')).toBeNull();
  });
  it('버튼 사이가 공백이 아니면(본문이 섞인 문단) 건드리지 않는다', () => {
    const p = { ...proj(), structure: '<p>앞 <a href="#" class="btn btn-primary" data-t="x1">a</a></p>\n<p><a href="#" class="btn btn-ghost" data-t="x2">b</a></p>' };
    expect(getButtonGroupInfo(p.structure, 'x1')).toBeUndefined();
    expect(groupButtonWithNext(p, 'x1')).toBeNull();
  });
});
