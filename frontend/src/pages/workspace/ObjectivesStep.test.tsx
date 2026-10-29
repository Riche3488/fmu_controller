import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockClient, MOCK_FMU_ID as FMU_ID } from '../../api/mock/mockClient';
import { renderApp } from '../../test/render';
import { finishedBatch } from '../../test/fixtures';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="코드" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

const COL = 'controlBus.chassisBus.longitudinalVelocity';
const GOOD = `def evaluate(result, params):\n    return result['${COL}'].max()`;
const BAD = "def evaluate(result, params):\n    return result['no.such'].max()";

describe('ObjectivesStep', () => {
  test('호환 배지: 잡 기준 M/N 잡', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createObjective({ name: 'good', code: GOOD });
    await client.createObjective({ name: 'bad', code: BAD });
    await finishedBatch(client);
    renderApp({ route: `/fmus/${FMU_ID}/objectives`, client });
    const good = (await screen.findByText('good')).closest('tr')!;
    const bad = screen.getByText('bad').closest('tr')!;
    expect(await within(good).findByText('1/1 잡')).toBeInTheDocument();
    expect(within(bad).getByText('0/1 잡')).toBeInTheDocument();
    expect(within(good).getByText('코드')).toBeInTheDocument();
  });

  test('잡이 없으면 기록 가능/비호환', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createObjective({ name: 'good', code: GOOD });
    await client.createObjective({ name: 'bad', code: BAD });
    renderApp({ route: `/fmus/${FMU_ID}/objectives`, client });
    const good = (await screen.findByText('good')).closest('tr')!;
    expect(await within(good).findByText('기록 가능')).toBeInTheDocument();
    expect(within(screen.getByText('bad').closest('tr')!).getByText('비호환')).toBeInTheDocument();
  });

  test('새로 설계 → 저장 → 목록에 나타남 (작업 공간 안에 머무름)', async () => {
    const client = createMockClient({ tickMs: 5 });
    const spy = vi.spyOn(client, 'createObjective');
    renderApp({ route: `/fmus/${FMU_ID}/objectives`, client });
    await userEvent.click(await screen.findByRole('button', { name: '새로 설계' }));
    await userEvent.type(await screen.findByLabelText('목적함수 이름'), 'dur');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'dur' })));
    expect(spy.mock.calls[0][0].code).toContain('fmuc-builder');
    expect(await screen.findByRole('navigation', { name: '진행 단계' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '목록으로' }));
    expect(await screen.findByText('dur')).toBeInTheDocument();
  });

  test('행 클릭으로 수정 화면, 수정 후 이동하면 확인', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createObjective({ name: 'good', code: GOOD });
    renderApp({ route: `/fmus/${FMU_ID}/objectives`, client });
    await userEvent.click(await screen.findByText('good'));
    const name = await screen.findByLabelText('목적함수 이름');
    expect(screen.getByText('저장하면 모든 결과 화면의 이 목적함수 값이 새 코드로 다시 계산됩니다.')).toBeInTheDocument();
    await userEvent.type(name, 'x');
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(await screen.findByText('저장하지 않은 변경 사항이 있습니다')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '버리고 이동' }));
    expect(await screen.findByRole('button', { name: '새로 설계' })).toBeInTheDocument();
  });
});
