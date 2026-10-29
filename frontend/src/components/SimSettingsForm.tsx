import { NumberInput, SimpleGrid } from '@mantine/core';
import type { FmuSummary, SimSettings } from '../api/types';

export function defaultSimSettings(exp: FmuSummary['defaultExperiment']): SimSettings {
  return { startTime: exp.startTime, stopTime: exp.stopTime, tolerance: exp.tolerance ?? 1e-4, outputInterval: 1.0 };
}

export function SimSettingsForm({ value, onChange }: { value: SimSettings; onChange: (v: SimSettings) => void }) {
  const set = (k: keyof SimSettings) => (v: string | number) => onChange({ ...value, [k]: Number(v) });
  return (
    <SimpleGrid cols={{ base: 2, md: 4 }}>
      <NumberInput label="시작 시간 [s]" value={value.startTime} onChange={set('startTime')} />
      <NumberInput label="종료 시간 [s]" value={value.stopTime} onChange={set('stopTime')} min={0} />
      <NumberInput label="허용 오차" value={value.tolerance} onChange={set('tolerance')} decimalScale={10} min={0} />
      <NumberInput label="출력 간격 [s]" value={value.outputInterval} onChange={set('outputInterval')} decimalScale={6} min={0} />
    </SimpleGrid>
  );
}
