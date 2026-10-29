import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith } from '../test/render';
import { createMockClient, MOCK_FMU_ID, MOCK_NEDC_PATH, MOCK_TIR_PATH } from '../api/mock/mockClient';
import { ResourcesPanel } from './ResourcesPanel';

function setup() {
  const client = createMockClient();
  renderWith(<ResourcesPanel fmuId={MOCK_FMU_ID} />, { client });
  return client;
}

async function expand(path: string) {
  await userEvent.click(await screen.findByRole('button', { name: path }));
  return screen.findByTestId(`candidates-${path}`);
}

describe('ResourcesPanel', () => {
  test('lists resource files and expands candidates', async () => {
    setup();
    expect(await screen.findByRole('button', { name: MOCK_NEDC_PATH })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: MOCK_TIR_PATH })).toBeInTheDocument();
    const list = await expand(MOCK_NEDC_PATH);
    expect(within(list).getAllByTestId('candidate-row')).toHaveLength(1);
    expect(within(list).getByText('원본')).toBeInTheDocument();
  });

  test('uploads a candidate and shows it in the list', async () => {
    setup();
    const list = await expand(MOCK_NEDC_PATH);
    await userEvent.upload(screen.getByTestId(`upload-${MOCK_NEDC_PATH}`), new File(['x0.8'], 'nedc_x0.8.mat'));
    await waitFor(() => expect(within(list).getAllByTestId('candidate-row')).toHaveLength(2));
    expect(within(list).getByText('nedc_x0.8.mat')).toBeInTheDocument();
  });

  test('shows existing notice when identical content is uploaded', async () => {
    setup();
    await expand(MOCK_TIR_PATH);
    const input = screen.getByTestId(`upload-${MOCK_TIR_PATH}`);
    await userEvent.upload(input, new File(['[TYRE] B'], 'tireB.tir'));
    await screen.findByText('tireB.tir');
    await userEvent.upload(input, new File(['[TYRE] B'], 'copy.tir'));
    expect(await screen.findByText('같은 내용의 후보가 이미 있습니다: tireB.tir')).toBeInTheDocument();
  });

  test('rejects a file with a different extension', async () => {
    setup();
    await expand(MOCK_TIR_PATH);
    await userEvent.upload(screen.getByTestId(`upload-${MOCK_TIR_PATH}`), new File(['a'], 'tire.txt'), { applyAccept: false });
    expect(await screen.findByText('원본과 같은 확장자(.tir)의 파일만 올릴 수 있습니다')).toBeInTheDocument();
  });

  test('previews text and mat candidates', async () => {
    setup();
    const tir = await expand(MOCK_TIR_PATH);
    await userEvent.click(within(tir).getByRole('button', { name: '미리보기' }));
    expect(await screen.findByText(/VERTICAL_STIFFNESS/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));

    const mat = await expand(MOCK_NEDC_PATH);
    await userEvent.click(within(mat).getByRole('button', { name: '미리보기' }));
    await userEvent.click(await screen.findByRole('button', { name: 'table' }));
    await waitFor(() => {
      const opt = JSON.parse(screen.getByTestId('mat-plot').getAttribute('data-option')!);
      expect(opt.series).toHaveLength(2);
    });
  });

  test('original candidate has no delete button; deleting a candidate removes it', async () => {
    setup();
    const list = await expand(MOCK_NEDC_PATH);
    expect(within(list).queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
    await userEvent.upload(screen.getByTestId(`upload-${MOCK_NEDC_PATH}`), new File(['d'], 'del.mat'));
    await within(list).findByText('del.mat');
    await userEvent.click(within(list).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(within(list).queryByText('del.mat')).not.toBeInTheDocument());
  });
});
