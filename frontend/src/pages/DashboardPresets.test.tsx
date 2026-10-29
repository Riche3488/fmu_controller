import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../test/render';
import { createMockClient } from '../api/mock/mockClient';

describe('dashboard presets', () => {
  test('mock client creates and lists by kind', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createPreset({ name: 'wb', kind: 'dashboard', sourceFmuId: null, config: { layout: '2x2', syncTimeZoom: true, panels: [{}, {}] } });
    expect((await client.listPresets({ kind: 'dashboard' })).map(p => p.name)).toEqual(['wb']);
    expect(await client.listPresets({ kind: 'batch' })).toEqual([]);
  });

  test('presets page shows the dashboard tab and rows', async () => {
    const client = createMockClient({ tickMs: 5 });
    await client.createPreset({ name: 'wb', kind: 'dashboard', sourceFmuId: null, config: { layout: '3x2', syncTimeZoom: true, panels: [{}] } });
    renderApp({ route: '/presets?kind=dashboard', client });
    expect(await screen.findByRole('tab', { name: '대시보드' })).toBeTruthy();
    expect(await screen.findByText('레이아웃 3x2 · 패널 1개')).toBeTruthy();
  });
});
