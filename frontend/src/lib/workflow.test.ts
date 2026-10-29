import { beforeEach, describe, expect, test, vi } from 'vitest';
import { STEPS, isResourcesVisited, markResourcesVisited, nextAction, stepDone } from './workflow';

const empty = { nJobs: 0, nOkRuns: 0, nCompatibleObjectives: 0, resourcesVisited: false };

describe('단계 완료 판정', () => {
  test('model은 항상 완료', () => expect(stepDone('model', empty)).toBe(true));
  test('STEPS는 순서·라벨·경로가 고정', () => {
    expect(STEPS.map((s) => [s.key, s.label, s.path])).toEqual([
      ['model', '① 모델', ''],
      ['resources', '② 변수·리소스', 'resources'],
      ['objectives', '③ 목적함수', 'objectives'],
      ['run', '④ 실행', 'run'],
      ['results', '⑤ 결과 분석', 'results'],
    ]);
  });
  test('resources는 방문 또는 잡 존재로 완료', () => {
    expect(stepDone('resources', empty)).toBe(false);
    expect(stepDone('resources', { ...empty, resourcesVisited: true })).toBe(true);
    expect(stepDone('resources', { ...empty, nJobs: 1 })).toBe(true);
  });
  test('objectives는 호환 목적함수가 있을 때 완료', () => {
    expect(stepDone('objectives', empty)).toBe(false);
    expect(stepDone('objectives', { ...empty, nCompatibleObjectives: 2 })).toBe(true);
  });
  test('run은 잡이 있을 때, results는 성공 run이 있을 때 완료', () => {
    expect(stepDone('run', { ...empty, nJobs: 1 })).toBe(true);
    expect(stepDone('run', { ...empty, nOkRuns: 1 })).toBe(false);
    expect(stepDone('results', { ...empty, nOkRuns: 1 })).toBe(true);
    expect(stepDone('results', { ...empty, nJobs: 1 })).toBe(false);
  });
});

describe('다음 행동 판정', () => {
  test('처음엔 리소스 확인부터', () => expect(nextAction(empty)).toEqual({ step: 'resources', label: '변수·리소스 확인' }));
  test('리소스 본 뒤엔 목적함수', () => expect(nextAction({ ...empty, resourcesVisited: true }).step).toBe('objectives'));
  test('목적함수 라벨', () => expect(nextAction({ ...empty, resourcesVisited: true })).toEqual({ step: 'objectives', label: '목적함수 설계하기' }));
  test('목적함수 있으면 실행', () => expect(nextAction({ ...empty, resourcesVisited: true, nCompatibleObjectives: 1 })).toEqual({ step: 'run', label: '배치/최적화 실행' }));
  test('성공 run 있으면 결과', () => expect(nextAction({ nJobs: 1, nOkRuns: 3, nCompatibleObjectives: 1, resourcesVisited: true })).toEqual({ step: 'results', label: '결과 분석' }));
  test('잡은 있는데 목적함수 없으면 목적함수', () => expect(nextAction({ nJobs: 1, nOkRuns: 3, nCompatibleObjectives: 0, resourcesVisited: true }).step).toBe('objectives'));
});

describe('리소스 방문 기록', () => {
  beforeEach(() => vi.restoreAllMocks());
  test('fmu별로 기록되고 다른 fmu에는 새지 않는다', () => {
    expect(isResourcesVisited('fmu-a')).toBe(false);
    markResourcesVisited('fmu-a');
    expect(isResourcesVisited('fmu-a')).toBe(true);
    expect(isResourcesVisited('fmu-b')).toBe(false);
    expect(localStorage.getItem('fmuc.visited.resources.fmu-a')).not.toBeNull();
  });
  test('localStorage가 던져도 예외 없이 false / 무시', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => markResourcesVisited('fmu-a')).not.toThrow();
    expect(isResourcesVisited('fmu-a')).toBe(false);
    get.mockRestore();
    set.mockRestore();
  });
});
