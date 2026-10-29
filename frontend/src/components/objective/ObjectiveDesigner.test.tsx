import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Providers } from '../../test/render';
import { finishedBatch } from '../../test/fixtures';
import { createMockClient, MOCK_FMU_ID } from '../../api/mock/mockClient';
import type { ApiClient } from '../../api/client';
import { DEFAULT_SPEC, type BuilderSpec } from '../../lib/builder/spec';
import { generateCode, HEADER_PREFIX } from '../../lib/builder/codegen';
import { ObjectiveDesigner } from './ObjectiveDesigner';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, options }: { value: string; onChange?: (v: string) => void; options?: { readOnly?: boolean } }) => (
    <textarea aria-label="코드" value={value} readOnly={options?.readOnly} onChange={e => onChange?.(e.target.value)} />
  ),
}));

// mock 시계열은 아무 이름이나 사인파로 돌려주므로 실제 FMU 출력 이름을 쓴다
const PEDAL = 'controlBus.driverBus.acceleratorPedalPosition';
const X = 'controlBus.chassisBus.longitudinalVelocity';
const LONG_SIM = { startTime: 0, stopTime: 1400, tolerance: 1e-4, outputInterval: 1 };

const EXAMPLE: BuilderSpec = {
  ...DEFAULT_SPEC,
  triggers: [{ kind: 'cross', signal: PEDAL, dir: 'up', threshold: 0.9, occurrence: 'first' }],
  window: { kind: 'fromTrigger' },
  calc: { kind: 'delta', signal: X },
};

function Harness({ code, onChange }: { code: string; onChange?: (v: { name: string; code: string }) => void }) {
  const [v, setV] = useState({ name: 't', code });
  return (
    <ObjectiveDesigner fmuId={MOCK_FMU_ID} value={v} onChange={next => { setV(next); onChange?.(next); }} />
  );
}

function renderDesigner(code: string, client: ApiClient, onChange?: (v: { name: string; code: string }) => void) {
  return render(
    <Providers client={client} route="/">
      <Harness code={code} onChange={onChange} />
    </Providers>,
  );
}

async function seededClient(recordVariables = [PEDAL, X]) {
  const client = createMockClient({ tickMs: 5 });
  await finishedBatch(client, { params: [{ name: 'p', mode: 'list', values: [0] }], sim: LONG_SIM, recordVariables });
  return client;
}

async function pick(label: string, option: string, search?: string) {
  const input = screen.getByRole('textbox', { name: label });
  await userEvent.click(input);
  if (search) {
    await userEvent.clear(input);
    await userEvent.type(input, search);
  }
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

async function setNumber(label: string, text: string) {
  const input = screen.getByRole('textbox', { name: label });
  await userEvent.clear(input);
  await userEvent.type(input, text);
}

describe('ObjectiveDesigner', () => {
  test('예시 목적함수를 빌더로 만들면 값과 코드가 나온다', async () => {
    const client = await seededClient();
    const onChange = vi.fn();
    renderDesigner(generateCode(DEFAULT_SPEC), client, onChange);
    // 기본 스펙(구간 길이)도 값이 나온다
    expect(await screen.findByTestId('builder-value')).toHaveTextContent('1400');

    await pick('구간 종류', '트리거 ~ 종료');
    await pick('트리거 1 신호', PEDAL, 'acceleratorPedal');
    await setNumber('트리거 1 임계값', '0.9');
    await pick('계산 종류', '끝값 − 시작값');
    await pick('계산 신호', X, 'longitudinalVelocity');

    const last = onChange.mock.calls.at(-1)![0];
    expect(last.name).toBe('t');
    expect(JSON.parse(last.code.split('\n')[0].slice(HEADER_PREFIX.length))).toEqual(EXAMPLE);
    await waitFor(() => expect(screen.getByTestId('builder-value').textContent).toMatch(/^-?\d/));
    expect(screen.queryByText('트리거 조건을 만족하는 시점이 없습니다')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '코드 펼치기' }));
    expect((screen.getByLabelText('코드') as HTMLTextAreaElement).value).toContain('# fmuc-builder:');
    // 미리보기 그래프: 신호 2개 subplot, 트리거 세로선
    const option = JSON.parse(screen.getByTestId('preview-charts').dataset.option!);
    expect(option.grid).toHaveLength(2);
    expect(option.series[0].markLine.data).toHaveLength(1);
  });

  test('트리거가 안 걸리는 임계값이면 오류 문구', async () => {
    const client = await seededClient();
    renderDesigner(generateCode(EXAMPLE), client);
    await screen.findByTestId('builder-value');
    await setNumber('트리거 1 임계값', '999');
    expect(await screen.findByText('트리거 조건을 만족하는 시점이 없습니다')).toBeInTheDocument();
    expect(screen.queryByTestId('builder-value')).not.toBeInTheDocument();
  });

  test('파생 신호 이름이 기록 컬럼과 겹치면 오류', async () => {
    const client = await seededClient([PEDAL, X, 'controlBus.engineBus.speed']);
    const spec: BuilderSpec = { ...EXAMPLE, derived: [{ name: 'controlBus.engineBus.speed', expr: `${X}*2` }] };
    renderDesigner(generateCode(spec), client);
    expect(await screen.findByText('파생 신호 이름이 컬럼과 겹칩니다: controlBus.engineBus.speed')).toBeInTheDocument();
  });

  test('손으로 고친 빌더 코드는 코드 모드로 열린다', async () => {
    const client = createMockClient({ tickMs: 5 });
    renderDesigner(generateCode(EXAMPLE) + '\n# x', client);
    expect(screen.getByRole('button', { name: '빌더로 되돌리기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '코드로 직접 편집' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '빌더로 되돌리기' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('직접 고친 코드가 사라집니다')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '되돌리기' }));
    expect(await screen.findByRole('button', { name: '코드로 직접 편집' })).toBeInTheDocument();
  });

  test('헤더 없는 코드도 코드 모드, 되돌리기 버튼 없음', () => {
    renderDesigner('def evaluate(result, params):\n    return 1.0\n', createMockClient({ tickMs: 5 }));
    expect(screen.queryByRole('button', { name: '빌더로 되돌리기' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('코드')).not.toHaveAttribute('readonly');
  });

  test('run이 없으면 시험 실행 버튼', async () => {
    const client = createMockClient({ tickMs: 5 });
    const spy = vi.spyOn(client, 'createBatch');
    renderDesigner(generateCode(EXAMPLE), client);
    const btn = await screen.findByRole('button', { name: '기본값으로 시험 실행' });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const req = spy.mock.calls[0][0];
    expect(req.recordVariables).toEqual([PEDAL, X]);
    expect(req.params).toEqual([{ name: 'road.stopTable[1,1]', mode: 'list', values: [45] }]);
    expect(req.sampling).toBe('grid');
    expect(req.nSamples).toBeNull();
    expect(req.fixedParams).toEqual({});
    expect(req.sim).toEqual({ startTime: 0, stopTime: 1400, tolerance: 1e-4, outputInterval: 1 });
    expect(req.plotVariables).toEqual([]);
    expect(req.workers).toBe(1);
    expect(req.runTimeoutSec).toBe(600);
    expect(req.name).toMatch(/^시험 실행 \d\d:\d\d:\d\d$/);
    // 끝나면 그 run이 미리보기 run이 되어 값이 나온다
    expect(await screen.findByTestId('builder-value', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  test('호환성 박스: 누락 컬럼과 ④ 링크', async () => {
    const client = await seededClient([PEDAL]);
    renderDesigner(generateCode(EXAMPLE), client);
    expect(await screen.findByText('이 FMU 잡 1개 중 0개 호환')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '④ 실행에서 기록 변수에 추가' });
    expect(link).toHaveAttribute('href', `/fmus/${MOCK_FMU_ID}/run?tab=batch&record=${encodeURIComponent(X)}`);
  });

  test('잡이 없으면 FMU 변수 기준으로 기록 가능 여부', async () => {
    const spec: BuilderSpec = { ...EXAMPLE, calc: { kind: 'delta', signal: 'nope' } };
    renderDesigner(generateCode(spec), createMockClient({ tickMs: 5 }));
    expect(await screen.findByText('FMU에 없는 변수: nope')).toBeInTheDocument();
  });

  test('일괄 적용은 값 히스토그램을 그린다', async () => {
    const client = await seededClient();
    renderDesigner(generateCode(EXAMPLE), client);
    await userEvent.click(await screen.findByRole('button', { name: '여러 run에 일괄 적용' }));
    expect(await screen.findByTestId('batch-histogram')).toBeInTheDocument();
    expect(screen.getByText(/1개 run 중/)).toBeInTheDocument();
  });
});
