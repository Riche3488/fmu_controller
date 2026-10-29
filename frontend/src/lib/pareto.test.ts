import { describe, expect, test } from 'vitest';
import { paretoFront } from './pareto';

describe('paretoFront', () => {
  test('minimize both', () => {
    expect(paretoFront([[1, 5], [2, 2], [3, 3], [5, 1]], ['minimize', 'minimize'])).toEqual([true, true, false, true]);
  });

  test('maximize flips dominance', () => {
    expect(paretoFront([[1, 5], [2, 2], [3, 3], [5, 1]], ['maximize', 'maximize'])).toEqual([true, false, true, true]);
  });

  test('mixed directions', () => {
    // f1 최소화, f2 최대화: [1,5]가 나머지 모두를 지배
    expect(paretoFront([[1, 5], [2, 2], [3, 3]], ['minimize', 'maximize'])).toEqual([true, false, false]);
  });

  test('points with null are never on the front', () => {
    expect(paretoFront([[null, 1], [2, 2]], ['minimize', 'minimize'])).toEqual([false, true]);
  });

  test('duplicates are both kept', () => {
    expect(paretoFront([[1, 1], [1, 1]], ['minimize', 'minimize'])).toEqual([true, true]);
  });
});
