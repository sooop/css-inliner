import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// e2e: 실제 브라우저(시스템 Edge/Chrome)에서 엔진·번들 경로 검증. 개발 서버 불필요(file:// 하네스).
// 채널은 E2E_CHANNEL 로 바꿀 수 있다(msedge | chrome). 산출물은 E2E_OUT(기본 OS temp/css-inliner-e2e).
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  outputDir: join(process.env.E2E_OUT ?? join(tmpdir(), 'css-inliner-e2e'), 'test-results'),
  workers: 1,
  reporter: [['list']],
  use: { channel: process.env.E2E_CHANNEL ?? 'msedge', headless: true },
});
