/**
 * .txmd 머리말(front matter) — 파일 맨 첫 줄이 `---` 이면 다음 `---` 줄까지가 머리말이다(TXMD.md §6).
 * 한 줄에 `key: value`(첫 `:` 뒤를 trim). 빈 줄·`#` 주석 줄은 무시. 중첩 없음.
 * 본문은 머리말을 뺀 나머지이므로 본문 파서가 내는 경고의 `(line N)` 은 본문 기준이다.
 */
export interface FrontMatterMeta {
  kind?: 'mail' | 'notice';
  name?: string;
  templateCode?: string;
  /** 언어별 제목(ko·en·ja) */
  subject: Record<string, string>;
}

export interface FrontMatterResult {
  meta: FrontMatterMeta;
  body: string;
  warnings: string[];
}

const SUBJECT_LANGS = ['ko', 'en', 'ja'];

export function parseFrontMatter(input: string): FrontMatterResult {
  const meta: FrontMatterMeta = { subject: {} };
  const warnings: string[] = [];
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[0].trim() !== '---') return { meta, body: text, warnings };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) {
    warnings.push('머리말이 `---` 로 닫히지 않아 전체를 본문으로 읽었습니다.');
    return { meta, body: text, warnings };
  }
  for (let i = 1; i < end; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const c = line.indexOf(':');
    if (c < 0) {
      warnings.push(`머리말 ${i + 1}번째 줄을 읽지 못했습니다(key: value 형식이 아님): ${line}`);
      continue;
    }
    const key = line.slice(0, c).trim();
    const value = line.slice(c + 1).trim();
    if (key === 'kind') {
      // kind 는 값이 고정 집합이라 줄 끝 `# 설명` 을 허용한다(다른 키는 URL 의 `#` 때문에 값을 그대로 둔다).
      const v = value.replace(/\s+#.*$/, '');
      if (v === 'mail' || v === 'notice') meta.kind = v;
      else if (v !== '') warnings.push(`머리말 kind 는 mail 또는 notice 여야 합니다(받은 값: ${v}) — mail 로 처리합니다.`);
    } else if (key === 'name') {
      if (value) meta.name = value;
    } else if (key === 'templateCode') {
      if (value) meta.templateCode = value;
    } else if (key.startsWith('subject.')) {
      const lang = key.slice('subject.'.length).trim();
      if (SUBJECT_LANGS.includes(lang)) meta.subject[lang] = value;
      else warnings.push(`머리말 제목의 언어 ${lang} 는 지원하지 않습니다(ko·en·ja) — 무시합니다.`);
    } else {
      warnings.push(`머리말의 알 수 없는 키 ${key} 는 무시합니다.`);
    }
  }
  return { meta, body: lines.slice(end + 1).join('\n'), warnings };
}
