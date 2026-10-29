import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './test/render';

describe('App shell', () => {
  test.each([
    ['홈', 'WORKSPACE'],
    ['목적함수 라이브러리', '목적함수'],
    ['잡 전체', '잡 목록'],
  ])('nav "%s" opens page "%s"', async (nav, title) => {
    renderApp({ route: '/fmus' });
    await userEvent.click(screen.getByRole('link', { name: nav }));
    expect(await (title === 'WORKSPACE' ? screen.findByText(title) : screen.findByRole('heading', { level: 2, name: title }))).toBeInTheDocument();
  });

  test('root shows the home dashboard', async () => {
    renderApp({ route: '/' });
    expect(await screen.findByText('WORKSPACE')).toBeInTheDocument();
  });

  test('header shows parallel backend', async () => {
    renderApp({ route: '/fmus' });
    expect(await screen.findByText('병렬: ray')).toBeInTheDocument();
  });
});
