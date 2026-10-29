// 빌더 폼에서 새 블록을 만들 때 쓰는 기본값
import type { Trigger } from '../../lib/builder/spec';

export function defaultTrigger(kind: Trigger['kind'], signal: string): Trigger {
  switch (kind) {
    case 'cross': return { kind, signal, dir: 'up', threshold: 0, occurrence: 'first' };
    case 'reach': return { kind, signal, op: '>=', threshold: 0, occurrence: 'first' };
    case 'time': return { kind, t: 0 };
    case 'extremum': return { kind, signal, which: 'max' };
    case 'hold': return { kind, signal, op: '>=', threshold: 0, durationSec: 1 };
  }
}
