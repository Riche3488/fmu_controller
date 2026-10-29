// 배치/최적화 공통 실행 설정: 시뮬레이션 설정, 기록 변수, 고정 파라미터, 병렬 수, 타임아웃
import { Accordion, Group, NumberInput, Stack, Text, Textarea } from '@mantine/core';
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

/** FMU 기본값(DefaultExperiment, 출력 전체 기록)으로 초기화된 실행 설정 상태 */
export function useRunSettings(fmu: FmuSummary | undefined) {
  const api = useApi();
  const [settings, setSettings] = useState<RunSettings | null>(null);
  const outputs = useQuery({
    queryKey: ['variables', fmu?.id, 'output', 'all-names'],
    queryFn: () => api.listVariables(fmu!.id, { causality: 'output', offset: 0, limit: 100000 }),
    enabled: !!fmu,
  });
  useEffect(() => {
    if (fmu && outputs.data && !settings) {
      setSettings({
        sim: defaultSimSettings(fmu.defaultExperiment),
        recordVariables: outputs.data.items.map(v => v.name),
        fixedParams: {},
        workers: defaultWorkers(),
        runTimeoutSec: DEFAULT_RUN_TIMEOUT_SEC,
      });
    }
  }, [fmu, outputs.data, settings]);
  return [settings, setSettings] as const;
}

export function RunSettingsSection({ fmuId, value, onChange, onFixedError }: {
  fmuId: string;
  value: RunSettings;
  onChange: (v: RunSettings) => void;
  onFixedError: (e: string | null) => void;
}) {
  const [fixedText, setFixedText] = useState('');
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
