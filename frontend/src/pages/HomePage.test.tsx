import { describe, expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../test/render';
import { createMockClient, MOCK_FMU_ID as FMU_ID } from '../api/mock/mockClient';
import { batchReq } from '../test/fixtures';

describe('HomePage', () => {
  test('FMU 카드에 다음 할 일 버튼', async () => {
    renderApp({ route: '/' });
    const card = await screen.findByTestId(`fmu-card-${FMU_ID}`);
    expect(await within(card).findByRole('link', { name: /변수·리소스 확인|목적함수 설계하기|배치\/최적화 실행|결과 분석/ })).toBeInTheDocument();
  });

  test('FMU가 없으면 시작 가이드와 업로드', async () => {
    renderApp({ route: '/', client: createMockClient({ tickMs: 10, empty: true }) });
    expect(await screen.findByText('시작하기')).toBeInTheDocument();
    expect(screen.getByText(/FMU 파일을 끌어다 놓거나/)).toBeInTheDocument();
  });

  test('실행 중인 잡 진행률', async () => {
    const client = createMockClient({ tickMs: 600000 });
    await client.createBatch(batchReq({ name: 'running-job' }));
    renderApp({ route: '/', client });
    expect(await screen.findByText('running-job')).toBeInTheDocument();
    expect(screen.getByText(/^\d+%$/)).toBeInTheDocument();
  });

  test('.fmu 업로드는 uploadFmu를 호출하고 카드가 늘어난다', async () => {
    const client = createMockClient({ tickMs: 10 });
    const spy = vi.spyOn(client, 'uploadFmu');
    renderApp({ route: '/', client });
    await screen.findByTestId(`fmu-card-${FMU_ID}`);
    const file = new File(['x'], 'second.fmu', { type: 'application/octet-stream' });
    await userEvent.upload(screen.getByTestId('fmu-upload-input'), file);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(file));
    await waitFor(() => expect(screen.getAllByTestId(/^fmu-card-/)).toHaveLength(2));
  });

  test('.fmu가 아닌 파일은 거부', async () => {
    const client = createMockClient({ tickMs: 10 });
    const spy = vi.spyOn(client, 'uploadFmu');
    renderApp({ route: '/', client });
    await screen.findByTestId(`fmu-card-${FMU_ID}`);
    const file = new File(['x'], 'model.zip', { type: 'application/zip' });
    await userEvent.upload(screen.getByTestId('fmu-upload-input'), file, { applyAccept: false });
    expect(await screen.findByText('FMU 파일(.fmu)만 업로드할 수 있습니다')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  test('/fmus는 홈으로 리다이렉트', async () => {
    renderApp({ route: '/fmus' });
    expect(await screen.findByText('WORKSPACE')).toBeInTheDocument();
  });
});
