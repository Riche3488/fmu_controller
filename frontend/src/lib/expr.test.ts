import { describe, expect, test } from 'vitest';
import { ExprError, evalExpr, exprColumns, exprParams, exprToPython, parseExpr } from './expr';

const py = (s: string) => exprToPython(parseExpr(s), (n) => `col(${JSON.stringify(n)})`);
const ev = (s: string, cols: Record<string, number[]> = {}, params: Record<string, number> = {}, n = 3) =>
  [...evalExpr(parseExpr(s), Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, new Float64Array(v)])), params, n)];

describe('expr', () => {
  test('컬럼·파라미터·연산', () => {
    const e = parseExpr('sqrt(x**2 + `a[1]`**2) * params.k');
    expect(exprColumns(e)).toEqual(['x', 'a[1]']);
    expect(exprParams(e)).toEqual(['k']);
    const r = evalExpr(e, { x: new Float64Array([3]), 'a[1]': new Float64Array([4]) }, { k: 2 }, 1);
    expect(r[0]).toBe(10);
  });
  test('점 있는 Modelica 이름', () => expect(exprColumns(parseExpr('vehicle.v*3.6'))).toEqual(['vehicle.v']));
  test('diff는 길이 유지', () =>
    expect([...evalExpr(parseExpr('diff(x)'), { x: new Float64Array([1, 3, 6]) }, {}, 3)]).toEqual([0, 2, 3]));
  test('모르는 함수는 오류', () => expect(() => parseExpr('foo(x)')).toThrow('알 수 없는 함수: foo'));
  test('괄호 불일치', () => expect(() => parseExpr('(x+1')).toThrow('괄호가 닫히지 않았습니다'));
  test('Python 변환', () =>
    expect(py('sqrt(`a[1]`)*params.k')).toBe('np.sqrt(col("a[1]")) * np.float64(params["k"])'));

  test('ExprError 클래스', () => {
    expect(() => parseExpr('1 +')).toThrow(ExprError);
    expect(() => parseExpr('')).toThrow(ExprError);
    expect(() => parseExpr('x y')).toThrow(ExprError);
    expect(() => parseExpr('min(x)')).toThrow(ExprError);
  });
  test('params["k"] 와 중복 제거', () => {
    const e = parseExpr('params["k"] + params.k + x + x');
    expect(exprParams(e)).toEqual(['k']);
    expect(exprColumns(e)).toEqual(['x']);
  });
  test('우선순위·결합', () => {
    expect(ev('1 + 2 * 3')).toEqual([7, 7, 7]);
    expect(ev('2 ** 3 ** 2')).toEqual([512, 512, 512]);
    expect(ev('-2 ** 2')).toEqual([-4, -4, -4]);
    expect(ev('2 ** -1')).toEqual([0.5, 0.5, 0.5]);
    expect(ev('10 - 3 - 2')).toEqual([5, 5, 5]);
    expect(ev('1.5e1 + .5')).toEqual([15.5, 15.5, 15.5]);
  });
  test('스칼라 식도 길이 n으로 방송', () => {
    const r = evalExpr(parseExpr('params.k * 2'), {}, { k: 4 }, 4);
    expect(r).toBeInstanceOf(Float64Array);
    expect([...r]).toEqual([8, 8, 8, 8]);
  });
  test('함수들', () => {
    expect(ev('min(x, 2)', { x: [1, 2, 3] })).toEqual([1, 2, 2]);
    expect(ev('max(x, 2)', { x: [1, 2, 3] })).toEqual([2, 2, 3]);
    expect(ev('cumsum(x)', { x: [1, 2, 3] })).toEqual([1, 3, 6]);
    expect(ev('abs(x)', { x: [-1, 2, -3] })).toEqual([1, 2, 3]);
    expect(ev('log10(x)', { x: [1, 10, 100] })).toEqual([0, 1, 2]);
  });
  test('없는 컬럼·파라미터', () => {
    expect(() => ev('x')).toThrow('컬럼이 없습니다: x');
    expect(() => ev('params.k')).toThrow('파라미터가 없습니다: k');
  });
  test('Python 괄호는 필요한 곳만', () => {
    expect(py('(a+b)*c')).toBe('(col("a") + col("b")) * col("c")');
    expect(py('a+b*c')).toBe('col("a") + col("b") * col("c")');
    expect(py('a-(b-c)')).toBe('col("a") - (col("b") - col("c"))');
    expect(py('a**b**c')).toBe('col("a") ** col("b") ** col("c")');
    expect(py('(a**b)**c')).toBe('(col("a") ** col("b")) ** col("c")');
    expect(py('(-a)**2')).toBe('(-col("a")) ** 2');
    expect(py('-a**2')).toBe('-col("a") ** 2');
    expect(py('2**-a')).toBe('2 ** -col("a")');
    expect(py('min(a, 1)')).toBe('np.minimum(col("a"), 1)');
    expect(py('diff(a*2)+cumsum(a)+log(a)')).toBe(
      '_diff(col("a") * 2) + np.cumsum(col("a")) + np.log(col("a"))',
    );
    expect(py('params["k"]')).toBe('np.float64(params["k"])');
  });
  test('유한하지 않은 숫자 리터럴은 오류', () => {
    expect(() => parseExpr('1e999')).toThrow(ExprError);
    expect(() => parseExpr('x * 1e999')).toThrow('유한하지 않은 숫자: 1e999');
  });
  test('Python: 리터럴끼리 연산은 np.float64로 (0 나눗셈이 예외가 아니라 inf)', () => {
    expect(py('1/0')).toBe('np.float64(1) / 0');
    expect(py('x * (2**-1)')).toBe('col("x") * np.float64(2) ** -1');
    expect(py('min(1, 2) ** -1')).toBe('np.float64(np.minimum(1, 2)) ** -1');
    expect(py('abs(-3) * 2')).toBe('np.float64(np.abs(-3)) * 2');
    expect(py('sqrt(4) / 0')).toBe('np.sqrt(4) / 0');
    expect(py('params.k / 0')).toBe('np.float64(params["k"]) / 0');
  });
  test('Python: 2**53 이상 정수 리터럴은 지수 표기', () => expect(py('x * 1e20')).toBe('col("x") * 1e+20'));
  test('Python: 스칼라 diff·cumsum은 시간 길이로 늘린다', () => {
    expect(py('diff(2)')).toBe('_diff(np.full_like(col("time"), 2))');
    expect(py('cumsum(params.k)')).toBe('np.cumsum(np.full_like(col("time"), np.float64(params["k"])))');
    expect(py('cumsum(diff(1))')).toBe('np.cumsum(_diff(np.full_like(col("time"), 1)))');
  });
});
