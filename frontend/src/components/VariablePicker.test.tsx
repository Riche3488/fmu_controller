import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderWith } from '../test/render';
import { createMockClient, MOCK_FMU_ID } from '../api/mock/mockClient';
import { VariablePicker } from './VariablePicker';

function Harness({ onChange }: { onChange: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <VariablePicker fmuId={MOCK_FMU_ID} causality="parameter" mode="multi" value={value}
      onChange={v => { setValue(v); onChange(v); }} />
  );
}

describe('VariablePicker', () => {
  test('search is debounced and passed as q', async () => {
    const client = createMockClient();
    const spy = vi.spyOn(client, 'listVariables');
    renderWith(<Harness onChange={() => {}} />, { client });
    await screen.findByText('road.stopTable[1,1]');
    await userEvent.type(screen.getByPlaceholderText('변수 이름 또는 설명 검색'), 'Cd');
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(MOCK_FMU_ID, expect.objectContaining({ q: 'Cd', offset: 0 })));
    expect(spy.mock.calls.some(c => c[1].q === 'C')).toBe(false);
  });

  test('next page requests offset=100', async () => {
    const client = createMockClient();
    const spy = vi.spyOn(client, 'listVariables');
    renderWith(<Harness onChange={() => {}} />, { client });
    await screen.findByText('road.stopTable[1,1]');
    await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(MOCK_FMU_ID, expect.objectContaining({ offset: 100, limit: 100 })));
  });

  test('multi mode accumulates checked names', async () => {
    const onChange = vi.fn();
    renderWith(<Harness onChange={onChange} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'road.stopTable[1,1]' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'road.stopTable[1,2]' }));
    expect(onChange).toHaveBeenLastCalledWith(['road.stopTable[1,1]', 'road.stopTable[1,2]']);
  });

  test('empty result shows message', async () => {
    renderWith(<Harness onChange={() => {}} />);
    await screen.findByText('road.stopTable[1,1]');
    await userEvent.type(screen.getByPlaceholderText('변수 이름 또는 설명 검색'), 'zzzzqqq');
    expect(await screen.findByText('일치하는 변수가 없습니다')).toBeInTheDocument();
  });
});
