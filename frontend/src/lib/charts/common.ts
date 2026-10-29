// 차트 공용 상수·함수. index.ts와 각 차트 모듈이 순환 import 없이 쓰도록 따로 둔다.
import type { RunRow } from '../../api/types';
import type { FieldRef, WorkbenchData } from '../workbench';
import { fieldValue } from './fields';

export const DIM_OPACITY = 0.15;

/** 선택이 있으면 선택 안 된 run을 흐리게 */
export function itemOpacity(runId: string, selected: string[]): number {
  return selected.length === 0 || selected.includes(runId) ? 1 : DIM_OPACITY;
}

export const minOf = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Infinity);
export const maxOf = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -Infinity);
export const num = (x: number) => Math.round(x * 1e6) / 1e6;

/** 모든 필드 값이 있는 행만 (필드 하나라도 null이면 제외) */
export function completeRows(data: WorkbenchData, refs: FieldRef[]): { row: RunRow; v: number[] }[] {
  const out: { row: RunRow; v: number[] }[] = [];
  for (const row of data.rows) {
    const v = refs.map(r => fieldValue(row, r, data.objectives));
    if (v.every((x): x is number => x !== null)) out.push({ row, v });
  }
  return out;
}
