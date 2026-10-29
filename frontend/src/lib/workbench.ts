// 차트 작업대: 패널 정의·레이아웃·프리셋 검증. 패널은 변수·목적함수를 이름으로 참조한다 (다른 FMU로 이식 가능).
import type { DashboardLayout, DashboardPresetConfig, Job, RunRow, Variant } from '../api/types';

export type ChartKind =
  | 'scatter' | 'scatterMatrix' | 'parallel' | 'histogram' | 'boxViolin' | 'corrHeatmap' | 'radar' | 'bar'
  | 'contour' | 'tornado' | 'slice1d' | 'scatter3d' | 'surface3d'
  | 'convergence' | 'pareto' | 'importance' | 'trialOverview'
  | 'tsSubplots' | 'tsOverlay' | 'tsBand' | 'tsDiff' | 'phase' | 'fft';
export type FieldRef = { kind: 'param' | 'objective'; name: string };   // 목적함수는 이름으로 (프리셋 이식성)
export type GroupRef = { kind: 'job' | 'variant' };
export type PanelSpec = {
  id: string; title: string; chart: ChartKind;
  x?: FieldRef; y?: FieldRef; z?: FieldRef; color?: FieldRef | GroupRef; size?: FieldRef;
  fields?: FieldRef[];          // scatterMatrix/parallel/corrHeatmap/radar/tornado/importance
  groupBy?: 'job' | 'variant';  // boxViolin/bar
  vars?: string[];              // 시계열 변수
  refRunId?: string;            // tsDiff
  objectiveDir?: 'minimize' | 'maximize';
  violin?: boolean; method?: 'pearson' | 'spearman';
};

/** 차트 빌더가 받는 데이터. rows의 objectives는 objectives[].id로 키가 잡혀 있다. */
export type WorkbenchData = {
  rows: RunRow[];
  objectives: { id: string; name: string }[];
  params: string[];
  vars: string[];
  jobs: Job[];
  variants: Variant[];
};

export const CHART_LABELS: Record<ChartKind, string> = {
  scatter: '산점도', scatterMatrix: '산점도 행렬', parallel: '평행좌표', histogram: '히스토그램',
  boxViolin: '박스/바이올린', corrHeatmap: '상관 히트맵', radar: '레이더', bar: '막대',
  contour: '2D 등고선', tornado: '토네이도', slice1d: '1D 슬라이스', scatter3d: '3D 산점도', surface3d: '3D 표면',
  convergence: '수렴 이력', pareto: '파레토 프런트', importance: '파라미터 중요도', trialOverview: 'trial 개요',
  tsSubplots: '시계열 subplot', tsOverlay: '시계열 겹쳐 그리기', tsBand: '평균±범위 밴드', tsDiff: '기준 run 대비 차이',
  phase: 'XY 위상도', fft: 'FFT 스펙트럼',
};

export const CHART_GROUPS: { label: string; charts: ChartKind[] }[] = [
  { label: 'run 단위 값', charts: ['scatter', 'scatterMatrix', 'parallel', 'histogram', 'boxViolin', 'corrHeatmap', 'radar', 'bar'] },
  { label: '응답면·민감도', charts: ['contour', 'tornado', 'slice1d', 'scatter3d', 'surface3d'] },
  { label: '최적화', charts: ['convergence', 'pareto', 'importance', 'trialOverview'] },
  { label: '시계열', charts: ['tsSubplots', 'tsOverlay', 'tsBand', 'tsDiff', 'phase', 'fft'] },
];

/** 패널 편집기에 보여 줄 매핑 칸. 차트 Task(16–19)가 필요하면 고친다. */
export type Slot = 'x' | 'y' | 'z' | 'color' | 'size' | 'fields' | 'groupBy' | 'vars' | 'refRunId' | 'objectiveDir' | 'violin' | 'method';
export const CHART_SLOTS: Record<ChartKind, Slot[]> = {
  scatter: ['x', 'y', 'color', 'size'], scatterMatrix: ['fields', 'color'], parallel: ['fields', 'color'], histogram: ['x'],
  boxViolin: ['y', 'groupBy', 'violin'], corrHeatmap: ['fields', 'method'], radar: ['fields'], bar: ['y', 'groupBy'],
  contour: ['x', 'y', 'z'], tornado: ['y', 'fields', 'method'], slice1d: ['x', 'y'], scatter3d: ['x', 'y', 'z', 'color'],
  surface3d: ['x', 'y', 'z'],
  convergence: ['y', 'objectiveDir'], pareto: ['x', 'y', 'z', 'objectiveDir'], importance: ['y', 'fields'], trialOverview: [],
  tsSubplots: ['vars'], tsOverlay: ['vars', 'color'], tsBand: ['vars'], tsDiff: ['vars', 'refRunId'], phase: ['vars'], fft: ['vars'],
};

const TS_CHARTS = new Set<ChartKind>(['tsSubplots', 'tsOverlay', 'tsBand', 'tsDiff', 'phase', 'fft']);
/** 시계열(getTimeseries)이 필요한 차트 */
export function needsTimeseries(kind: ChartKind): boolean {
  return TS_CHARTS.has(kind);
}

const TS_DEFAULT_RUNS = 5;
const TS_MAX_RUNS = 50;
/** 시계열 패널이 그릴 run: 선택(최대 50) 또는 처음 5개. tsDiff 기준 run은 함께 받는다. */
export function timeseriesRunIds(spec: PanelSpec, data: Pick<WorkbenchData, 'rows'>, selected: string[]): string[] {
  if (!needsTimeseries(spec.chart)) return [];
  const ids = selected.length ? selected.slice(0, TS_MAX_RUNS) : data.rows.slice(0, TS_DEFAULT_RUNS).map(r => r.id);
  return spec.refRunId && !ids.includes(spec.refRunId) ? [...ids, spec.refRunId] : ids;
}

export const LAYOUTS: DashboardLayout[] = ['1x1', '1x2', '2x2', '2x3', '3x2', '3x3'];

export function layoutDims(l: DashboardLayout): { rows: number; cols: number } {
  const [rows, cols] = l.split('x').map(Number);
  return { rows, cols };
}

let idSeq = 0;
export function newPanelId(): string {
  return `p${Date.now().toString(36)}${(++idSeq).toString(36)}`;
}

export function newPanel(chart: ChartKind): PanelSpec {
  return { id: newPanelId(), title: CHART_LABELS[chart], chart };
}

export function defaultDashboard(): DashboardPresetConfig {
  return {
    layout: '2x2', syncTimeZoom: true,
    panels: (['scatter', 'parallel', 'tsSubplots', 'corrHeatmap'] as ChartKind[]).map(newPanel),
  };
}

/** Select 값 ↔ 참조: 'param:<이름>' | 'objective:<이름>' | 'job' | 'variant' */
export function refKey(r: FieldRef | GroupRef): string {
  return 'name' in r ? `${r.kind}:${r.name}` : r.kind;
}
export function parseRefKey(key: string): FieldRef | GroupRef | undefined {
  if (key === 'job' || key === 'variant') return { kind: key };
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  return kind === 'param' || kind === 'objective' ? { kind, name: key.slice(i + 1) } : undefined;
}

// ---- 프리셋 검증 ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFieldRef = (v: unknown): v is FieldRef =>
  isObj(v) && (v.kind === 'param' || v.kind === 'objective') && typeof v.name === 'string';
const isColor = (v: unknown) => isFieldRef(v) || (isObj(v) && (v.kind === 'job' || v.kind === 'variant'));
const isStrList = (v: unknown) => Array.isArray(v) && v.every(s => typeof s === 'string');

// 키마다 검사기. 키가 있는데 검사에 실패하면 패널 전체를 버린다.
const CHECKS: Record<Exclude<keyof PanelSpec, 'id' | 'title' | 'chart'>, (v: unknown) => boolean> = {
  x: isFieldRef, y: isFieldRef, z: isFieldRef, size: isFieldRef, color: isColor,
  fields: v => Array.isArray(v) && v.every(isFieldRef),
  groupBy: v => v === 'job' || v === 'variant',
  vars: isStrList,
  refRunId: v => typeof v === 'string',
  objectiveDir: v => v === 'minimize' || v === 'maximize',
  violin: v => typeof v === 'boolean',
  method: v => v === 'pearson' || v === 'spearman',
};

/** 프리셋의 패널 목록 검증: 형식이 맞지 않거나 id가 겹치는 항목은 버리고, 모르는 키는 떼어 낸다. */
export function parsePanels(raw: unknown[]): PanelSpec[] {
  const out: PanelSpec[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isObj(item) || typeof item.id !== 'string' || typeof item.title !== 'string') continue;
    if (typeof item.chart !== 'string' || !(item.chart in CHART_LABELS) || ids.has(item.id)) continue;
    const p: Record<string, unknown> = { id: item.id, title: item.title, chart: item.chart };
    let ok = true;
    for (const [key, check] of Object.entries(CHECKS)) {
      if (item[key] === undefined) continue;
      if (!check(item[key])) { ok = false; break; }
      p[key] = item[key];
    }
    if (!ok) continue;
    ids.add(item.id);
    out.push(p as PanelSpec);
  }
  return out;
}

/** 패널이 참조하지만 지금 데이터에 없는 파라미터·목적함수·변수 이름 (중복 없이, 나온 순서대로) */
export function missingRefs(p: PanelSpec, ctx: { params: string[]; objectives: string[]; vars: string[] }): string[] {
  const params = new Set(ctx.params), objectives = new Set(ctx.objectives), vars = new Set(ctx.vars);
  const missing = new Set<string>();
  const refs = [p.x, p.y, p.z, p.color, p.size, ...(p.fields ?? [])];
  for (const r of refs) {
    if (!r || !('name' in r)) continue;
    if (!(r.kind === 'param' ? params : objectives).has(r.name)) missing.add(r.name);
  }
  // 'time'은 언제나 시간축 (Ruling 1)
  for (const v of p.vars ?? []) if (v !== 'time' && !vars.has(v)) missing.add(v);
  return [...missing];
}

/** 패널에 쓰인 값 참조 (CSV 열) */
export function panelFieldRefs(p: PanelSpec): FieldRef[] {
  const refs = [p.x, p.y, p.z, p.color, p.size, ...(p.fields ?? [])].filter((r): r is FieldRef => !!r && 'name' in r);
  const seen = new Set<string>();
  return refs.filter(r => !seen.has(refKey(r)) && !!seen.add(refKey(r)));
}

/** 작업대 화면 상태 (프리셋 config와 같은 모양, 패널만 검증된 타입) */
export type DashboardState = { layout: DashboardLayout; syncTimeZoom: boolean; panels: PanelSpec[] };

/** 프리셋 → 화면 상태. 버린 패널·찾을 수 없는 참조가 있으면 경고로 알린다. */
export function dashboardFromConfig(
  cfg: DashboardPresetConfig, ctx: { params: string[]; objectives: string[]; vars: string[] },
): { state: DashboardState; warnings: string[] } {
  const raw = Array.isArray(cfg.panels) ? cfg.panels : [];
  const panels = parsePanels(raw);
  const warnings: string[] = [];
  if (panels.length < raw.length) warnings.push(`형식이 맞지 않는 패널 ${raw.length - panels.length}개를 뺐습니다`);
  const missing = panels.filter(p => missingRefs(p, ctx).length > 0);
  if (missing.length) warnings.push(`이 FMU에 없는 변수·목적함수를 쓰는 패널: ${missing.map(p => p.title).join(', ')}`);
  return {
    state: { layout: LAYOUTS.includes(cfg.layout) ? cfg.layout : '2x2', syncTimeZoom: cfg.syncTimeZoom !== false, panels },
    warnings,
  };
}
