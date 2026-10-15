import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyRoundTrip } from '../roundtrip';
import { getSchema } from './helpers';

const golden = join(__dirname, '../../markup/__golden__');
const dirs = [join(golden, 'cases'), join(golden, 'handwritten')];
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => join(d, f)));

describe('골든 입력 왕복(.txmd -> 문서 -> .txmd)', () => {
  for (const f of files) {
    it(f.split(/[\/]/).slice(-2).join('/'), async () => {
      const schema = await getSchema();
      const src = readFileSync(f, 'utf8');
      const r = verifyRoundTrip(src, schema);
      if (!r.ok) console.log(r.reason, '\n----\n', r.out);
      expect(r.reason).toBeUndefined();
      expect(r.ok).toBe(true);
    });
  }
});

import { FIXTURES } from './fixtures';
import { SAMPLE_TXMD } from '../../ui/state/sample';

describe('문법 조합 왕복', () => {
  for (const [name, src] of Object.entries({ ...FIXTURES, '앱 샘플 초안': SAMPLE_TXMD })) {
    it(name, async () => {
      const schema = await getSchema();
      const r = verifyRoundTrip(src, schema);
      expect(r.reason, r.out).toBeUndefined();
    });
  }
});

describe('문서의 .md 코드 펜스 스윕', () => {
  const docs = ['src/markup/TXMD.md', 'sample/skills/tx-html-generator/references/MARKUP_SYNTAX.md', 'sample/skills/tx-html-generator/references/example.md'];
  for (const d of docs) {
    const md = readFileSync(join(__dirname, '../../../', d), 'utf8');
    const blocks = [...md.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => /^(#|\[|[-*>]|\d+\.|@)/m.test(b) && !/^(\s*<|import |npm )/m.test(b));
    blocks.forEach((b, i) => {
      it(`${d.split('/').pop()} 펜스 #${i + 1}`, async () => {
        const schema = await getSchema();
        const r = verifyRoundTrip(b, schema);
        expect(r.reason, b + '\n----\n' + r.out).toBeUndefined();
      });
    });
  }
});

import { planDraft } from '../../ui/state/draft';
import { createSampleProject } from '../../ui/state/sample';

describe('기존 + 초안 흐름과의 연동(planDraft)', () => {
  it('샘플 초안을 에디터로 왕복한 .txmd 를 변환 확인에 넣으면 변경이 없다(ID·번역 그대로)', async () => {
    const schema = await getSchema();
    const p = createSampleProject();
    const r = verifyRoundTrip(SAMPLE_TXMD, schema);
    expect(r.ok).toBe(true);
    const plan = planDraft(p, r.out);
    expect(plan.unchanged).toBe(true);
    expect(plan.counts).toMatchObject({ added: 0, changed: 0, removed: 0 });
  });

  it('에디터에서 한 문단만 고치면 변경 1개(번역 줄은 그대로 이어진다)', async () => {
    const schema = await getSchema();
    const p = createSampleProject();
    const edited = SAMPLE_TXMD.replace('본 메일은 발신 전용입니다. 문의: 고객센터 1588-0000', '본 메일은 발신 전용입니다. 문의: 고객센터 1588-1111');
    const r = verifyRoundTrip(edited, schema);
    expect(r.ok).toBe(true);
    const plan = planDraft(p, r.out);
    expect(plan.counts.changed).toBe(1);
    expect(plan.counts.added + plan.counts.removed).toBe(0);
  });
});
