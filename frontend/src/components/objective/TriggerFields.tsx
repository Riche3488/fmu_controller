// 트리거 한 개의 입력 (종류별 필드)
import { Group, Select, Stack } from '@mantine/core';
import type { Num, Trigger } from '../../lib/builder/spec';
import { NumField, OpSelect, SignalSelect, type SignalGroups } from './builderFields';
import { defaultTrigger } from './specDefaults';

const KINDS: { value: Trigger['kind']; label: string }[] = [
  { value: 'cross', label: '임계값 교차' },
  { value: 'reach', label: '조건 도달' },
  { value: 'time', label: '특정 시각' },
  { value: 'extremum', label: '최대/최소 시점' },
  { value: 'hold', label: '조건 N초 유지' },
];

const OCCURRENCE = [{ value: 'first', label: '처음' }, { value: 'last', label: '마지막' }];

export function TriggerFields({ index, value, onChange, groups, paramNames, defaultSignal }: {
  index: number; value: Trigger; onChange: (t: Trigger) => void;
  groups: SignalGroups; paramNames: string[]; defaultSignal: string;
}) {
  const p = `트리거 ${index + 1}`;
  const num = (label: string, v: Num, set: (n: Num) => void) => (
    <NumField label={`${p} ${label}`} value={v} onChange={set} paramNames={paramNames} />
  );
  const signal = value.kind === 'time' ? null : (
    <SignalSelect label={`${p} 신호`} value={value.signal} groups={groups} onChange={s => onChange({ ...value, signal: s })} />
  );

  return (
    <Stack gap="xs">
      <Select
        label={`${p} 종류`} data={KINDS} value={value.kind} allowDeselect={false}
        onChange={k => k && k !== value.kind && onChange(defaultTrigger(k as Trigger['kind'], value.kind === 'time' ? defaultSignal : value.signal))}
      />
      {signal}
      {value.kind === 'cross' && (
        <>
          <Group grow>
            <Select label={`${p} 방향`} allowDeselect={false} value={value.dir}
              data={[{ value: 'up', label: '상승' }, { value: 'down', label: '하강' }]}
              onChange={d => d && onChange({ ...value, dir: d as 'up' | 'down' })} />
            <Select label={`${p} 순서`} allowDeselect={false} value={value.occurrence} data={OCCURRENCE}
              onChange={o => o && onChange({ ...value, occurrence: o as 'first' | 'last' })} />
          </Group>
          {num('임계값', value.threshold, threshold => onChange({ ...value, threshold }))}
        </>
      )}
      {value.kind === 'reach' && (
        <>
          <Group grow>
            <OpSelect label={`${p} 비교`} value={value.op} onChange={op => onChange({ ...value, op })} />
            <Select label={`${p} 순서`} allowDeselect={false} value={value.occurrence} data={OCCURRENCE}
              onChange={o => o && onChange({ ...value, occurrence: o as 'first' | 'last' })} />
          </Group>
          {num('임계값', value.threshold, threshold => onChange({ ...value, threshold }))}
        </>
      )}
      {value.kind === 'time' && num('시각 [s]', value.t, t => onChange({ ...value, t }))}
      {value.kind === 'extremum' && (
        <Select label={`${p} 극값`} allowDeselect={false} value={value.which}
          data={[{ value: 'max', label: '최대' }, { value: 'min', label: '최소' }]}
          onChange={w => w && onChange({ ...value, which: w as 'max' | 'min' })} />
      )}
      {value.kind === 'hold' && (
        <>
          <OpSelect label={`${p} 비교`} value={value.op} onChange={op => onChange({ ...value, op })} />
          {num('임계값', value.threshold, threshold => onChange({ ...value, threshold }))}
          {num('유지 시간 [s]', value.durationSec, durationSec => onChange({ ...value, durationSec }))}
        </>
      )}
    </Stack>
  );
}
