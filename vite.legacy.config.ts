import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

// 레거시 변환기(src/legacy)용 설정.
// 개발: `npm run dev:legacy` (http://localhost:3100) / 빌드: `npm run build:legacy` → dist-legacy/index.html 단일 파일.
// 레거시 코드는 src/engine, src/styles, src/samples 를 상위 경로로 참조하므로 파일 시스템 접근을 src 전체로 허용한다.
const src = resolve(__dirname, 'src');

export default defineConfig({
  root: resolve(src, 'legacy'),
  publicDir: false,
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    outDir: resolve(__dirname, 'dist-legacy'),
    emptyOutDir: true,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: { port: 3100, strictPort: true, fs: { allow: [src] } },
  preview: { port: 3101, strictPort: true },
});
