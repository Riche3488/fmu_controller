import { createTheme, type CSSVariablesResolver, type MantineThemeOverride } from '@mantine/core';
import { useComputedColorScheme } from '@mantine/core';
import * as echarts from 'echarts';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './theme.css';

export const theme: MantineThemeOverride = createTheme({
  primaryColor: 'cyan',
  fontFamily: 'IBM Plex Sans KR, sans-serif',
  fontFamilyMonospace: 'IBM Plex Mono, monospace',
  defaultRadius: 'xs',
  components: {
    Button: { defaultProps: { size: 'sm' } },
    TextInput: { defaultProps: { size: 'sm' } },
    Select: { defaultProps: { size: 'sm' } },
    NumberInput: { defaultProps: { size: 'sm' } },
    MultiSelect: { defaultProps: { size: 'sm' } },
    Card: { defaultProps: { withBorder: true } },
    Table: { defaultProps: { verticalSpacing: 'xs' } },
  },
});

const DARK = { bg: '#0f1419', panel: '#161b22', border: '#30363d', text: '#c9d1d9', muted: '#8b949e' };
const LIGHT = { text: '#24292f', muted: '#57606a', border: '#d0d7de' };

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--fmuc-panel': '#ffffff',
    '--fmuc-border': LIGHT.border,
  },
  dark: {
    '--mantine-color-body': DARK.bg,
    '--fmuc-panel': DARK.panel,
    '--fmuc-border': DARK.border,
  },
});

// 시안으로 시작하는 시리즈 팔레트 10색
const PALETTE = ['#22b8cf', '#fab005', '#51cf66', '#ff6b6b', '#845ef7', '#ff922b', '#339af0', '#f06595', '#94d82d', '#ced4da'];

function chartTheme(c: { text: string; muted: string; border: string }) {
  const axis = {
    axisLine: { lineStyle: { color: c.border } },
    axisTick: { lineStyle: { color: c.border } },
    axisLabel: { color: c.muted },
    nameTextStyle: { color: c.muted },
    splitLine: { lineStyle: { color: c.border, opacity: 0.6 } },
  };
  return {
    color: PALETTE,
    backgroundColor: 'transparent',
    textStyle: { color: c.text, fontFamily: 'IBM Plex Sans KR, sans-serif' },
    title: { textStyle: { color: c.text } },
    legend: { textStyle: { color: c.muted } },
    categoryAxis: axis,
    valueAxis: axis,
    logAxis: axis,
    timeAxis: axis,
  };
}

export function registerEchartsThemes(): void {
  echarts.registerTheme('fmuc-dark', chartTheme(DARK));
  echarts.registerTheme('fmuc-light', chartTheme(LIGHT));
}

export function useEchartsTheme(): 'fmuc-dark' | 'fmuc-light' {
  return useComputedColorScheme('dark') === 'dark' ? 'fmuc-dark' : 'fmuc-light';
}
