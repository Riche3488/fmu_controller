import { describe, expect, test } from 'vitest';
import { countCases, defaultBounds, expandValues, previewCases } from './sweep';
import type { SweepParam } from '../api/types';

const listA3: SweepParam = { name: 'a', mode: 'list', values: [1, 2, 3] };
const listB3: SweepParam = { name: 'b', mode: 'list', values: [10, 20, 30] };
const listB4: SweepParam = { name: 'b', mode: 'list', values: [10, 20, 30, 40] };
const rangeA: SweepParam = { name: 'a', mode: 'range', min: 0, max: 1, steps: 5 };

describe('sweep', () => {
  test('expandValues range is inclusive and evenly spaced', () => {
    expect(expandValues({ name: 'a', mode: 'range', min: 0, max: 1, steps: 3 })).toEqual([0, 0.5, 1]);
    expect(expandValues({ name: 'a', mode: 'range', min: 2, max: 5, steps: 1 })).toEqual([2]);
  });

  test('countCases grid is the cartesian product', () => {
    expect(countCases([listA3, listB4], 'grid', null)).toBe(12);
  });

  test('countCases zip pairs values', () => {
    expect(countCases([listA3, listB3], 'zip', null)).toBe(3);
  });

  test('zip with unequal lengths throws', () => {
    expect(() => countCases([listA3, listB4], 'zip', null)).toThrow('zip 방식은 모든 파라미터의 값 개수가 같아야 합니다');
  });

  test('lhs/random use nSamples', () => {
    expect(countCases([rangeA], 'lhs', 50)).toBe(50);
    expect(countCases([rangeA], 'random', 7)).toBe(7);
  });

  test('lhs with list params throws', () => {
    expect(() => countCases([listA3], 'lhs', 10)).toThrow('LHS/random 방식은 range 파라미터만 지원합니다');
  });

  test('no params means zero cases', () => {
    expect(countCases([], 'grid', null)).toBe(0);
  });

  test('previewCases grid enumerates combinations up to limit', () => {
    const cases = previewCases([listA3, listB4], 'grid', null, 5);
    expect(cases).toHaveLength(5);
    expect(cases[0]).toEqual({ a: 1, b: 10 });
    expect(cases[1]).toEqual({ a: 1, b: 20 });
  });

  test('previewCases zip and lhs', () => {
    expect(previewCases([listA3, listB3], 'zip', null)).toEqual([{ a: 1, b: 10 }, { a: 2, b: 20 }, { a: 3, b: 30 }]);
    expect(previewCases([rangeA], 'lhs', 50)).toEqual([]);
  });
});

describe('defaultBounds', () => {
  test('scales start, handles zero and negative', () => {
    expect(defaultBounds(45)).toEqual({ min: 22.5, max: 67.5 });
    expect(defaultBounds(0)).toEqual({ min: -1, max: 1 });
    expect(defaultBounds(-2)).toEqual({ min: -3, max: -1 });
    expect(defaultBounds(true)).toEqual({ min: -1, max: 1 });
  });
});
