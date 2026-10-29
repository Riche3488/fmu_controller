import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_FMU_ID as FMU_ID } from '../../api/mock/mockClient';
import { renderApp } from '../../test/render';

describe('작업 공간', () => {
  test('단계 바가 5단계를 보여 주고 현재 단계를 강조', async () => {
    renderApp({ route: `/fmus/${FMU_ID}/objectives` });
    const bar = await screen.findByRole('navigation', { name: '진행 단계' });
    expect(within(bar).getAllByRole('link')).toHaveLength(5);
    expect(within(bar).getByRole('link', { name: /③ 목적함수/ })).toHaveAttribute('aria-current', 'step');
  });

  test('옛 배치 주소는 실행 단계 배치 탭으로', async () => {
    renderApp({ route: `/fmus/${FMU_ID}/batch` });
    expect(await screen.findByRole('tab', { name: '배치 해석', selected: true })).toBeInTheDocument();
  });

  test('옛 최적화 주소는 실행 단계 최적화 탭으로', async () => {
    renderApp({ route: `/fmus/${FMU_ID}/optimize` });
    expect(await screen.findByRole('tab', { name: '최적화', selected: true })).toBeInTheDocument();
  });

  test('다음 버튼은 다음 단계로 이동', async () => {
    renderApp({ route: `/fmus/${FMU_ID}` });
    await userEvent.click(await screen.findByRole('link', { name: '다음: ② 변수·리소스' }));
    expect(await screen.findByRole('link', { name: /② 변수·리소스/ })).toHaveAttribute('aria-current', 'step');
  });

  test('완료 단계에는 완료 표시', async () => {
    renderApp({ route: `/fmus/${FMU_ID}` });
    const bar = await screen.findByRole('navigation', { name: '진행 단계' });
    expect(await within(bar).findAllByLabelText('완료')).not.toHaveLength(0);
  });
});
