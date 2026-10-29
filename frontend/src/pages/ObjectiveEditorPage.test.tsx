import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';
import { createMockClient } from '../api/mock/mockClient';
import { finishedBatch } from '../test/fixtures';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="코드" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

const CODE1 = 'def evaluate(r, p):\n    return 1.0';

async function setup() {
  const client = createMockClient({ tickMs: 5 });
  const a = await client.createObjective({ name: 'fuel', code: CODE1 });
  const b = await client.createObjective({ name: 'comfort', code: 'def evaluate(r, p):\n    return 2.0' });
  return { client, a, b };
}

async function replaceCode(text: string) {
  const editor = await screen.findByLabelText('코드');
  await userEvent.clear(editor);
  await userEvent.click(editor);
  await userEvent.paste(text);
}

describe('ObjectiveEditorPage', () => {
  test('selecting from list loads code and shows code hash', async () => {
    const { client, a } = await setup();
    renderApp({ route: '/objectives', client });
    await userEvent.click(await screen.findByRole('button', { name: 'fuel' }));
    expect(await screen.findByLabelText('코드')).toHaveValue(CODE1);
    expect(screen.getByText(a.codeHash.slice(0, 8))).toBeInTheDocument();
  });

  test('save calls updateObjective and the hash badge changes', async () => {
    const { client, a } = await setup();
    const spy = vi.spyOn(client, 'updateObjective');
    renderApp({ route: `/objectives/${a.id}`, client });
    await replaceCode('def evaluate(r, p):\n    return 5.0');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(a.id, { name: 'fuel', code: 'def evaluate(r, p):\n    return 5.0' }));
    const updated = await client.getObjective(a.id);
    expect(await screen.findByText(updated.codeHash.slice(0, 8))).toBeInTheDocument();
    expect(screen.queryByText(a.codeHash.slice(0, 8))).not.toBeInTheDocument();
    expect(screen.getByText('저장하면 모든 결과 화면의 이 목적함수 값이 새 코드로 다시 계산됩니다.')).toBeInTheDocument();
  });

  test('unsaved changes prompt before switching', async () => {
    const { client, a } = await setup();
    renderApp({ route: `/objectives/${a.id}`, client });
    await replaceCode('def evaluate(r, p):\n    return 9.0');
    await userEvent.click(screen.getByRole('button', { name: 'comfort' }));
    expect(await screen.findByText('저장하지 않은 변경 사항이 있습니다')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '버리고 이동' }));
    expect(await screen.findByLabelText('코드')).toHaveValue('def evaluate(r, p):\n    return 2.0');
  });

  test('test run evaluates unsaved code against a run and shows the value', async () => {
    const { client, a } = await setup();
    await finishedBatch(client);
    const spy = vi.spyOn(client, 'testObjective');
    renderApp({ route: `/objectives/${a.id}`, client });
    await replaceCode('def evaluate(r, p):\n    return 7.0');
    await userEvent.click(await screen.findByRole('textbox', { name: '테스트할 run' }));
    await userEvent.click((await screen.findAllByRole('option'))[0]);
    await userEvent.click(screen.getByRole('button', { name: '테스트 실행' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ code: 'def evaluate(r, p):\n    return 7.0' })));
    expect(await screen.findByTestId('test-value')).toHaveTextContent(/\d/);
    expect(screen.getByText('controlBus.chassisBus.longitudinalVelocity')).toBeInTheDocument();
  });

  test('test run error is shown verbatim', async () => {
    const { client, a } = await setup();
    await finishedBatch(client);
    renderApp({ route: `/objectives/${a.id}`, client });
    await replaceCode('x = 1');
    await userEvent.click(await screen.findByRole('textbox', { name: '테스트할 run' }));
    await userEvent.click((await screen.findAllByRole('option'))[0]);
    await userEvent.click(screen.getByRole('button', { name: '테스트 실행' }));
    expect(await screen.findByText('evaluate 함수가 정의되지 않았습니다')).toBeInTheDocument();
  });

  test('creating a duplicate name shows the server error', async () => {
    const { client } = await setup();
    renderApp({ route: '/objectives', client });
    await userEvent.click(await screen.findByRole('button', { name: '새 목적함수' }));
    await userEvent.type(await screen.findByLabelText('이름'), 'fuel');
    await userEvent.click(screen.getByRole('button', { name: '만들기' }));
    expect(await screen.findByText('같은 이름의 목적함수가 이미 있습니다')).toBeInTheDocument();
  });

  test('new objective with 빈 코드로 시작 uses the template', async () => {
    const { client } = await setup();
    renderApp({ route: '/objectives', client });
    await userEvent.click(await screen.findByRole('button', { name: '새 목적함수' }));
    await userEvent.type(await screen.findByLabelText('이름'), 'duration');
    await userEvent.click(screen.getByRole('button', { name: '빈 코드로 시작' }));
    await waitFor(async () => expect((await client.listObjectives()).map(o => o.name)).toContain('duration'));
    const editor = (await screen.findByLabelText('코드')) as HTMLTextAreaElement;
    expect(editor.value).toContain('def evaluate(result: pd.DataFrame, params: dict) -> float:');
  });

  test('new objective defaults to a builder: FMU select, designer, no TestPanel', async () => {
    const { client } = await setup();
    renderApp({ route: '/objectives', client });
    await userEvent.click(await screen.findByRole('button', { name: '새 목적함수' }));
    await userEvent.type(await screen.findByLabelText('이름'), 'built');
    await userEvent.click(screen.getByRole('button', { name: '만들기' }));
    await waitFor(async () => expect((await client.listObjectives()).map(o => o.name)).toContain('built'));
    expect(await screen.findByRole('textbox', { name: '미리보기·호환성 기준 FMU' })).toBeInTheDocument();
    expect(await screen.findByText('생성된 코드')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '테스트할 run' })).not.toBeInTheDocument();
  });
});
