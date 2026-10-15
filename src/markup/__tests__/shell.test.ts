// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTxmd } from '../parser';
import { composeForSend } from '../compose';
import { listBlocks } from '../ids';
import { wrapShell, setShellLang, DEFAULT_FOOTER_BLOCKS } from '../shell';
import { LOGO_DATA_URI } from '../logo';

const DRAFT = `# 제목
@en Title
@ja タイトル

본문 |!#-cust_nm|
@en Body |!#-cust_nm|
@ja 本文 |!#-cust_nm|

[정보: 안내]
@en Notice
@ja 案内
내용
@en Content
@ja 内容
[/정보]
`;

function build(opts = {}) {
  const p = parseTxmd(DRAFT, { wrapMain: true });
  const shell = wrapShell(p.structure, opts);
  const strings = { ...p.strings, ...shell.strings };
  return { p, shell, strings };
}

describe('wrapShell', () => {
  it('<main> 은 한 번만 만든다(입력의 main 래퍼는 벗김)', () => {
    const { shell } = build();
    expect(shell.structure.match(/<main\b/g)).toHaveLength(1);
    expect(shell.structure.match(/<\/main>/g)).toHaveLength(1);
  });

  it('표 기반: 래퍼 표 + 600px 컨테이너, 레이아웃에 div/header/footer 를 쓰지 않는다', () => {
    const { shell } = build();
    expect(shell.structure).toMatch(/^<table class="mail" lang="ko" data-tx-shell /);
    expect(shell.structure).toMatch(/<table class="mail-container" width="600"/);
    expect(shell.structure).not.toMatch(/<header|<footer/);
    // 가운데 정렬: 컨테이너 표 자체의 align 속성 + 바깥 td 의 align 속성(CSS text-align 은 표를 움직이지 못함)
    expect(shell.structure).toMatch(/<td class="mail-outer" align="center">/);
    expect(shell.structure).toMatch(/<table class="mail-container" width="600" align="center"/);
    // 셸 영역(본문 main 바깥)에는 div 가 없다
    const outside = shell.structure.replace(/<main[\s\S]*<\/main>/, '');
    expect(outside).not.toMatch(/<div/);
  });

  it('로고: class=logo, data: base64 기본, alt=TRACXLOGIS', () => {
    const { shell } = build();
    const m = /<img class="logo" src="([^"]*)" alt="([^"]*)"/.exec(shell.structure)!;
    expect(m[1]).toBe(LOGO_DATA_URI);
    expect(m[1].startsWith('data:image/png;base64,')).toBe(true);
    expect(m[2]).toBe('TRACXLOGIS');
  });

  it('로고 URL 로 교체 가능', () => {
    const { shell } = build({ logoSrc: 'https://cdn.example.com/logo.png' });
    expect(shell.structure).toContain('src="https://cdn.example.com/logo.png"');
    expect(shell.structure).not.toContain('data:image');
  });

  it('헤더 태그·푸터 문구가 번역 대상 블록(data-t)이 되고 ID 가 본문과 겹치지 않는다', () => {
    const { p, shell, strings } = build({
      headerTag: { ko: '배송 안내', en: 'Shipping notice', ja: '発送のお知らせ' },
    });
    const bodyIds = listBlocks(p.structure).map((b) => b.id);
    const shellIds = [shell.ids.headerTag!, ...shell.ids.footer];
    expect(shellIds).toHaveLength(1 + DEFAULT_FOOTER_BLOCKS.length);
    for (const id of shellIds) {
      expect(bodyIds).not.toContain(id);
      expect(shell.strings[id]).toBeTruthy();
      expect(shell.structure).toContain(`data-t="${id}"`);
    }
    const all = listBlocks(shell.structure).map((b) => b.id);
    expect(new Set(all).size).toBe(all.length);
    expect(strings[shell.ids.headerTag!].ja).toBe('発送のお知らせ');
  });

  it('언어별 합성: 푸터·헤더 문구가 언어별로 채워지고 setShellLang 이 lang 을 바꾼다', () => {
    const { shell, strings } = build({
      headerTag: { ko: '배송 안내', en: 'Shipping notice', ja: '発送のお知らせ' },
      footerBlocks: [{ ko: '발신 전용', en: 'Send-only', ja: '送信専用' }],
    });
    const src = { structure: shell.structure, strings };
    for (const [lang, tag, foot] of [
      ['ko', '배송 안내', '발신 전용'],
      ['en', 'Shipping notice', 'Send-only'],
      ['ja', '発送のお知らせ', '送信専用'],
    ]) {
      const html = setShellLang(composeForSend(src, lang).html, lang);
      expect(html).toMatch(/^<table class="mail" /);
      expect(html).toContain(`lang="${lang}"`);
      expect(html).not.toContain('data-tx-shell');
      expect(html).not.toContain('data-t=');
      expect(html).toContain(`>${tag}</td>`);
      expect(html).toContain(`>${foot}</p>`);
      expect(html.match(/lang="/g)).toHaveLength(1);
    }
  });

  it('footerBlocks: [] 이면 푸터가 없다', () => {
    const { shell } = build({ footerBlocks: [] });
    expect(shell.structure).not.toContain('mail-footer');
    expect(shell.ids.footer).toEqual([]);
  });

  it('ids 로 이전 ID 를 고정하고 나머지는 겹치지 않게 새로 발급', () => {
    const { shell } = build({ headerTag: { ko: 'a' }, ids: { headerTag: 'b900', footer: ['b901'] } });
    expect(shell.ids.headerTag).toBe('b900');
    expect(shell.ids.footer[0]).toBe('b901');
    expect(shell.ids.footer[1]).toBe('b902'); // 예약된 최대값 다음
  });

  it('셸이 없는 HTML 에는 setShellLang 이 아무것도 하지 않는다', () => {
    const html = '<table class="x" lang="ko"><tr><td>a</td></tr></table>';
    expect(setShellLang(html, 'en')).toBe(html);
  });
});

const css = readFileSync(resolve(process.cwd(), 'src/styles/template.css'), 'utf8');

describe('template.css 정적 점검', () => {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('미디어쿼리·@import·웹폰트·nth-child 가 없다', () => {
    expect(noComments).not.toMatch(/@media|@import|@font-face|@supports/);
    expect(noComments).not.toMatch(/url\(/);
    expect(noComments).not.toMatch(/nth-child|nth-of-type|nth-last/);
  });

  it('언어별 폰트 전환은 [lang] 속성 선택자', () => {
    for (const l of ['ko', 'en', 'ja']) expect(noComments).toContain(`[lang="${l}"]`);
  });

  it('핵심 토큰(코발트)이 들어 있다', () => {
    for (const v of ['#1D6FE0', '#0F2A52', '#EAF2FF']) expect(noComments).toContain(v);
  });

  it('컨테이너: 폭 600 + max-width 100% + margin auto, 내부 텍스트는 left', () => {
    const rule = noComments.split('}').find((r) => /^\s*\.mail-container\s*\{/.test(r))!;
    expect(rule).toMatch(/width:\s*600px/);
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/margin:\s*0 auto/);
    expect(rule).toMatch(/text-align:\s*left/);
  });

  it('구문이 유효하다(jsdom CSSOM 이 모든 규칙을 읽는다)', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const sheet = style.sheet as CSSStyleSheet;
    expect(sheet.cssRules.length).toBeGreaterThan(60);
    const selectors = [...sheet.cssRules].map((r) => (r as CSSStyleRule).selectorText ?? '').join('\n');
    for (const s of ['.callout-info', '.callout-warn', '.callout-accent', '.table-vertical', '.table-horizontal', '.btn-primary', 'blockquote', 'hr', 'del']) {
      expect(selectors).toContain(s);
    }
  });

  it('가로형 표 셀(.table-horizontal td)에는 위치 선택자를 쓰지 않는다(동적 행 템플릿 복제 안전)', () => {
    const rules = noComments.split('}').filter((r) => /\.table-horizontal\s+td/.test(r.split('{')[0]));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r.split('{')[0]).not.toMatch(/:first-child|:last-child|:nth|\+|~/);
  });
});
