// 배치/최적화 공통 실행 설정: 시뮬레이션 설정, 기록 변수, 고정 파라미터, 병렬 수, 타임아웃
import { Accordion, Group, MultiSelect, NumberInput, Stack, Text, Textarea } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../api/client';
import type { FmuSummary, ParamValue, SimSettings } from '../api/types';
import { defaultSimSettings, SimSettingsForm } from './SimSettingsForm';
import { VariablePicker } from './VariablePicker';

export const DEFAULT_RUN_TIMEOUT_SEC = 600;

export type RunSettings = {
  sim: SimSettings;
  recordVariables: string[];
  fixedParams: Record<string, ParamValue>;
  workers: number;
  runTimeoutSec: number;
};

export function defaultWorkers(): number {
  return Math.max(1, (navigator.hardwareConcurrency || 2) - 1);
}

/** "이름=값" 줄 단위 → 고정 파라미터. 잘못된 줄이 있으면 에러 메시지. */
export function parseFixedParams(text: string): { params: Record<string, ParamValue>; error: string | null } {
  const params: Record<string, ParamValue> = {};
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.lastIndexOf('=');
    const name = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (eq < 1 || !v) return { params, error: `${i + 1}번째 줄: "이름=값" 형식이어야 합니다` };
    if (v === 'true' || v === 'false') params[name] = v === 'true';
    else if (Number.isFinite(Number(v))) params[name] = Number(v);
    else return { params, error: `${i + 1}번째 줄: 값은 숫자 또는 true/false여야 합니다` };
  }
  return { params, error: null };
}

export function formatFixedParams(params: Record<string, ParamValue>): string {
  return Object.entries(params).map(([k, v]) => `${k}=${v}`).join('\n');
}

export function defaultRunSettings(fmu: FmuSummary, outputNames: string[]): RunSettings {
  return {
    sim: defaultSimSettings(fmu.defaultExperiment),
    recordVariables: outputNames,
    fixedParams: {},
    workers: defaultWorkers(),
    runTimeoutSec: DEFAULT_RUN_TIMEOUT_SEC,
  };
}

/** FMU의 출력 변수 이름 전체 */
export function useOutputNames(fmuId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['variables', fmuId, 'output', 'all-names'],
    queryFn: () => api.listVariables(fmuId!, { causality: 'output', offset: 0, limit: 100000 }),
    enabled: !!fmuId,
    select: page => page.items.map(v => v.name),
  });
}

/** FMU 기본값(DefaultExperiment, 출력 전체 기록)으로 초기화된 실행 설정 상태 */
export function useRunSettings(fmu: FmuSummary | undefined) {
  const [settings, setSettings] = useState<RunSettings | null>(null);
  const outputs = useOutputNames(fmu?.id);
  useEffect(() => {
    if (fmu && outputs.data && !settings) setSettings(defaultRunSettings(fmu, outputs.data));
  }, [fmu, outputs.data, settings]);
  return [settings, setSettings] as const;
}

export function RunSettingsSection({ fmuId, value, onChange, onFixedError }: {
  fmuId: string;
  value: RunSettings;
  onChange: (v: RunSettings) => void;
  onFixedError: (e: string | null) => void;
}) {
  // 프리셋을 불러오면 부모가 key를 바꿔 다시 마운트하므로 처음 값만 글로 옮기면 된다
  const [fixedText, setFixedText] = useState(() => formatFixedParams(value.fixedParams));
  const [fixedError, setFixedError] = useState<string | null>(null);
  const set = <K extends keyof RunSettings>(k: K, v: RunSettings[K]) => onChange({ ...value, [k]: v });

  return (
    <Stack>
      <SimSettingsForm value={value.sim} onChange={sim => set('sim', sim)} />
      <Group grow>
        <NumberInput label="병렬 작업 수" min={1} value={value.workers} onChange={v => set('workers', Math.max(1, Number(v) || 1))} />
        <NumberInput label="run 타임아웃 [s]" min={1} value={value.runTimeoutSec} onChange={v => set('runTimeoutSec', Math.max(1, Number(v) || 1))} />
      </Group>
      <Accordion variant="contained">
        <Accordion.Item value="record">
          <Accordion.Control>기록 변수 ({value.recordVariables.length}개)</Accordion.Control>
          <Accordion.Panel>
            <Text size="xs" c="dimmed" mb="xs">목적함수가 참조하는 변수는 반드시 기록해야 합니다. 기본값은 FMU의 출력 변수 전체입니다.</Text>
            <VariablePicker fmuId={fmuId} causality="all" mode="multi" value={value.recordVariables}
              onChange={names => set('recordVariables', names)} />
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="fixed">
          <Accordion.Control>고정 파라미터 ({Object.keys(value.fixedParams).length}개)</Accordion.Control>
          <Accordion.Panel>
            <Textarea label="이름=값 (줄 단위)" autosize minRows={3} value={fixedText} error={fixedError}
              placeholder="vehicle.body.mass.m=1300"
              onChange={e => {
                const text = e.currentTarget.value;
                setFixedText(text);
                const parsed = parseFixedParams(text);
                setFixedError(parsed.error);
                onFixedError(parsed.error);
                if (!parsed.error) set('fixedParams', parsed.params);
              }} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

/** 잡 모니터 시계열에 처음 띄울 변수 (기록 변수 중에서만) */
export function PlotVariablesSelect({ recordVariables, value, onChange }: {
  recordVariables: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <MultiSelect mt="md" label="잡 모니터에 표시할 변수" searchable clearable limit={200}
      description="잡 모니터의 시계열 차트에 처음 띄울 변수입니다 (기록 변수 중에서). 비우면 첫 번째 기록 변수를 띄웁니다."
      placeholder="변수 선택" data={recordVariables}
      value={value.filter(v => recordVariables.includes(v))} onChange={onChange}
      comboboxProps={{ transitionProps: { duration: 0 } }} />
  );
}
