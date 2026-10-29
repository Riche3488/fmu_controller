import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PARITY_CASES } from './cases';
import { generateCode } from './codegen';
import { evaluateSpec } from './evaluate';

const FIXTURE = resolve(__dirname, '../../../../backend/tests/fixtures/builder_parity.json');

function build() {
  return PARITY_CASES.map((c) => {
    const r = evaluateSpec(c.spec, {
      time: new Float64Array(c.data.time),
      cols: Object.fromEntries(Object.entries(c.data.cols).map(([k, v]) => [k, new Float64Array(v)])),
      params: c.data.params,
    });
    return { name: c.name, code: generateCode(c.spec), data: c.data, expected: { value: r.value, error: r.error } };
  });
}
const serialize = (x: unknown) => JSON.stringify(x, null, 2) + '\n';

test('케이스 수와 이름 중복', () => {
  expect(PARITY_CASES.length).toBeGreaterThanOrEqual(25);
  expect(new Set(PARITY_CASES.map((c) => c.name)).size).toBe(PARITY_CASES.length);
});

test('fixture가 TS 평가·코드 생성과 일치', () => {
  const built = build();
  if (process.env.UPDATE_PARITY === '1') {
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, serialize(built), 'utf-8');
    return;
  }
  expect(existsSync(FIXTURE)).toBe(true);
  // 줄바꿈 차이(CRLF 체크아웃)는 무시
  expect(readFileSync(FIXTURE, 'utf-8').replace(/\r\n/g, '\n')).toBe(serialize(built));
});
