import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { theme } from './theme';
import { ColorSchemeToggle } from './components/ColorSchemeToggle';
import { renderWith } from './test/render';

describe('theme', () => {
  test('기본 색 스킴은 다크, primary는 cyan', () => {
    expect(theme.primaryColor).toBe('cyan');
    expect(theme.fontFamilyMonospace).toContain('IBM Plex Mono');
  });
  test('토글을 누르면 라이트로 바뀐다', async () => {
    renderWith(<ColorSchemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: '라이트 모드' }));
    expect(screen.getByRole('button', { name: '다크 모드' })).toBeInTheDocument();
  });
});
