/**
 * 메일 셸: 구조 HTML 을 감싸는 래퍼 표 + 로고 헤더 + 본문(<main>) + 푸터. 모두 표 기반, 폭 600px.
 *
 * - 순수 문자열 함수(DOM 비의존). 스타일은 src/styles/template.css 의 `.mail-*` 클래스가 맡는다.
 * - 헤더 태그/푸터 문구는 번역 대상이다: compose.ts 와 같은 `data-t="bNNN"` 블록 ID 를 발급해
 *   strings 표에 합류시킨다(그래서 `wrapShell` 은 구조뿐 아니라 strings 도 돌려준다).
 * - 언어별 `lang` 속성은 구조가 언어 공통이라 합성 단계에서 못 넣는다 -> 래퍼에 `data-tx-shell` 표식과
 *   기준 lang 을 두고, 합성 직후 `setShellLang(html, lang)` 으로 바꾼다(표식은 이때 제거).
 * - `<main>` 은 셸이 한 번만 만든다. 입력의 `<main>` 래퍼(parseMarkup 기본·sample.html)는 벗겨 낸다.
 */

import { IdAllocator } from './ids';
import { LOGO_DATA_URI } from './logo';
import type { Lang, Strings } from './types';

/** 번역 대상 문구 하나: 언어 -> 인라인 HTML(허용 태그 strong/em/del/a/br + 치환자) */
export type ShellText = Record<Lang, string>;

export interface ShellOptions {
  /** 로고 src. `data:` URI(기본: 내장 base64) 또는 URL */
  logoSrc?: string;
  /** 로고 대체 텍스트(이미지 차단 시 보임). 기본 'TRACXLOGIS' */
  logoAlt?: string;
  /** 로고 링크. 기본 https://www.tracxlogis.com */
  logoHref?: string;
  /** 헤더 오른쪽 문서 종류 문구(번역 대상, 선택) */
  headerTag?: ShellText;
  /** 푸터 문단들(각각 번역 대상). 생략하면 DEFAULT_FOOTER_BLOCKS, `[]` 면 푸터 없음 */
  footerBlocks?: ShellText[];
  /** 래퍼의 기준 lang 속성. 기본 'ko'(합성 후 setShellLang 으로 언어별로 바꾼다) */
  baseLang?: Lang;
  /**
   * 이전에 발급한 블록 ID 를 고정한다(초안 재변환 시 ID 이어받기). 생략하면 새로 발급.
   * footer 길이가 footerBlocks 보다 짧으면 모자란 만큼 새로 발급한다.
   */
  ids?: { headerTag?: string; footer?: string[] };
}

export interface ShellResult {
  /** 셸로 감싼 구조 HTML(안쪽 본문 구조는 그대로, 헤더 태그·푸터에 data-t 가 추가됨) */
  structure: string;
  /** 셸이 만든 문자열(블록 ID -> 언어별). 프로젝트 strings 에 병합한다 */
  strings: Strings;
  /** 이번에 쓴 셸 블록 ID(다음 재변환 때 `ids` 로 넘겨 이어받는다) */
  ids: { headerTag?: string; footer: string[] };
}

export const DEFAULT_LOGO_ALT = 'TRACXLOGIS';
export const DEFAULT_LOGO_HREF = 'https://www.tracxlogis.com';

/** 기본 푸터: 슬로건 + 저작권. (주소·연락처 등 실제 문구는 프로젝트가 footerBlocks 로 지정) */
export const DEFAULT_FOOTER_BLOCKS: ShellText[] = [
  {
    ko: 'TracXLogis - Beyond Borders, Beyond Limit',
    en: 'TracXLogis - Beyond Borders, Beyond Limit',
    ja: 'TracXLogis - Beyond Borders, Beyond Limit',
  },
  {
    ko: '© TRACXLOGIS Co., Ltd.',
    en: '© TRACXLOGIS Co., Ltd.',
    ja: '© TRACXLOGIS Co., Ltd.',
  },
];

const TABLE_ATTRS = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 입력 구조의 `<main>` 여는/닫는 태그를 모두 제거(셸이 `<main>` 을 한 번만 만들도록) */
function stripMain(html: string): string {
  return html.replace(/<\/?main\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, '').trim();
}

export function wrapShell(structureHtml: string, opts: ShellOptions = {}): ShellResult {
  const base = opts.baseLang ?? 'ko';
  const inner = stripMain(structureHtml);
  const footerBlocks = opts.footerBlocks ?? DEFAULT_FOOTER_BLOCKS;

  // 본문 구조의 기존 ID + 고정 요청된 ID 를 예약해 충돌을 막는다.
  const alloc = new IdAllocator([
    ...[...inner.matchAll(/data-t="([^"]*)"/g)].map((m) => m[1]),
    ...(opts.ids?.headerTag ? [opts.ids.headerTag] : []),
    ...(opts.ids?.footer ?? []),
  ]);

  const strings: Strings = {};
  const used: ShellResult['ids'] = { footer: [] };

  let tagCell = '';
  if (opts.headerTag) {
    const id = opts.ids?.headerTag ?? alloc.next();
    used.headerTag = id;
    strings[id] = { ...opts.headerTag };
    tagCell = `<td class="mail-tag" align="right" valign="middle" data-t="${id}"></td>`;
  }

  const footerLines = footerBlocks.map((text, i) => {
    const id = opts.ids?.footer?.[i] ?? alloc.next();
    used.footer.push(id);
    strings[id] = { ...text };
    return `<p class="mail-footer-line" data-t="${id}"></p>`;
  });

  const logoSrc = attr(opts.logoSrc ?? LOGO_DATA_URI);
  const logoAlt = attr(opts.logoAlt ?? DEFAULT_LOGO_ALT);
  const logoHref = attr(opts.logoHref ?? DEFAULT_LOGO_HREF);

  const header =
    `<tr><td class="mail-header">` +
    `<table class="mail-header-row" width="100%" ${TABLE_ATTRS}><tr>` +
    `<td class="mail-logo" valign="middle"><a href="${logoHref}" target="_blank">` +
    `<img class="logo" src="${logoSrc}" alt="${logoAlt}" width="160" height="25"></a></td>` +
    tagCell +
    `</tr></table></td></tr>`;

  const footer = footerLines.length
    ? `<tr><td class="mail-footer-wrap">` +
      `<table class="mail-footer-row" width="100%" ${TABLE_ATTRS}><tr><td class="mail-footer">` +
      footerLines.join('') +
      `</td></tr></table></td></tr>`
    : '';

  const structure =
    `<table class="mail" lang="${attr(base)}" data-tx-shell width="100%" ${TABLE_ATTRS} bgcolor="#FFFFFF"><tr>` +
    // 가운데 정렬은 표준 모드에서 text-align 으로 표가 움직이지 않는다 -> 컨테이너 표 자체에 align="center"(속성, Outlook 포함) + CSS margin 보조
    `<td class="mail-outer" align="center">` +
    `<table class="mail-container" width="600" align="center" ${TABLE_ATTRS}>` +
    header +
    `<tr><td class="mail-body"><main class="mail-content">\n${inner}\n</main></td></tr>` +
    footer +
    `</table></td></tr></table>`;

  return { structure, strings, ids: used };
}

/**
 * 합성된 HTML 의 셸 래퍼 lang 을 해당 언어로 바꾸고 `data-tx-shell` 표식을 제거한다.
 * composeForSend / composePreview 결과에 언어별로 호출한다. 셸이 없으면 그대로 돌려준다.
 */
export function setShellLang(html: string, lang: Lang): string {
  return html.replace(/<table\b((?:"[^"]*"|'[^']*'|[^'">])*)>/, (m, attrs: string) => {
    if (!/\sdata-tx-shell(?=[\s=>]|$)/.test(attrs)) return m;
    const cleaned = attrs.replace(/\sdata-tx-shell(?:="[^"]*")?/, '').replace(/\slang="[^"]*"/, '');
    return `<table${cleaned} lang="${attr(lang)}">`;
  });
}
