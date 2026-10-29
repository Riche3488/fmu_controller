import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID } from '../api/mock/mockClient';

const ROUTE = `/fmus/${MOCK_FMU_ID}/optimize`;

async function setup() {
  const client = createMockClient({ tickMs: 5 });
  const a = await client.createObjective({ name: 'fuel', code: 'def evaluate(r, p):\n    return 1.0' });
  const b = await client.createObjective({ name: 'comfort', code: 'def evaluate(r, p):\n    return 2.0' });
  renderApp({ route: ROUTE, client });
  return { client, a, b };
}

async function addDesignVar(name: string) {
  await userEvent.click(await screen.findByRole('radio', { name }));
  await screen.findByLabelText(`${name} 최솟값`);
}

describe('OptimizationSetupPage', () => {
  test('design variable bounds default to start x0.5 / x1.5, or -1/1 when start is 0', async () => {
    await setup();
    await addDesignVar('road.stopTable[1,1]');
    expect(screen.getByLabelText('road.stopTable[1,1] 최솟값')).toHaveValue('22.5');
    expect(screen.getByLabelText('road.stopTable[1,1] 최댓값')).toHaveValue('67.5');
    await userEvent.type(screen.getAllByPlaceholderText('변수 이름 또는 설명 검색')[0], 'r0Cones');
    await addDesignVar('road.r0Cones[1,1]');
    expect(screen.getByLabelText('road.r0Cones[1,1] 최솟값')).toHaveValue('-1');
    expect(screen.getByLabelText('road.r0Cones[1,1] 최댓값')).toHaveValue('1');
  });

  test('min >= max shows error and disables submit', async () => {
    await setup();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    await addDesignVar('road.stopTable[1,1]');
    const min = screen.getByLabelText('road.stopTable[1,1] 최솟값');
    await userEvent.clear(min);
    await userEvent.type(min, '100');
    expect(await screen.findByText('최솟값은 최댓값보다 작아야 합니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '최적화 실행' })).toBeDisabled();
  });

  test('algorithm options depend on the number of objectives', async () => {
    await setup();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    expect(screen.getByRole('radio', { name: 'TPE' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'CMA-ES' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'NSGA-II' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'CMA-ES' }));

    await userEvent.click(screen.getByRole('checkbox', { name: 'comfort' }));
    expect(screen.getByRole('radio', { name: 'NSGA-II' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'CMA-ES' })).not.toBeInTheDocument();
    expect(screen.getByText('CMA-ES는 단일 목적만 지원합니다')).toBeInTheDocument();
  });

  test('submits multi-objective request with directions and navigates', async () => {
    const { client, a, b } = await setup();
    const spy = vi.spyOn(client, 'createOptimization');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'fuel' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'comfort' }));
    await userEvent.click(screen.getByRole('radio', { name: 'comfort 최대화' }));
    await addDesignVar('road.stopTable[1,1]');
    await waitFor(() => expect(screen.getByRole('button', { name: '최적화 실행' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: '최적화 실행' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const req = spy.mock.calls[0][0];
    expect(req.objectives).toEqual([
      { objectiveId: a.id, direction: 'minimize' },
      { objectiveId: b.id, direction: 'maximize' },
    ]);
    expect(req.algorithm).toBe('nsga2');
    expect(req.nTrials).toBe(50);
    expect(req.designVars).toEqual([{ name: 'road.stopTable[1,1]', min: 22.5, max: 67.5, kind: 'float' }]);
    expect(req.recordVariables).toHaveLength(140);
    expect(await screen.findByRole('heading', { level: 2, name: /잡 모니터/ })).toBeInTheDocument();
  });

  test('submit disabled without objectives', async () => {
    await setup();
    await addDesignVar('road.stopTable[1,1]');
    expect(screen.getByRole('button', { name: '최적화 실행' })).toBeDisabled();
  });
});
