import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app-setup';

export const outDir = () => resolve(process.env.E2E_OUT ?? join(tmpdir(), 'css-inliner-e2e'));

/** 엔진+프로젝트 모듈을 단일 IIFE 로 묶어 정적 하네스 HTML 로 만든다(프로젝트 dist/소스는 건드리지 않음). */
export default async function globalSetup() {
  const out = outDir();
  mkdirSync(out, { recursive: true });
  const r = await build({
    entryPoints: [resolve('tests/e2e/harness-entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    loader: { '.json': 'json' },
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
  await buildApp();
  writeFileSync(join(out, 'harness.html'), `<!doctype html><meta charset="utf-8"><title>e2e</title><body><script>${js}</script></body>`);
}
