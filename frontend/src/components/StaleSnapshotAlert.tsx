import { Alert, Text } from '@mantine/core';
import type { ObjectiveSnapshot } from '../api/types';

export const STALE_SNAPSHOT_TEXT = '최적화 실행 당시와 목적함수 코드가 다릅니다. 표시된 값은 현재 코드 기준입니다.';

/** 최적화 잡 스냅샷 해시와 현재 계산에 쓴 해시가 다르면 경고 */
export function StaleSnapshotAlert({ snapshot, current }: { snapshot: ObjectiveSnapshot | null; current: Record<string, string> }) {
  if (!snapshot) return null;
  const changed = Object.entries(snapshot).filter(([id, s]) => current[id] && current[id] !== s.codeHash);
  if (changed.length === 0) return null;
  return (
    <Alert color="yellow" title="목적함수 코드 변경됨">
      <Text size="sm">{STALE_SNAPSHOT_TEXT}</Text>
      <Text size="xs" c="dimmed">변경된 목적함수: {changed.map(([, s]) => s.name).join(', ')}</Text>
    </Alert>
  );
}
