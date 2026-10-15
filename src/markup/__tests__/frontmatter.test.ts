import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '../frontmatter';

describe('parseFrontMatter', () => {
  it('머리말이 없으면 전체가 본문', () => {
    const r = parseFrontMatter('# 제목\n\n본문\n');
    expect(r.body).toBe('# 제목\n\n본문\n');
    expect(r.meta).toEqual({ subject: {} });
    expect(r.warnings).toEqual([]);
  });

  it('전체 키와 본문 분리, 주석·빈 줄 무시', () => {
    const r = parseFrontMatter('---\nkind: notice # x\n# 주석\n\nname: 배송 시작 안내\ntemplateCode: SHIP_START\nsubject.ko: 안녕\nsubject.en: Hi\n---\n# 본문\n');
    expect(r.meta.kind).toBe('notice');
    expect(r.body).toBe('# 본문\n');
  });

  it('CRLF·BOM', () => {
    const r = parseFrontMatter('﻿---\r\nkind: mail\r\nname: N\r\n---\r\n# 본문\r\n');
    expect(r.meta).toEqual({ kind: 'mail', name: 'N', subject: {} });
    expect(r.body).toBe('# 본문\n');
    expect(r.warnings).toEqual([]);
  });

  it('닫힘이 없으면 경고 후 전체가 본문', () => {
    const t = '---\nname: x\n# 본문\n';
    const r = parseFrontMatter(t);
    expect(r.body).toBe(t);
    expect(r.meta.name).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });

  it('알 수 없는 키·콜론 없는 줄은 경고', () => {
    const r = parseFrontMatter('---\nfoo: 1\n그냥 줄\n---\n본문');
    expect(r.warnings).toHaveLength(2);
    expect(r.meta).toEqual({ subject: {} });
  });

  it('잘못된 kind 는 경고 후 지정 없음(=mail)', () => {
    const r = parseFrontMatter('---\nkind: popup\n---\n본문');
    expect(r.meta.kind).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });

  it('값 안의 : 는 보존(URL·시각), 첫 : 만 구분자', () => {
    const r = parseFrontMatter('---\nsubject.ko: 점검: 10:30 https://a.com/x?y=1\nname:   앞뒤 공백  \n---\n본문');
    expect(r.meta.subject.ko).toBe('점검: 10:30 https://a.com/x?y=1');
    expect(r.meta.name).toBe('앞뒤 공백');
  });

  it('subject 는 일부 언어만 가능, 미지원 언어는 경고', () => {
    const r = parseFrontMatter('---\nsubject.ja: 発送\nsubject.fr: x\n---\n본문');
    expect(r.meta.subject).toEqual({ ja: '発送' });
    expect(r.warnings).toHaveLength(1);
  });
});
