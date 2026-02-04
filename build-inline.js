import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// dist 폴더 경로 (src/dist 또는 dist)
const distPath = join(__dirname, 'src', 'dist');
const htmlPath = join(distPath, 'index.html');
const assetsPath = join(distPath, 'assets');

console.log('단일 HTML 파일 생성 중...');

// HTML 읽기
let html = readFileSync(htmlPath, 'utf-8');

// assets 폴더의 모든 파일 읽기
const assets = readdirSync(assetsPath);

assets.forEach(file => {
  const filePath = join(assetsPath, file);
  const content = readFileSync(filePath, 'utf-8');

  if (file.endsWith('.css')) {
    // CSS 파일 인라인화
    const cssTag = `<link rel="stylesheet" crossorigin href="/assets/${file}">`;
    const inlineStyle = `<style>${content}</style>`;
    html = html.replace(cssTag, inlineStyle);
  } else if (file.endsWith('.js')) {
    // JS 파일 인라인화
    const scriptTag = `<script type="module" crossorigin src="/assets/${file}"></script>`;
    const inlineScript = `<script type="module">${content}</script>`;
    html = html.replace(scriptTag, inlineScript);
  }
});

// 최종 HTML 저장
const outputDir = join(__dirname, 'dist');
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const outputPath = join(outputDir, 'index.html');
writeFileSync(outputPath, html, 'utf-8');

console.log('✓ 단일 HTML 파일 생성 완료:', outputPath);
