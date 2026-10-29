import { describe, expect, test } from 'vitest';
import { DEFAULT_SPEC, type BuilderSpec } from './spec';
import { HEADER_PREFIX, generateCode, parseBuilderCode } from './codegen';

const SPEC_EX: BuilderSpec = {
  version: 1,
  derived: [{ name: 'kmh', expr: 'v*3.6' }],
  triggers: [{ kind: 'cross', signal: 'pedal', dir: 'up', threshold: { param: 'th' }, occurrence: 'first' }],
  window: { kind: 'fromTrigger' },
  calc: { kind: 'delta', signal: 'x' },
  post: { abs: false, negate: true, scale: 2 },
};

describe('generateCode / parseBuilderCode', () => {
  test('헤더 왕복', () => {
    const c = generateCode(SPEC_EX);
    expect(parseBuilderCode(c)).toEqual({ spec: SPEC_EX, intact: true });
  });
  test('본문을 고치면 intact=false', () =>
    expect(parseBuilderCode(generateCode(SPEC_EX).replace('return float(v)', 'return float(v) * 2'))!.intact).toBe(false));
  test('CRLF여도 intact', () => expect(parseBuilderCode(generateCode(SPEC_EX).replace(/\n/g, '\r\n'))!.intact).toBe(true));
  test('끝 공백줄이 늘어도 intact', () => expect(parseBuilderCode(generateCode(SPEC_EX) + '\n\n  \n')!.intact).toBe(true));
  test('헤더 없는 코드는 null', () => expect(parseBuilderCode('def evaluate(r, p):\n    return 1.0\n')).toBeNull());
  test('헤더 JSON이 깨지면 null', () => expect(parseBuilderCode(`${HEADER_PREFIX}{oops\nimport numpy as np\n`)).toBeNull());
  test('이상한 컬럼명은 문자열 리터럴로', () =>
    expect(generateCode({ ...SPEC_EX, calc: { kind: 'max', signal: 'a["b"]' } })).toContain('col("a[\\"b\\"]")'));
  test('evaluate 함수 정의 포함', () => expect(generateCode(DEFAULT_SPEC)).toMatch(/^def evaluate\(result, params\):/m));
  test('첫 줄은 헤더 + 스펙 JSON', () =>
    expect(generateCode(SPEC_EX).split('\n')[0]).toBe(HEADER_PREFIX + JSON.stringify(SPEC_EX)));
  test('같은 스펙이면 같은 코드', () => expect(generateCode(SPEC_EX)).toBe(generateCode(structuredClone(SPEC_EX))));
  test('파생식·트리거·파라미터 반영', () => {
    const c = generateCode(SPEC_EX);
    expect(c).toContain('sig["kmh"] = _vec(col("v") * 3.6, n)');
    expect(c).toContain('col("pedal")');
    expect(c).toContain('{"param": "th"}');
    expect(c).toContain('"negate": True');
  });
  test('파생식 파싱 오류는 그 자리에서 ValueError', () =>
    expect(generateCode({ ...SPEC_EX, derived: [{ name: 'q', expr: '(x+1' }] })).toContain(
      'raise ValueError("괄호가 닫히지 않았습니다")',
    ));
  test('트리거가 모자라면 ValueError', () =>
    expect(generateCode({ ...SPEC_EX, window: { kind: 'between' } })).toContain('raise ValueError("트리거가 2개 필요합니다")'));
  test('남는 트리거는 쓰지 않는다', () => {
    const c = generateCode({ ...SPEC_EX, window: { kind: 'all' } });
    expect(c).not.toContain('col("pedal")');
  });
});
