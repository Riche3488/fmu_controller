import { Badge, Tooltip } from '@mantine/core';

/** 목적함수 코드 해시(앞 8자). 값이 어떤 코드로 계산됐는지 표시한다. */
export function CodeHashBadge({ hash }: { hash: string }) {
  return (
    <Tooltip label={`코드 해시 ${hash}`}>
      <Badge variant="outline" color="gray" ff="monospace" tt="none">{hash.slice(0, 8)}</Badge>
    </Tooltip>
  );
}
