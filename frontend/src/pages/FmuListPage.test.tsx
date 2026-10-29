import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient } from '../api/mock/mockClient';

// 사이드바에도 모델명이 나오므로 표 안에서만 찾는다
const inTable = async (text: string) => within(await screen.findByRole('table')).findByText(text);

describe('FmuListPage', () => {
  test('lists FMUs with model name, FMI types, parameter and run counts', async () => {
    renderApp({ route: '/fmus' });
    const row = (await inTable('my_test.DriveCycleAT')).closest('tr')!;
    expect(within(row).getByText('ModelExchange')).toBeInTheDocument();
    expect(within(row).getByText('2,867')).toBeInTheDocument();
    expect(within(row).getByText('0')).toBeInTheDocument();
  });

  test('uploading a .fmu calls uploadFmu and refreshes the list', async () => {
    const client = createMockClient();
    const spy = vi.spyOn(client, 'uploadFmu');
    renderApp({ route: '/fmus', client });
    await inTable('my_test.DriveCycleAT');
    const file = new File(['x'], 'second.fmu', { type: 'application/octet-stream' });
    await userEvent.upload(screen.getByTestId('fmu-upload-input'), file);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(file));
    expect(await screen.findByText('second.fmu')).toBeInTheDocument();
  });

  test('non-.fmu files are rejected', async () => {
    const client = createMockClient();
    const spy = vi.spyOn(client, 'uploadFmu');
    renderApp({ route: '/fmus', client });
    await inTable('my_test.DriveCycleAT');
    const file = new File(['x'], 'model.zip', { type: 'application/zip' });
    await userEvent.upload(screen.getByTestId('fmu-upload-input'), file, { applyAccept: false });
    expect(await screen.findByText('FMU 파일(.fmu)만 업로드할 수 있습니다')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  test('clicking a row opens the detail page', async () => {
    renderApp({ route: '/fmus' });
    await userEvent.click(await inTable('my_test.DriveCycleAT'));
    expect(await screen.findByRole('heading', { level: 2, name: 'my_test.DriveCycleAT' })).toBeInTheDocument();
    expect(screen.getByText('{d96e27c5-094f-41dc-b0b1-183535ae4553}')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '진행 단계' })).toBeInTheDocument();
  });
});
