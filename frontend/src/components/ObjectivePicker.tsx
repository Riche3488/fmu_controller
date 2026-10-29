import { Checkbox, Group, Radio, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import type { Direction } from '../api/types';
import { CodeHashBadge } from './CodeHashBadge';

export type ObjectivePickerProps = {
  value: string[];
  onChange: (ids: string[]) => void;
  withDirection?: boolean;
  directions?: Record<string, Direction>;
  onDirectionsChange?: (d: Record<string, Direction>) => void;
};

/** 목적함수 다중 선택. 각 항목에 현재 코드 해시를 표시한다. 선택 순서를 유지한다. */
export function ObjectivePicker({ value, onChange, withDirection = false, directions = {}, onDirectionsChange }: ObjectivePickerProps) {
  const api = useApi();
  const list = useQuery({ queryKey: ['objectives'], queryFn: () => api.listObjectives() });
  if (list.isSuccess && list.data.length === 0) {
    return <Text size="sm" c="dimmed">목적함수가 없습니다. 목적함수 메뉴에서 먼저 만드세요.</Text>;
  }
  return (
    <Stack gap="xs">
      {(list.data ?? []).map(o => {
        const checked = value.includes(o.id);
        return (
          <Group key={o.id} justify="space-between">
            <Group gap="xs">
              <Checkbox label={o.name} checked={checked}
                onChange={e => onChange(e.currentTarget.checked ? [...value, o.id] : value.filter(id => id !== o.id))} />
              <CodeHashBadge hash={o.codeHash} />
            </Group>
            {withDirection && checked && (
              <Radio.Group value={directions[o.id] ?? 'minimize'}
                onChange={d => onDirectionsChange?.({ ...directions, [o.id]: d as Direction })}>
                <Group gap="sm">
                  <Radio value="minimize" label="최소화" aria-label={`${o.name} 최소화`} />
                  <Radio value="maximize" label="최대화" aria-label={`${o.name} 최대화`} />
                </Group>
              </Radio.Group>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}
