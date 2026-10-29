import { describe, expect, test } from 'vitest';
import { boxStats, csvLine } from './stats';

describe('boxStats', () => {
  test('quartiles with interpolation', () => {
    expect(boxStats([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(boxStats([4, 1, 3, 2])).toEqual([1, 1.75, 2.5, 3.25, 4]);
  });
  test('empty is null, single value collapses', () => {
    expect(boxStats([])).toBeNull();
    expect(boxStats([7])).toEqual([7, 7, 7, 7, 7]);
  });
});

describe('csvLine', () => {
  test('quotes cells with comma, quote or newline', () => {
    expect(csvLine(['a', 1, null, 'x,y', 'say "hi"', 'road.stopTable[1,1]'])).toBe('a,1,,"x,y","say ""hi""","road.stopTable[1,1]"');
  });
});
