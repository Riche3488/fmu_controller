import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID } from '../api/mock/mockClient';

const ROUTE = `/fmus/${MOCK_FMU_ID}/batch`;

async function addParam(name: string) {
  await userEvent.click(await screen.findByRole('radio', { name }));
  await screen.findByLabelText(`${name} 값`);
}

async function setValues(name: string, text: string) {
  const input = screen.getByLabelText(`${name} 값`);
  await userEvent.clear(input);
  await userEvent.click(input);
  await userEvent.paste(text);
}

const seq = (n: number) => Array.from({ length: n }, (_, i) => i + 1).join(',');

describe('BatchSetupPage', () => {
  test('shows total case count for grid sweep', async () => {
    renderApp({ route: ROUTE });
    await addParam('road.stopTable[1,1]');
    await addParam('road.stopTable[1,2]');
    await setValues('road.stopTable[1,1]', '1,2,3');
    await setValues('road.stopTable[1,2]', '1,2,3,4');
    expect(await screen.findByText('총 12 케이스')).toBeInTheDocument();
  });

  test('submit is disabled without sweep parameters', async () => {
    renderApp({ route: ROUTE });
    expect(await screen.findByRole('button', { name: '배치 실행' })).toBeDisabled();
  });

  test('explains that objectives are computed at query time', async () => {
    renderApp({ route: ROUTE });
    expect(await screen.findByText('목적함수 값은 결과 조회 시 최신 코드로 계산됩니다')).toBeInTheDocument();
  });

  test('submits contract-shaped request with defaults and navigates to job', async () => {
    const client = createMockClient({ tickMs: 10 });
    const spy = vi.spyOn(client, 'createBatch');
    renderApp({ route: ROUTE, client });
    await addParam('road.stopTable[1,1]');
    await setValues('road.stopTable[1,1]', '40,45,50');
    await waitFor(() => expect(screen.getByRole('button', { name: '배치 실행' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: '배치 실행' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const req = spy.mock.calls[0][0];
    expect(req.fmuId).toBe(MOCK_FMU_ID);
    expect(req.params).toEqual([{ name: 'road.stopTable[1,1]', mode: 'list', values: [40, 45, 50] }]);
    expect(req.sampling).toBe('grid');
    expect(req.sim).toEqual({ startTime: 0, stopTime: 1400, tolerance: 1e-4, outputInterval: 1 });
    expect(req.recordVariables).toHaveLength(140);
    expect(req.recordVariables).toContain('controlBus.chassisBus.longitudinalVelocity');
    expect(req.runTimeoutSec).toBe(600);
    expect(req.workers).toBeGreaterThanOrEqual(1);
    expect(await screen.findByRole('heading', { level: 2, name: '잡 모니터' })).toBeInTheDocument();
  });

  test('asks for confirmation above 1000 cases', async () => {
    const client = createMockClient({ tickMs: 10 });
    const spy = vi.spyOn(client, 'createBatch');
    renderApp({ route: ROUTE, client });
    await addParam('road.stopTable[1,1]');
    await addParam('road.stopTable[1,2]');
    await setValues('road.stopTable[1,1]', seq(40));
    await setValues('road.stopTable[1,2]', seq(30));
    expect(await screen.findByText('총 1200 케이스')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '배치 실행' }));
    expect(await screen.findByText('케이스가 많습니다 (1200개). 계속하시겠습니까?')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '계속' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  test('zip with unequal lengths shows error and disables submit', async () => {
    renderApp({ route: ROUTE });
    await addParam('road.stopTable[1,1]');
    await addParam('road.stopTable[1,2]');
    await setValues('road.stopTable[1,1]', '1,2');
    await setValues('road.stopTable[1,2]', '1,2,3');
    await userEvent.click(screen.getByRole('radio', { name: 'zip' }));
    expect(await screen.findByText('zip 방식은 모든 파라미터의 값 개수가 같아야 합니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '배치 실행' })).toBeDisabled();
  });
});
