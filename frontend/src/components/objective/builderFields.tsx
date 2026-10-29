// 빌더 블록 공용 입력: 수치/파라미터 토글, 신호 선택, 비교 연산자
import { Autocomplete, Group, NumberInput, Select, Switch, type ComboboxItemGroup } from '@mantine/core';
import { useEffect, useState } from 'react';
import type { CmpOp, Num } from '../../lib/builder/spec';

export type SignalGroups = ComboboxItemGroup<string>[];

/** 숫자 또는 run 파라미터(params["k"]) 입력. */
export function NumField({ label, value, onChange, paramNames }: {
  label: string; value: Num; onChange: (v: Num) => void; paramNames: string[];
}) {
  const isParam = typeof value !== 'number';
  // 입력 중의 "", "-", "0." 같은 미완성 글을 유지하려고 글 상태를 따로 둔다
  const [text, setText] = useState<string | number>(isParam ? '' : value);
  useEffect(() => {
    if (typeof value === 'number' && Number(text) !== value) setText(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Group gap="xs" align="flex-end" wrap="nowrap">
      {isParam ? (
        <Autocomplete
          label={label} placeholder="파라미터 이름" data={paramNames} value={value.param} style={{ flex: 1 }}
          onChange={param => onChange({ param })}
        />
      ) : (
        <NumberInput
          label={label} value={text} style={{ flex: 1 }} decimalScale={10}
          onChange={v => {
            setText(v);
            const n = typeof v === 'number' ? v : Number(v);
            if (v !== '' && Number.isFinite(n)) onChange(n);
          }}
        />
      )}
      <Switch
        mb={8} size="xs" label="파라미터" aria-label={`${label} 파라미터`} checked={isParam}
        onChange={e => onChange(e.currentTarget.checked ? { param: paramNames[0] ?? '' } : 0)}
      />
    </Group>
  );
}

export function SignalSelect({ label, value, onChange, groups }: {
  label: string; value: string; onChange: (v: string) => void; groups: SignalGroups;
}) {
  // 현재 값이 목록에 없어도(다른 FMU에서 만든 코드 등) 보이도록 끼워 넣는다
  const known = groups.some(g => g.items.includes(value));
  const data = known || !value ? groups : [{ group: '현재 값', items: [value] }, ...groups];
  return (
    <Select
      label={label} data={data} value={value || null} searchable limit={100} nothingFoundMessage="일치하는 신호가 없습니다"
      onChange={v => v && onChange(v)} allowDeselect={false}
    />
  );
}

const OPS: { value: CmpOp; label: string }[] = [
  { value: '>=', label: '≥' }, { value: '>', label: '>' }, { value: '<=', label: '≤' }, { value: '<', label: '<' },
];

export function OpSelect({ label, value, onChange }: { label: string; value: CmpOp; onChange: (v: CmpOp) => void }) {
  return (
    <Select label={label} data={OPS} value={value} w={80} allowDeselect={false} onChange={v => v && onChange(v as CmpOp)} />
  );
}
