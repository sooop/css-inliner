import { describe, expect, it } from 'vitest';
import { buildArchive, parseArchive, serializeArchive } from '../archive';
import { createProject } from '../model';
import { validateProject } from '../validate';
import { makeProject } from './fixture';

describe('보관 파일(tx-studio-projects)', () => {
  const notice = createProject({ id: 'n1', name: '공지', kind: 'notice', structure: '<p data-t="b001"></p>', strings: { b001: { ko: 'a', en: '', ja: '' } } });

  it('메일·공지를 왕복하고 오류 있는 프로젝트도 담는다', () => {
    const bad = makeProject({ id: 'bad' });
    bad.strings.b001.ja = '';
    const r = parseArchive(serializeArchive(buildArchive([makeProject(), notice, bad])));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.projects.map((p) => p.id)).toEqual(['proj-1', 'n1', 'bad']);
  });
  it('변조·형식 오류·번들 파일을 거부한다', () => {
    const text = serializeArchive(buildArchive([makeProject()]));
    expect(parseArchive(text.replace('배송 시작 안내', '바뀜'))).toMatchObject({ ok: false });
    expect(parseArchive('{')).toMatchObject({ ok: false });
    expect(parseArchive(JSON.stringify({ schema: 'tx-mail-bundle' }))).toMatchObject({ ok: false });
    expect(parseArchive(JSON.stringify({ schema: 'tx-studio-projects', version: 2, projects: [] }))).toMatchObject({ ok: false });
  });
});

describe('번역 경고 끄기', () => {
  it('ignoreTranslation 이면 미번역이 빠진다', () => {
    const p = makeProject();
    p.strings.b001.ja = '';
    expect(validateProject(p).some((i) => i.code === 'untranslated')).toBe(true);
    expect(validateProject(p, { ignoreTranslation: true }).some((i) => i.code === 'untranslated')).toBe(false);
  });
});
