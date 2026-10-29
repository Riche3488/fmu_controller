// 작업 공간 5단계의 완료 여부와 다음 행동 판정. 순수 함수 + 리소스 방문 기록(localStorage).

export type StepKey = 'model' | 'resources' | 'objectives' | 'run' | 'results';

export const STEPS: { key: StepKey; label: string; path: string }[] = [
  { key: 'model', label: '① 모델', path: '' },
  { key: 'resources', label: '② 변수·리소스', path: 'resources' },
  { key: 'objectives', label: '③ 목적함수', path: 'objectives' },
  { key: 'run', label: '④ 실행', path: 'run' },
  { key: 'results', label: '⑤ 결과 분석', path: 'results' },
];

export type WorkflowInput = { nJobs: number; nOkRuns: number; nCompatibleObjectives: number; resourcesVisited: boolean };

export function stepDone(key: StepKey, i: WorkflowInput): boolean {
  switch (key) {
    case 'model': return true;
    case 'resources': return i.resourcesVisited || i.nJobs > 0;
    case 'objectives': return i.nCompatibleObjectives > 0;
    case 'run': return i.nJobs > 0;
    case 'results': return i.nOkRuns > 0;
  }
}

const NEXT_LABEL: Record<Exclude<StepKey, 'model'>, string> = {
  resources: '변수·리소스 확인',
  objectives: '목적함수 설계하기',
  run: '배치/최적화 실행',
  results: '결과 분석',
};

// 모델 단계는 항상 완료이므로 제외하고 첫 미완료 단계를 고른다. 모두 끝났으면 결과 분석.
export function nextAction(i: WorkflowInput): { step: StepKey; label: string } {
  for (const { key } of STEPS) {
    if (key === 'model') continue;
    if (!stepDone(key, i)) return { step: key, label: NEXT_LABEL[key] };
  }
  return { step: 'results', label: NEXT_LABEL.results };
}

// fmu별 리소스 화면 방문 기록. 저장소를 쓸 수 없어도 화면이 깨지지 않도록 예외를 삼킨다.
const visitedKey = (fmuId: string) => `fmuc.visited.resources.${fmuId}`;

export function markResourcesVisited(fmuId: string): void {
  try {
    localStorage.setItem(visitedKey(fmuId), '1');
  } catch {
    // 저장 실패 시 방문 기록만 남지 않는다
  }
}

export function isResourcesVisited(fmuId: string): boolean {
  try {
    return localStorage.getItem(visitedKey(fmuId)) !== null;
  } catch {
    return false;
  }
}
