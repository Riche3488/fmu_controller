// 목적함수 빌더 블록 폼: 파생 신호 → 트리거 → 구간 → 계산 → 후처리
import { ActionIcon, Button, Checkbox, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import type { ReactNode } from 'react';
import { parseExpr } from '../../lib/expr';
import { windowTriggerCount, type BuilderSpec, type Calc, type Window } from '../../lib/builder/spec';
import { NumField, OpSelect, SignalSelect, type SignalGroups } from './builderFields';
import { defaultTrigger } from './specDefaults';
import { TriggerFields } from './TriggerFields';

const WINDOWS: { value: Window['kind']; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'fromTrigger', label: '트리거 ~ 종료' },
  { value: 'untilTrigger', label: '시작 ~ 트리거' },
  { value: 'between', label: '트리거1 ~ 트리거2' },
  { value: 'around', label: '트리거 ± N초' },
  { value: 'mask', label: '조건이 참인 구간' },
];

const CALCS: { value: Calc['kind']; label: string }[] = [
  { value: 'delta', label: '끝값 − 시작값' },
  { value: 'integral', label: '적분' },
  { value: 'mean', label: '평균' },
  { value: 'rms', label: 'RMS' },
  { value: 'max', label: '최대' },
  { value: 'min', label: '최소' },
  { value: 'std', label: '표준편차' },
  { value: 'duration', label: '구간 길이 [s]' },
  { value: 'overshoot', label: '오버슛 [%]' },
  { value: 'settling', label: '정착 시간 [s]' },
  { value: 'rmse', label: '두 신호 RMSE' },
];

// 연속 구간에서만 의미가 있는 계산 (evaluate.ts와 같은 제약)
const CONTIGUOUS_ONLY: Calc['kind'][] = ['overshoot', 'settling'];

function defaultWindow(kind: Window['kind'], signal: string): Window {
  switch (kind) {
    case 'around': return { kind, beforeSec: 1, afterSec: 1 };
    case 'mask': return { kind, signal, op: '>=', threshold: 0 };
    default: return { kind };
  }
}

function makeCalc(kind: Calc['kind'], prev: Calc): Calc {
  const signal = prev.signal;
  if (kind === 'settling') return { kind, signal, tolPct: 2 };
  if (kind === 'rmse') return { kind, signal, ref: prev.kind === 'rmse' ? prev.ref : signal };
  return { kind, signal };
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Text className="fmuc-label">{label}</Text>
      {children}
    </Stack>
  );
}

export function BuilderPanel({ spec, onChange, groups, paramNames, defaultSignal }: {
  spec: BuilderSpec;
  onChange: (s: BuilderSpec) => void;
  /** 신호 Select 목록 (기록 컬럼, 파생 신호, FMU 변수) */
  groups: SignalGroups;
  /** "파라미터" 토글에서 고를 run 파라미터 이름 */
  paramNames: string[];
  /** 새 트리거·구간에 넣을 신호 */
  defaultSignal: string;
}) {
  const set = (patch: Partial<BuilderSpec>) => onChange({ ...spec, ...patch });
  const nTrig = windowTriggerCount(spec.window);

  const setWindowKind = (kind: Window['kind']) => {
    const window = defaultWindow(kind, defaultSignal);
    const n = windowTriggerCount(window);
    const triggers = spec.triggers.slice(0, n);
    while (triggers.length < n) triggers.push(defaultTrigger('cross', defaultSignal));
    // mask 구간은 여러 조각이라 오버슛/정착시간을 쓸 수 없다
    const calc = kind === 'mask' && CONTIGUOUS_ONLY.includes(spec.calc.kind)
      ? { kind: 'delta' as const, signal: spec.calc.signal } : spec.calc;
    onChange({ ...spec, window, triggers, calc });
  };

  const setDerived = (i: number, patch: Partial<BuilderSpec['derived'][number]>) =>
    set({ derived: spec.derived.map((d, k) => (k === i ? { ...d, ...patch } : d)) });

  return (
    <Stack gap="lg">
      <Section label="파생 신호">
        {spec.derived.length === 0 && <Text size="sm" c="dimmed">없음 — 수식으로 새 신호를 만들 수 있습니다 (예: v*3.6)</Text>}
        {spec.derived.map((d, i) => {
          let exprError: string | null = null;
          try { parseExpr(d.expr); } catch (e) { exprError = (e as Error).message; }
          return (
            <Group key={i} align="flex-start" wrap="nowrap">
              <TextInput label={`파생 신호 ${i + 1} 이름`} value={d.name} w={140}
                onChange={e => setDerived(i, { name: e.currentTarget.value })} />
              <TextInput label={`파생 신호 ${i + 1} 수식`} value={d.expr} style={{ flex: 1 }} error={exprError}
                ff="monospace" onChange={e => setDerived(i, { expr: e.currentTarget.value })} />
              <ActionIcon mt={26} variant="subtle" color="red" aria-label={`파생 신호 ${i + 1} 삭제`}
                onClick={() => set({ derived: spec.derived.filter((_, k) => k !== i) })}>×</ActionIcon>
            </Group>
          );
        })}
        <Group>
          <Button variant="light" size="xs"
            onClick={() => set({ derived: [...spec.derived, { name: `d${spec.derived.length + 1}`, expr: defaultSignal }] })}>
            파생 신호 추가
          </Button>
        </Group>
      </Section>

      <Section label="트리거">
        {nTrig === 0 && <Text size="sm" c="dimmed">이 구간에는 트리거가 필요 없습니다</Text>}
        {spec.triggers.slice(0, nTrig).map((t, i) => (
          <TriggerFields key={i} index={i} value={t} groups={groups} paramNames={paramNames} defaultSignal={defaultSignal}
            onChange={nt => set({ triggers: spec.triggers.map((x, k) => (k === i ? nt : x)) })} />
        ))}
      </Section>

      <Section label="구간">
        <Select label="구간 종류" data={WINDOWS} value={spec.window.kind} allowDeselect={false}
          onChange={k => k && k !== spec.window.kind && setWindowKind(k as Window['kind'])} />
        {spec.window.kind === 'around' && (() => {
          const w = spec.window;
          return (
            <Group grow align="flex-start">
              <NumField label="앞 [s]" value={w.beforeSec} paramNames={paramNames} onChange={beforeSec => set({ window: { ...w, beforeSec } })} />
              <NumField label="뒤 [s]" value={w.afterSec} paramNames={paramNames} onChange={afterSec => set({ window: { ...w, afterSec } })} />
            </Group>
          );
        })()}
        {spec.window.kind === 'mask' && (() => {
          const w = spec.window;
          return (
            <>
              <SignalSelect label="구간 신호" value={w.signal} groups={groups} onChange={signal => set({ window: { ...w, signal } })} />
              <Group align="flex-end" wrap="nowrap">
                <OpSelect label="구간 비교" value={w.op} onChange={op => set({ window: { ...w, op } })} />
                <div style={{ flex: 1 }}>
                  <NumField label="구간 임계값" value={w.threshold} paramNames={paramNames} onChange={threshold => set({ window: { ...w, threshold } })} />
                </div>
              </Group>
            </>
          );
        })()}
      </Section>

      <Section label="계산">
        <Select
          label="계산 종류" allowDeselect={false} value={spec.calc.kind}
          data={CALCS.map(c => ({ ...c, disabled: spec.window.kind === 'mask' && CONTIGUOUS_ONLY.includes(c.value) }))}
          onChange={k => k && k !== spec.calc.kind && set({ calc: makeCalc(k as Calc['kind'], spec.calc) })}
        />
        <SignalSelect label="계산 신호" value={spec.calc.signal} groups={groups}
          onChange={signal => set({ calc: { ...spec.calc, signal } })} />
        {spec.calc.kind === 'settling' && (() => {
          const c = spec.calc;
          return <NumField label="허용 오차 [%]" value={c.tolPct} paramNames={paramNames} onChange={tolPct => set({ calc: { ...c, tolPct } })} />;
        })()}
        {spec.calc.kind === 'rmse' && (() => {
          const c = spec.calc;
          return <SignalSelect label="기준 신호" value={c.ref} groups={groups} onChange={ref => set({ calc: { ...c, ref } })} />;
        })()}
      </Section>

      <Section label="후처리">
        <Group>
          <Checkbox label="절댓값" checked={spec.post.abs} onChange={e => set({ post: { ...spec.post, abs: e.currentTarget.checked } })} />
          <Checkbox label="부호 반전" checked={spec.post.negate} onChange={e => set({ post: { ...spec.post, negate: e.currentTarget.checked } })} />
        </Group>
        <NumField label="배율" value={spec.post.scale} paramNames={paramNames} onChange={scale => set({ post: { ...spec.post, scale } })} />
      </Section>
    </Stack>
  );
}
