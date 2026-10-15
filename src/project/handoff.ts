import { fillRowVars } from '../markup/compose';
import type { Project } from './model';
import type { RenderedProject, RenderedTable } from './render';
import { byteLength, GMAIL_CLIP_BYTES, maxRowsWithin } from './size';
import { estimateRowBytes } from './validate';

/** 행 값 -> 행 템플릿 채우기. 문서의 '렌더 결과 예시'용 앱 참조 출력이며 값 처리는 fillRowVars 동작을 그대로 따른다. */
export function renderRows(rowTemplate: string, rows: Record<string, string>[]): string {
  return rows.map((r) => fillRowVars(rowTemplate, r)).join('');
}

/** 표 하나의 언어별 '102KB 이내 최대 행 수'(다른 동적 표의 행은 0 으로 가정) */
export function maxRowsByLang(
  rendered: RenderedProject,
  table: RenderedTable,
  limit: number = GMAIL_CLIP_BYTES,
): Record<string, { baseBytes: number; rowBytes: number; maxRows: number }> {
  const out: Record<string, { baseBytes: number; rowBytes: number; maxRows: number }> = {};
  for (const [lang, loc] of Object.entries(rendered.locales)) {
    const baseBytes = byteLength(loc.html);
    const rowBytes = estimateRowBytes(table.rowTemplates[lang] ?? '', table.vars, table.sampleRows);
    out[lang] = { baseBytes, rowBytes, maxRows: maxRowsWithin(baseBytes, rowBytes, limit) };
  }
  return out;
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * 메일 처리 워커/서버 개발자용 연동 명세(MD)를 번들 내용에서 생성한다.
 * 동적 표가 없으면 그 사실만 적은 짧은 문서를 돌려준다.
 */
export function buildHandoffMd(project: Project, rendered: RenderedProject): string {
  const L: string[] = [];
  const title = project.templateCode ? `${project.name} (${project.templateCode})` : project.name;
  L.push(`# 동적 표 연동 명세 — ${title}`, '');
  L.push(`- 언어: ${project.langs.join(', ')} (기준 ${project.baseLang})`);
  L.push(`- 번들 스키마: \`tx-mail-bundle\` v1 (상세: docs/bundle-schema.md)`);
  L.push('');

  if (rendered.dynamicTables.length === 0) {
    L.push('이 템플릿에는 동적 표가 없습니다. 서버는 `|!#-변수|` 치환자만 처리하면 됩니다.', '');
    return L.join('\n');
  }

  L.push('## 공통 규칙', '');
  L.push('1. 발송 HTML 의 동적 표 `<tbody>` 에는 표식 치환자 `|!#-rows_<표id>|` 하나만 들어 있습니다.');
  L.push('2. 표식 교체와 행 생성은 **메일 처리 워커 담당**입니다. 워커는 표식을 **`<tr>…</tr>` 연속 문자열**(행마다 행 템플릿을 채운 것)로 교체합니다. 행 템플릿 열 수는 언어 공통입니다.');
  L.push('3. 행 템플릿의 `{{var}}` 는 행 데이터 값으로 치환합니다. 변수 이름은 아래 표의 `vars` 목록을 따릅니다.');
  L.push('4. **확정:** 서버는 `rows_` 접두 치환자(`|!#-rows_<표id>|`)를 지우거나 오류로 처리하지 않고 **그대로 통과**시킵니다.');
  L.push('5. 참고(권장): 서버가 본문 전체의 `|!#-x|` 치환을 먼저 하고, 그 뒤에 표식 `|!#-rows_<id>|` 를 행 문자열로 교체하면 행 값에 `|!#-` 가 있어도 재치환되지 않습니다. 워커 내부 구현(치환 규칙 세부·순서)은 워커 담당 부서가 정합니다.');
  L.push('6. 워커의 `{{ }}` 치환 세부 규칙(없는 변수 처리 등)은 워커 담당 영역이며 이 문서 범위 밖입니다.');
  L.push('');

  for (const t of rendered.dynamicTables) {
    L.push(`## 표 \`${t.id}\``, '');
    L.push(`- 삽입 표식: \`${t.marker}\``);
    L.push(`- 열 수: ${t.columns}`);
    L.push('');
    L.push('### 변수', '');
    L.push('| 변수 | 설명 | 샘플 |', '|---|---|---|');
    for (const v of t.vars) L.push(`| \`{{${v.name}}}\` | ${esc(v.description)} | ${esc(v.sample)} |`);
    L.push('');
    L.push('### 언어별 행 템플릿', '');
    for (const lang of project.langs) {
      L.push(`**${lang}**`, '', '```html', t.rowTemplates[lang] ?? '', '```', '');
    }
    L.push('### 예시 행 데이터', '');
    if (t.sampleRows.length === 0) L.push('(예시 행 없음)', '');
    else {
      L.push('```json', JSON.stringify(t.sampleRows, null, 2), '```', '');
    }
    L.push('### 렌더 결과 예시 (표식 자리에 들어갈 문자열)', '');
    const exLang = project.langs.includes(project.baseLang) ? project.baseLang : project.langs[0];
    L.push(`언어 \`${exLang}\`, 예시 행 ${t.sampleRows.length}개(앱 참조 렌더 출력):`, '');
    L.push('```html', renderRows(t.rowTemplates[exLang] ?? '', t.sampleRows), '```', '');
    L.push('> 예시 렌더의 `&lt;` `&amp;` 등은 앱 미리보기가 샘플 값을 안전하게 보여주기 위한 표시일 뿐이며, 이 규약은 값 이스케이프를 요구하지 않는다(워커 담당 영역).', '');
    L.push('### 행 수 상한 (Gmail 102KB 기준)', '');
    L.push(`Gmail 은 본문이 ${GMAIL_CLIP_BYTES}B(102KB)를 넘으면 잘라 숨깁니다. 상한 = floor((${GMAIL_CLIP_BYTES} − 본문 바이트) ÷ 행당 바이트). 다른 동적 표의 행은 0 으로 가정, 행당 바이트는 예시 행 값으로 추정(실제 값 길이에 따라 달라짐).`, '');
    L.push('| 언어 | 본문(표식 포함) B | 행당 B(추정) | 최대 행 수 |', '|---|---|---|---|');
    const m = maxRowsByLang(rendered, t);
    for (const lang of project.langs) {
      const x = m[lang];
      if (x) L.push(`| ${lang} | ${x.baseBytes} | ${x.rowBytes} | ${Number.isFinite(x.maxRows) ? x.maxRows : '제한 없음'} |`);
    }
    L.push('');
  }
  return L.join('\n');
}
