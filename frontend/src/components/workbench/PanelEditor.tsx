// 패널 편집 드로어: 제목·차트 종류·필드 매핑. 바꾸는 즉시 패널에 반영한다.
import { Drawer, MultiSelect, SegmentedControl, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import {
  CHART_GROUPS, CHART_LABELS, CHART_SLOTS, isChartKind, parseRefKey, refKey, type ChartKind, type FieldRef, type GroupRef, type PanelSpec,
  type WorkbenchData,
} from '../../lib/workbench';

const COMBO = { comboboxProps: { transitionProps: { duration: 0 } } };
const REF_LABEL: Record<'x' | 'y' | 'z' | 'size', string> = { x: 'X축', y: 'Y축 (값)', z: 'Z (값)', size: '크기' };
const MAX_RUN_OPTIONS = 500;

type Option = { value: string; label: string };
type Group = { group: string; items: Option[] };

/** 참조 후보. 지금 데이터에 없는 값도 지워지지 않게 '(없음)'으로 붙여 둔다. */
function withMissing(groups: Group[], values: string[]): Group[] {
  const known = new Set(groups.flatMap(g => g.items.map(i => i.value)));
  const missing = values.filter(v => !known.has(v));
  if (!missing.length) return groups;
  return [...groups, {
    group: '찾을 수 없음', items: missing.map(v => ({ value: v, label: `${v.replace(/^(param|objective):/, '')} (없음)` })),
  }];
}

export function PanelEditor({ spec, data, onChange, onClose }: {
  spec: PanelSpec | null;
  data: WorkbenchData;
  onChange: (spec: PanelSpec) => void;
  onClose: () => void;
}) {
  const fieldGroups: Group[] = [
    { group: '파라미터', items: data.params.map(p => ({ value: refKey({ kind: 'param', name: p }), label: p })) },
    { group: '목적함수', items: data.objectives.map(o => ({ value: refKey({ kind: 'objective', name: o.name }), label: o.name })) },
  ];
  const slots = spec && isChartKind(spec.chart) ? CHART_SLOTS[spec.chart] : [];
  const patch = (p: Partial<PanelSpec>) => {
    if (!spec) return;
    const next = { ...spec, ...p } as Record<string, unknown>;
    // undefined 키는 남기지 않는다 (프리셋 JSON 비교·저장용)
    Object.keys(next).forEach(k => next[k] === undefined && delete next[k]);
    onChange(next as PanelSpec);
  };
  const refSelect = (slot: 'x' | 'y' | 'z' | 'size') => {
    const value = spec?.[slot] ? refKey(spec[slot]!) : null;
    return (
      <Select key={slot} label={REF_LABEL[slot]} clearable searchable value={value} {...COMBO}
        data={withMissing(fieldGroups, value ? [value] : [])}
        onChange={v => patch({ [slot]: v ? parseRefKey(v) as FieldRef : undefined })} />
    );
  };

  const runLabel = (id: string) => {
    const r = data.rows.find(x => x.id === id);
    const job = r && data.jobs.find(j => j.id === r.jobId)?.name;
    return r ? `${job ?? r.jobId} #${r.index}` : `${id} (없음)`;
  };

  return (
    <Drawer opened={!!spec} onClose={onClose} title="패널 편집" position="right" size="md" transitionProps={{ duration: 0 }}>
      {spec && (
        <Stack>
          <TextInput label="제목" value={spec.title} onChange={e => patch({ title: e.currentTarget.value })} />
          <Select label="차트 종류" value={spec.chart} allowDeselect={false} {...COMBO}
            data={CHART_GROUPS.map(g => ({ group: g.label, items: g.charts.map(c => ({ value: c, label: CHART_LABELS[c] })) }))}
            onChange={v => v && patch({ chart: v as ChartKind })} />
          {slots.length === 0 && <Text size="sm" c="dimmed">이 차트는 따로 고를 필드가 없습니다.</Text>}
          {slots.map(slot => {
            switch (slot) {
              case 'x': case 'y': case 'z': case 'size':
                return refSelect(slot);
              case 'color': {
                const value = spec.color ? refKey(spec.color) : null;
                const groups = [...fieldGroups, { group: '그룹', items: [{ value: 'job', label: '잡' }, { value: 'variant', label: 'Resource 조합' }] }];
                return (
                  <Select key={slot} label="색" clearable searchable value={value} {...COMBO} data={withMissing(groups, value ? [value] : [])}
                    onChange={v => patch({ color: v ? parseRefKey(v) as FieldRef | GroupRef : undefined })} />
                );
              }
              case 'fields': {
                const values = (spec.fields ?? []).map(refKey);
                return (
                  <MultiSelect key={slot} label="필드" searchable value={values} {...COMBO} data={withMissing(fieldGroups, values)}
                    onChange={v => patch({ fields: v.length ? v.map(k => parseRefKey(k) as FieldRef) : undefined })} />
                );
              }
              case 'groupBy':
                return (
                  <Select key={slot} label="그룹" clearable value={spec.groupBy ?? null} {...COMBO}
                    data={[{ value: 'job', label: '잡' }, { value: 'variant', label: 'Resource 조합' }]}
                    onChange={v => patch({ groupBy: (v ?? undefined) as PanelSpec['groupBy'] })} />
                );
              case 'vars': {
                const values = spec.vars ?? [];
                const missing = values.filter(v => v !== 'time' && !data.vars.includes(v));
                return (
                  <MultiSelect key={slot} label="변수" searchable limit={200} value={values} {...COMBO}
                    data={[...data.vars, ...missing.map(v => ({ value: v, label: `${v} (없음)` }))]}
                    onChange={v => patch({ vars: v.length ? v : undefined })} />
                );
              }
              case 'refRunId': {
                const ids = data.rows.slice(0, MAX_RUN_OPTIONS).map(r => r.id);
                if (spec.refRunId && !ids.includes(spec.refRunId)) ids.push(spec.refRunId);
                return (
                  <Select key={slot} label="기준 run" clearable searchable value={spec.refRunId ?? null} {...COMBO}
                    data={ids.map(id => ({ value: id, label: runLabel(id) }))}
                    onChange={v => patch({ refRunId: v ?? undefined })} />
                );
              }
              case 'objectiveDir':
                return (
                  <Stack key={slot} gap={4}>
                    <Text size="sm" fw={500}>방향</Text>
                    <SegmentedControl value={spec.objectiveDir ?? 'minimize'} transitionDuration={0}
                      data={[{ value: 'minimize', label: '최소화' }, { value: 'maximize', label: '최대화' }]}
                      onChange={v => patch({ objectiveDir: v as PanelSpec['objectiveDir'] })} />
                  </Stack>
                );
              case 'violin':
                return <Switch key={slot} label="바이올린" checked={!!spec.violin} onChange={e => patch({ violin: e.currentTarget.checked || undefined })} />;
              case 'method':
                return (
                  <Stack key={slot} gap={4}>
                    <Text size="sm" fw={500}>상관 계수</Text>
                    <SegmentedControl value={spec.method ?? 'pearson'} transitionDuration={0}
                      data={[{ value: 'pearson', label: 'Pearson' }, { value: 'spearman', label: 'Spearman' }]}
                      onChange={v => patch({ method: v as PanelSpec['method'] })} />
                  </Stack>
                );
            }
          })}
        </Stack>
      )}
    </Drawer>
  );
}
