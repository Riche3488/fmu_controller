import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient } from '../api/mock/mockClient';

describe('FmuListPage', () => {
  test('lists FMUs with model name, FMI types, parameter and run counts', async () => {
    renderApp({ route: '/fmus' });
    const row = (await screen.findByText('my_test.DriveCycleAT')).closest('tr')!;
    expect(within(row).getByText('ModelExchange')).toBeInTheDocument();
    expect(within(row).getByText('2,867')).toBeInTheDocument();
    expect(within(row).getByText('0')).toBeInTheDocument();
  });

  test('uploading a .fmu calls uploadFmu and refreshes the list', async () => {
    const client = createMockClient();
    const spy = vi.spyOn(client, 'uploadFmu');
    renderApp({ route: '/fmus', client });
    await screen.findByText('my_test.DriveCycleAT');
    const file = new File(['x'], 'second.fmu', { type: 'application/octet-stream' });
    await userEvent.upload(screen.getByTestId('fmu-upload-input'), file);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(file));
    expect(await screen.findByText('second.fmu')).toBeInTheDocument();
  });

  test('non-.fmu files are rejected', async () => {
    const client = createMockClient();
    const spy = vi.spyOn(client, 'uploadFmu');
    renderApp({ route: '/fmus', client });
    await screen.findByText('my_test.DriveCycleAT');
    const file = new File(['x'], 'model.zip', { type: 'application/zip' });
    await userEvent.upload(screen.getByTestId('fmu-upload-input'), file, { applyAccept: false });
    expect(await screen.findByText('FMU 파일(.fmu)만 업로드할 수 있습니다')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  test('clicking a row opens the detail page', async () => {
    renderApp({ route: '/fmus' });
    await userEvent.click(await screen.findByText('my_test.DriveCycleAT'));
    expect(await screen.findByRole('heading', { level: 2, name: 'my_test.DriveCycleAT' })).toBeInTheDocument();
    expect(screen.getByText('{d96e27c5-094f-41dc-b0b1-183535ae4553}')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '배치 해석' })).toHaveAttribute('href', '/fmus/a1b2c3d4e5f60718/batch');
  });
});
