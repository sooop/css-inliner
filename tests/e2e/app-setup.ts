import { build } from 'vite';
import { join, resolve } from 'node:path';
import { outDir } from './global-setup';

export const appDir = () => join(outDir(), 'app');

/** 앱 번들을 OUT/app/index.html 로 만든다(프로젝트 dist/ 와 소스는 건드리지 않음, 개발 서버 사용 안 함). */
export async function buildApp(): Promise<void> {
  await build({
    configFile: resolve('vite.config.ts'),
    logLevel: 'silent',
    build: { outDir: appDir(), emptyOutDir: true },
  });
}
