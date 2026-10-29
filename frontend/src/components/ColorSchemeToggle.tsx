import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('dark');
  const next = scheme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? '라이트 모드' : '다크 모드';
  return (
    <ActionIcon variant="default" aria-label={label} title={label} onClick={() => setColorScheme(next)}>
      {next === 'light' ? '☀' : '☾'}
    </ActionIcon>
  );
}
