// dist/index.html 이 외부 참조 없이 단일 파일로 완결되는지 검사한다.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const file = join(dist, 'index.html');
const problems = [];

if (!existsSync(file)) {
  console.error('dist/index.html 이 없습니다. 먼저 빌드하세요.');
  process.exit(1);
}
const extra = readdirSync(dist).filter((f) => f !== 'index.html');
if (extra.length) problems.push(`dist 에 별도 파일이 있음: ${extra.join(', ')}`);

const html = readFileSync(file, 'utf-8');
// 태그의 src/href 속성만 검사한다(번들 JS 문자열 안의 URL 은 대상 아님).
// 인라인 <script>/<style> 본문은 제거한 뒤 검사.
const markup = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => m.match(/^<script\b[^>]*>/i)[0] + '</script>')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
for (const m of markup.matchAll(/<(\w+)\b[^>]*?\s(src|href)\s*=\s*["']?([^"'\s>]+)/gi)) {
  const [, tag, attr, url] = m;
  if (tag.toLowerCase() === 'a') continue;
  if (/^(https?:)?\/\//i.test(url) || /^\/?assets\//i.test(url) || /\.(js|css|woff2?|png|svg)(\?|$)/i.test(url))
    problems.push(`<${tag} ${attr}="${url}">`);
}
// 인라인 CSS 의 @import / 외부 url()
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
for (const m of css.matchAll(/@import\s+(?:url\()?["']?(https?:[^"')\s]+)/gi)) problems.push(`CSS @import ${m[1]}`);
for (const m of css.matchAll(/url\(\s*["']?(https?:[^"')\s]+)/gi)) problems.push(`CSS url() ${m[1]}`);

if (problems.length) {
  console.error('단일 파일 검사 실패:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`단일 파일 검사 통과 (${(html.length / 1024).toFixed(1)} KB)`);
