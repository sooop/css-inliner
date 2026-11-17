import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 개발: `npm run dev` (Vite 개발 서버). 빌드: `npm run build` → dist/index.html 단일 파일.
/** vite-plugin-singlefile 이 <link rel="icon"> 은 인라인하지 않으므로 favicon·apple-touch-icon(PNG, iOS Safari 는 SVG 를 못 읽음)을 data URI 로 바꿔 넣는다. */
const inlineFavicon = (): Plugin => ({
  name: 'inline-favicon',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) =>
      html.replace(/(<link rel="(?:icon|apple-touch-icon)"[^>]*?href=")(\/src\/[^"]+\.png)(")/g, (_m, a: string, p: string, c: string) =>
        `${a}data:image/png;base64,${readFileSync(fileURLToPath(new URL('.' + p, import.meta.url))).toString('base64')}${c}`),
  },
})

export default defineConfig({
  plugins: [svelte(), inlineFavicon(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: { port: 3000, strictPort: true },
});
