import { describe, expect, test } from 'vitest';
import type { RunRow } from '../api/types';
import {
  CHART_GROUPS, CHART_LABELS, dashboardFromConfig, defaultDashboard, layoutDims, missingRefs, needsTimeseries, parsePanels, timeseriesRunIds, parseRefKey, refKey,
  type ChartKind, type PanelSpec,
} from './workbench';
import { buildChart, CHART_BUILDERS, itemOpacity, runIdFromClick, runIdsFromBrush } from './charts';
import { fieldValue } from './charts/fields';
import { panelCsv } from './workbenchCsv';

describe('layoutDims', () => {
  test('행x열', () => {
    expect(layoutDims('2x3')).toEqual({ rows: 2, cols: 3 });
    expect(layoutDims('1x1')).toEqual({ rows: 1, cols: 1 });
    expect(layoutDims('3x2')).toEqual({ rows: 3, cols: 2 });
  });
});

describe('CHART_GROUPS', () => {
  test('모든 차트 종류가 정확히 한 그룹에 있다', () => {
    const all = CHART_GROUPS.flatMap(g => g.charts);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual((Object.keys(CHART_LABELS) as ChartKind[]).sort());
    expect(CHART_GROUPS.map(g => g.label)).toEqual(['run 단위 값', '응답면·민감도', '최적화', '시계열']);
  });
});

describe('parsePanels', () => {
  test('형식이 맞지 않는 항목은 버린다', () => {
    const raw: unknown[] = [
      { id: 'a', title: '산점도', chart: 'scatter', x: { kind: 'param', name: 'p' }, y: { kind: 'objective', name: 'J' } },
      null,
      'x',
      { id: 'b', title: 't', chart: 'nope' },
      { id: 'c', chart: 'scatter' },
      { id: 'd', title: 't', chart: 'scatter', x: { kind: 'var', name: 'v' } },
      { id: 'e', title: 't', chart: 'tsSubplots', vars: ['v', 3] },
      { id: 'f', title: 't', chart: 'scatter', color: { kind: 'job' } },
      { id: 'a', title: 'dup', chart: 'histogram' },
      { id: 'g', title: 't', chart: 'corrHeatmap', method: 'kendall' },
      { id: 'h', title: 't', chart: 'boxViolin', groupBy: 'variant', violin: true },
    ];
    expect(parsePanels(raw).map(p => p.id)).toEqual(['a', 'f', 'h']);
  });

  test('프로토타입 키는 차트 종류가 아니다', () => {
    const raw = ['toString', 'constructor', '__proto__', 'hasOwnProperty'].map((chart, i) => ({ id: `x${i}`, title: 't', chart }));
    expect(parsePanels(raw)).toEqual([]);
    expect(buildChart({ id: 'a', title: 't', chart: 'toString' as never }, { rows: [], objectives: [], params: [], vars: [], jobs: [], variants: [] }, []))
      .toEqual({ empty: '준비 중' });
  });

  test('알 수 없는 추가 키는 떼어 낸다', () => {
    const [p] = parsePanels([{ id: 'a', title: 't', chart: 'fft', vars: ['v'], junk: 1 }]);
    expect(p).toEqual({ id: 'a', title: 't', chart: 'fft', vars: ['v'] });
  });
});

describe('missingRefs', () => {
  const ctx = { params: ['p1', 'p2'], objectives: ['J'], vars: ['v1'] };
  test('없는 파라미터·목적함수·변수 이름을 모은다', () => {
    const p: PanelSpec = {
      id: 'a', title: 't', chart: 'scatter',
      x: { kind: 'param', name: 'p1' }, y: { kind: 'objective', name: 'K' }, color: { kind: 'job' },
      size: { kind: 'param', name: 'q' }, fields: [{ kind: 'param', name: 'q' }, { kind: 'objective', name: 'J' }],
      vars: ['v1', 'v9', 'time'],
    };
    expect(missingRefs(p, ctx)).toEqual(['K', 'q', 'v9']);
  });
  test('모두 있으면 빈 목록', () => {
    expect(missingRefs({ id: 'a', title: 't', chart: 'tsSubplots', vars: ['v1'] }, ctx)).toEqual([]);
  });
});

describe('defaultDashboard', () => {
  test('2x2 + 기본 4패널', () => {
    const d = defaultDashboard();
    expect(d.layout).toBe('2x2');
    expect(parsePanels(d.panels).map(p => p.chart)).toEqual(['scatter', 'parallel', 'tsSubplots', 'corrHeatmap']);
    expect(new Set(parsePanels(d.panels).map(p => p.id)).size).toBe(4);
  });
});

describe('ref keys', () => {
  test('왕복', () => {
    expect(parseRefKey(refKey({ kind: 'objective', name: 'J:x' }))).toEqual({ kind: 'objective', name: 'J:x' });
    expect(parseRefKey('job')).toEqual({ kind: 'job' });
    expect(parseRefKey('bad')).toBeUndefined();
  });
  test('시계열 차트 판별', () => {
    expect(needsTimeseries('fft')).toBe(true);
    expect(needsTimeseries('scatter')).toBe(false);
  });
});

describe('chart registry', () => {
  const data = { rows: [], objectives: [], params: [], vars: [], jobs: [], variants: [] };
  test('등록 안 된 종류는 준비 중', () => {
    expect(buildChart({ id: 'a', title: 't', chart: 'fft' }, data, [])).toEqual({ empty: '준비 중' });
  });
  test('등록된 빌더를 부른다', () => {
    CHART_BUILDERS.fft = (_s, _d, sel) => ({ title: { text: sel.join(',') } });
    try {
      expect(buildChart({ id: 'a', title: 't', chart: 'fft' }, data, ['r1'])).toEqual({ title: { text: 'r1' } });
    } finally {
      delete CHART_BUILDERS.fft;
    }
  });
  test('선택이 없으면 모두 불투명, 있으면 나머지는 흐리게', () => {
    expect(itemOpacity('a', [])).toBe(1);
    expect(itemOpacity('a', ['a'])).toBe(1);
    expect(itemOpacity('b', ['a'])).toBe(0.15);
  });
  test('클릭 이벤트 → run id', () => {
    expect(runIdFromClick({ data: { id: 'r1' } })).toBe('r1');
    expect(runIdFromClick({ data: { name: 'r2', value: [1, 2] } })).toBe('r2');
    expect(runIdFromClick({ data: [1, 2] })).toBeUndefined();
  });
  test('브러시 이벤트 → run id 목록', () => {
    const option = { series: [{ data: [{ id: 'r1' }, { id: 'r2' }, { name: 'r3' }] }, { data: [{ id: 'r4' }] }] };
    const evt = { batch: [{ areas: [{}], selected: [{ seriesIndex: 0, dataIndex: [0, 2] }, { seriesIndex: 1, dataIndex: [0] }] }] };
    expect(runIdsFromBrush(option, evt)).toEqual(['r1', 'r3', 'r4']);
    expect(runIdsFromBrush(option, { batch: [{ areas: [], selected: [] }] })).toBeUndefined();
  });
});

describe('fieldValue', () => {
  const row = {
    id: 'r', jobId: 'j', fmuId: 'f', index: 0, params: { p: 2, b: true }, status: 'ok', error: null, elapsedSec: 1, variantId: 'v',
    objectives: { o1: { value: 5, error: null }, o2: { value: null, error: 'x' } },
  } as RunRow;
  const objs = [{ id: 'o1', name: 'J' }, { id: 'o2', name: 'K' }];
  test('파라미터·목적함수(이름) 값', () => {
    expect(fieldValue(row, { kind: 'param', name: 'p' }, objs)).toBe(2);
    expect(fieldValue(row, { kind: 'param', name: 'b' }, objs)).toBe(1);
    expect(fieldValue(row, { kind: 'param', name: 'zz' }, objs)).toBeNull();
    expect(fieldValue(row, { kind: 'objective', name: 'J' }, objs)).toBe(5);
    expect(fieldValue(row, { kind: 'objective', name: 'K' }, objs)).toBeNull();
    expect(fieldValue(row, { kind: 'objective', name: 'none' }, objs)).toBeNull();
  });
});

describe('dashboardFromConfig', () => {
  test('잘못된 레이아웃은 2x2, 버린 패널·누락 참조는 경고', () => {
    const { state, warnings } = dashboardFromConfig(
      { layout: '9x9' as never, syncTimeZoom: false, panels: [{ id: 'a', title: 'T', chart: 'fft', vars: ['zz'] }, 1] },
      { params: [], objectives: [], vars: ['v'] },
    );
    expect(state.layout).toBe('2x2');
    expect(state.syncTimeZoom).toBe(false);
    expect(state.panels.map(p => p.id)).toEqual(['a']);
    expect(warnings).toEqual(['형식이 맞지 않는 패널 1개를 뺐습니다', '이 FMU에 없는 변수·목적함수를 쓰는 패널: T']);
  });
});

describe('timeseriesRunIds', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ id: `r${i}` })) as RunRow[];
  const ts: PanelSpec = { id: 'a', title: 't', chart: 'tsOverlay' };
  test('선택 없으면 처음 5개, 있으면 최대 50개, 기준 run 포함', () => {
    expect(timeseriesRunIds(ts, { rows }, [])).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(timeseriesRunIds(ts, { rows }, rows.map(r => r.id))).toHaveLength(50);
    expect(timeseriesRunIds({ ...ts, chart: 'tsDiff', refRunId: 'r70' }, { rows }, ['r1'])).toEqual(['r1', 'r70']);
    expect(timeseriesRunIds({ ...ts, chart: 'scatter' }, { rows }, ['r1'])).toEqual([]);
  });
});

describe('panelCsv', () => {
  const row = (id: string, p: number) => ({
    id, jobId: 'j1', fmuId: 'f', index: p, params: { p, q: 1 }, status: 'ok', error: null, elapsedSec: 1, variantId: 'v1',
    objectives: { o1: { value: p * 10, error: null } },
  }) as RunRow;
  const data = {
    rows: [row('r1', 1), row('r2', 2)], objectives: [{ id: 'o1', name: 'J' }], params: ['p', 'q'], vars: [],
    jobs: [{ id: 'j1', name: '잡1' }] as never, variants: [{ id: 'v1', label: '원본' }] as never,
  };
  test('패널 필드 열, 시계열은 그린 run만', () => {
    const csv = panelCsv({ id: 'a', title: 't', chart: 'scatter', x: { kind: 'param', name: 'p' }, y: { kind: 'objective', name: 'J' } }, data);
    expect(csv).toBe('run,job,index,status,variant,p,J\nr1,잡1,1,ok,원본,1,10\nr2,잡1,2,ok,원본,2,20\n');
    expect(panelCsv({ id: 'b', title: 't', chart: 'tsSubplots' }, data, ['r2']))
      .toBe('run,job,index,status,variant,p,q\nr2,잡1,2,ok,원본,2,1\n');
  });
});
