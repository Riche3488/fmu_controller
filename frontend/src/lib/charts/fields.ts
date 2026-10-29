// 패널 필드 참조 → run 값
import type { RunRow } from '../../api/types';
import type { FieldRef } from '../workbench';

/** 파라미터(bool은 0/1)나 목적함수(이름으로 찾음) 값. 없거나 오류면 null. */
export function fieldValue(row: RunRow, ref: FieldRef, objectives: { id: string; name: string }[]): number | null {
  if (ref.kind === 'param') {
    const v = row.params[ref.name];
    return typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : null;
  }
  const id = objectives.find(o => o.name === ref.name)?.id;
  return id === undefined ? null : row.objectives[id]?.value ?? null;
}
