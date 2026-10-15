import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { devNull } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SAMPLE_TXMD } from '../../ui/state/sample';
import { verifyRoundTrip } from '../roundtrip';
import { FIXTURES } from './fixtures';
import { getSchema } from './helpers';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

it('fuzz(줄 삭제·복제·들여쓰기·기호 삽입): 예외 없이 거의 모두 왕복', async () => {
  const schema = await getSchema();
  const golden = join(__dirname, '../../markup/__golden__');
  const srcs = [
    ...['cases', 'handwritten'].flatMap((d) => readdirSync(join(golden, d)).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => readFileSync(join(golden, d, f), 'utf8'))),
    ...Object.values(FIXTURES),
    SAMPLE_TXMD,
  ];
  const r = rng(Number(process.env.FUZZ_SEED ?? 7));
  let ok = 0;
  let bad = 0;
  const out = process.env.FUZZ_OUT ?? devNull;
  const noise = ['*', '_', '~~', '  ', '|', ':', '[', ']', '{', '}', '@en ', '> ', '- ', '# ', '[/표]', '[/정보]', '---'];
  for (let n = 0; n < Number(process.env.FUZZ_N ?? 1500); n++) {
    const src = srcs[Math.floor(r() * srcs.length)];
    const lines = src.split('\n');
    const k = 1 + Math.floor(r() * 3);
    for (let i = 0; i < k; i++) {
      const at = Math.floor(r() * lines.length);
      const op = Math.floor(r() * 4);
      if (op === 0) lines.splice(at, 1);
      else if (op === 1) lines.splice(at, 0, lines[at] ?? '');
      else if (op === 2) lines[at] = '  ' + (lines[at] ?? '');
      else { const L = lines[at] ?? ''; const p = Math.floor(r() * (L.length + 1)); lines[at] = L.slice(0, p) + noise[Math.floor(r() * noise.length)] + L.slice(p); }
    }
    const mutated = lines.join('\n');
    let res;
    try {
      res = verifyRoundTrip(mutated, schema);
    } catch (e) {
      appendFileSync(out, `THROW ${(e as Error).message}\n${mutated}\n=====\n`);
      bad++;
      continue;
    }
    if (res.ok) ok++;
    else {
      bad++;
      appendFileSync(out, `FAIL ${res.reason}\n${mutated}\n=====\n`);
    }
  }
  appendFileSync(out, `SUMMARY ok=${ok} bad=${bad}\n`);
  expect(bad / (ok + bad)).toBeLessThan(0.02);
}, 60_000);
