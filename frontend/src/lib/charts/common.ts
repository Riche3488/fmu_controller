// 차트 공용 상수·함수. index.ts와 각 차트 모듈이 순환 import 없이 쓰도록 따로 둔다.
export const DIM_OPACITY = 0.15;

/** 선택이 있으면 선택 안 된 run을 흐리게 */
export function itemOpacity(runId: string, selected: string[]): number {
  return selected.length === 0 || selected.includes(runId) ? 1 : DIM_OPACITY;
}
