# UI 개편 구현 계획 — 안내형 작업공간 · 목적함수 설계 도구 · 시각화 작업대

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엔지니어링 콘솔 테마의 홈 대시보드 + FMU 단계형 작업공간, GUI 목적함수 빌더(코드 생성·호환성·시험 실행), subplot 격자형 시각화 작업대를 만든다.

**Architecture:** 프론트엔드 중심. 계산(빌더 평가, 호환성, 통계, 차트 옵션)은 `frontend/src/lib/`의 순수 함수로 두고 단위 테스트한다. 컴포넌트는 그 함수를 호출해 ECharts 옵션을 렌더할 뿐이다. 백엔드는 일괄 테스트 API 1개와 `dashboard` 프리셋 종류만 추가한다.

**Tech Stack:** React 19, Mantine 7, ECharts 5 + `echarts-gl`, Monaco, React Query, vitest / FastAPI, pytest.

**Spec:** `docs/superpowers/specs/2026-10-29-ui-redesign-design.md`

## Global Constraints

- 목적함수 값은 DB에 저장하지 않는다 (빌더 미리보기·일괄 테스트 포함).
- 빌더가 만든 목적함수도 평범한 `.py`: `def evaluate(result: pd.DataFrame, params: dict) -> float`. 첫 줄 `# fmuc-builder: <JSON>`.
- `schemas.py` ↔ `types.ts` 형태 일치 (camelCase). `ApiClient` 메서드 추가 시 `http/`와 `mock/` 모두 구현.
- 폰트·라이브러리는 npm으로 번들. CDN 금지.
- 주석·UI 문구·오류 메시지 한국어, 식별자 영어. 백엔드 CRLF 파일은 CRLF 유지.
- 기존 라우트 `/fmus/:id/batch`, `/fmus/:id/optimize`, `/fmus/:id/results`, `/jobs/:id`, `/objectives/:id`는 계속 동작해야 한다.
- 각 Phase 끝: `cd backend; .venv\python.exe -m pytest`, `cd frontend; npm test`, `npx tsc -b`, `npm run lint`(오류 0) 통과.
- 시험 실행: 기존 `createBatch` 사용, 백엔드 변경 없음. `BatchRequest.params`는 최소 1개라서 **첫 번째 수치 파라미터를 시작값 1개짜리 list로** 넣는다 (기본값과 동일한 실행).

## Review Focus

1. **트리거가 한 번도 안 일어나는 run** → 0이 아니라 오류 `"트리거 조건을 만족하는 시점이 없습니다"`. TS 평가기와 생성 Python 둘 다. (Task 6, 8)
2. **Modelica 변수명** (`vehicle.x`, `a[1]`, `der(x)`) → 수식·코드 생성에서 깨지지 않음. 수식에서는 백틱 인용 `` `a[1]` ``, 생성 코드에서는 `result["a[1]"]`. (Task 5, 7)
3. **빌더 헤더는 있는데 본문을 손으로 고친 코드** → 고급 모드로 열리고, 빌더로 되돌릴 때 확인을 받음. (Task 7, 12)
4. **목적함수 값이 null인 run·실패 run이 섞인 결과** → 차트가 null을 건너뛰고 빈 패널 대신 "값 없음"을 표시. (Task 13, 16)
5. **다른 FMU의 대시보드 레이아웃 불러오기** → 없는 변수·목적함수를 참조하는 패널은 `찾을 수 없음: <이름>` 표시, 나머지 패널은 정상. (Task 15)

---

## 파일 구조

```
frontend/src/
  theme.ts                         Mantine 테마 + ECharts 테마 등록
  components/ColorSchemeToggle.tsx
  lib/workflow.ts                  단계 완료 판정, 다음 할 일
  pages/HomePage.tsx
  pages/workspace/WorkspaceLayout.tsx   단계 바 + Outlet
  pages/workspace/StepBar.tsx
  pages/workspace/ModelStep.tsx         (FmuDetailPage 내용)
  pages/workspace/ResourcesStep.tsx
  pages/workspace/ObjectivesStep.tsx
  pages/workspace/RunStep.tsx           배치/최적화 탭 + 잡 목록
  pages/workspace/ResultsStep.tsx       작업대 + 결과 표
  lib/expr.ts                      파생 신호 수식 파서·평가·Python 변환
  lib/builder/spec.ts              BuilderSpec 타입, 기본값
  lib/builder/evaluate.ts          TS 평가기
  lib/builder/codegen.ts           Python 생성, 헤더 파싱, 모드 판정
  lib/builder/cases.ts             패리티 테스트 케이스 (TS/Python 공용 fixture 원본)
  lib/compat.ts                    필요 컬럼 추출, 잡별 호환성
  components/objective/BuilderPanel.tsx   블록 설정 폼
  components/objective/PreviewCharts.tsx  트리거 선·구간 음영 subplot
  components/objective/ObjectiveDesigner.tsx  빌더/고급 모드 전체
  components/objective/TrialRunButton.tsx
  components/objective/BatchApply.tsx     일괄 적용 히스토그램
  lib/vizStats.ts                  통계·보간·FFT·상관
  lib/workbench.ts                 PanelSpec/DashboardConfig 타입, 참조 검사
  lib/charts/scalar.ts | surface.ts | optimization.ts | timeseries.ts   ECharts 옵션 빌더
  components/workbench/Workbench.tsx | Panel.tsx | PanelEditor.tsx | SelectionContext.tsx | useWorkbenchData.ts
backend/app/routers/objectives.py  POST /api/objectives/test-batch
backend/app/schemas.py             ObjectiveTestBatchIn/Out, DashboardPresetConfig
backend/tests/test_objectives_batch.py, test_builder_parity.py, test_presets.py(추가)
backend/tests/fixtures/builder_parity.json   (Task 8에서 프론트 테스트가 생성·검증)
```

---

# Phase 1 — 테마와 앱 구조

### Task 1: 엔지니어링 콘솔 테마

**Files:**
- Create: `frontend/src/theme.ts`, `frontend/src/components/ColorSchemeToggle.tsx`, `frontend/src/theme.test.tsx`
- Modify: `frontend/src/main.tsx`, `frontend/src/test/render.tsx`, `frontend/package.json`

**Interfaces:**
- Produces: `export const theme: MantineThemeOverride`, `export const cssVariablesResolver`, `export function registerEchartsThemes(): void`, `export function useEchartsTheme(): 'fmuc-dark' | 'fmuc-light'`, `<ColorSchemeToggle />`

- [ ] **Step 1: 의존성 추가** — `npm i @fontsource/ibm-plex-sans-kr @fontsource/ibm-plex-mono echarts-gl` (정확한 버전 고정, `package.json`에 `^` 없이 기존 방식대로).
- [ ] **Step 2: 실패 테스트 `theme.test.tsx`**
```tsx
test('기본 색 스킴은 다크, primary는 cyan', () => {
  expect(theme.primaryColor).toBe('cyan');
  expect(theme.fontFamilyMonospace).toContain('IBM Plex Mono');
});
test('토글을 누르면 라이트로 바뀐다', async () => {
  renderWith(<ColorSchemeToggle />);
  await userEvent.click(screen.getByRole('button', { name: '라이트 모드' }));
  expect(screen.getByRole('button', { name: '다크 모드' })).toBeInTheDocument();
});
```
- [ ] **Step 3: 실행해 실패 확인** — `npm test -- theme` → FAIL (모듈 없음)
- [ ] **Step 4: 구현**
  - `theme`: `primaryColor: 'cyan'`, `fontFamily: 'IBM Plex Sans KR, sans-serif'`, `fontFamilyMonospace: 'IBM Plex Mono, monospace'`, `defaultRadius: 'xs'`, 컴포넌트 기본 `size: 'sm'`(Button, TextInput, Select, NumberInput, MultiSelect), `Card` 기본 `withBorder`, `Table` 기본 `verticalSpacing: 'xs'`. 다크 배경 `#0f1419`, 패널 `#161b22`, 테두리 `#30363d`는 `cssVariablesResolver`의 dark 변수(`--mantine-color-body`, 커스텀 `--fmuc-panel`, `--fmuc-border`)로.
  - 전역 CSS(`theme.ts`에서 import하는 `theme.css`): `.fmuc-num { font-family: var(--mantine-font-family-monospace); font-variant-numeric: tabular-nums; }`, `.fmuc-label { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--mantine-color-cyan-4); }`.
  - `registerEchartsThemes`: `echarts.registerTheme('fmuc-dark', {...})`/`'fmuc-light'` — 배경 투명, 축·격자 색을 위 토큰에 맞춤, 시리즈 팔레트 10색(시안 시작).
  - `ColorSchemeToggle`: `useMantineColorScheme`, aria-label은 전환될 모드명(`'라이트 모드'`/`'다크 모드'`).
  - `main.tsx`: `MantineProvider theme={theme} cssVariablesResolver={...} defaultColorScheme="dark"`, 폰트 css import, `registerEchartsThemes()` 호출. `render.tsx`의 Provider에도 `theme` 전달.
- [ ] **Step 5: 기존 차트 컴포넌트 전부 `<ReactECharts theme={useEchartsTheme()} …>`로** (`ScatterChart`, `TimeseriesChart`, `CandidateBarChart`, `CandidatePreview`, ResultsPage·JobMonitorPage 안 차트).
- [ ] **Step 6: `npm test`, `npx tsc -b` → PASS**
- [ ] **Step 7: Commit** `feat(frontend): engineering-console theme with dark/light toggle`

### Task 2: 진행 단계 판정 `lib/workflow.ts`

**Files:** Create `frontend/src/lib/workflow.ts`, `frontend/src/lib/workflow.test.ts`

**Interfaces:**
- Produces:
```ts
export type StepKey = 'model' | 'resources' | 'objectives' | 'run' | 'results';
export const STEPS: { key: StepKey; label: string; path: string }[];
// label: '① 모델','② 변수·리소스','③ 목적함수','④ 실행','⑤ 결과 분석'; path: '', 'resources', 'objectives', 'run', 'results'
export type WorkflowInput = { nJobs: number; nOkRuns: number; nCompatibleObjectives: number; resourcesVisited: boolean };
export function stepDone(key: StepKey, i: WorkflowInput): boolean;
export function nextAction(i: WorkflowInput): { step: StepKey; label: string };
```

- [ ] **Step 1: 실패 테스트**
```ts
const empty = { nJobs: 0, nOkRuns: 0, nCompatibleObjectives: 0, resourcesVisited: false };
test('model은 항상 완료', () => expect(stepDone('model', empty)).toBe(true));
test('처음엔 리소스 확인부터', () => expect(nextAction(empty)).toEqual({ step: 'resources', label: '변수·리소스 확인' }));
test('리소스 본 뒤엔 목적함수', () => expect(nextAction({ ...empty, resourcesVisited: true }).step).toBe('objectives'));
test('목적함수 있으면 실행', () => expect(nextAction({ ...empty, resourcesVisited: true, nCompatibleObjectives: 1 })).toEqual({ step: 'run', label: '배치/최적화 실행' }));
test('성공 run 있으면 결과', () => expect(nextAction({ nJobs: 1, nOkRuns: 3, nCompatibleObjectives: 1, resourcesVisited: true })).toEqual({ step: 'results', label: '결과 분석' }));
test('잡은 있는데 목적함수 없으면 목적함수', () => expect(nextAction({ nJobs: 1, nOkRuns: 3, nCompatibleObjectives: 0, resourcesVisited: true }).step).toBe('objectives'));
```
  다른 label: objectives → `'목적함수 설계하기'`.
- [ ] **Step 2: FAIL 확인 → Step 3: 구현** — `nextAction`은 STEPS 순서대로 첫 미완료 단계(model 제외). 판정: resources=`resourcesVisited || nJobs>0`, objectives=`nCompatibleObjectives>0`, run=`nJobs>0`, results=`nOkRuns>0`. 모두 완료면 results.
  `resourcesVisited`는 `localStorage` 키 `fmuc.visited.resources.<fmuId>` (try/catch) — 읽기·쓰기 헬퍼 `markResourcesVisited(fmuId)`, `isResourcesVisited(fmuId)`도 이 파일에.
- [ ] **Step 4: PASS → Step 5: Commit** `feat(frontend): workflow step logic`

### Task 3: 작업공간 레이아웃과 라우트 재배치

**Files:**
- Create: `frontend/src/pages/workspace/{WorkspaceLayout,StepBar,ModelStep,ResourcesStep,ObjectivesStep,RunStep,ResultsStep}.tsx`, `frontend/src/pages/workspace/Workspace.test.tsx`, `frontend/src/components/useWorkflowInput.ts`
- Modify: `frontend/src/App.tsx`, `frontend/src/pages/FmuDetailPage.tsx`(→ ModelStep로 이동 후 삭제), `App.test.tsx`

**Interfaces:**
- Consumes: Task 2 `STEPS`, `stepDone`, `nextAction`.
- Produces: `useWorkflowInput(fmuId: string): WorkflowInput | undefined` (jobs: `listJobs({fmuId})`, okRuns: `listRuns({fmuId,status:'ok',limit:1}).total`, 호환 목적함수 수: Task 9 이전에는 `listObjectives().length`, Task 12에서 호환 판정으로 교체). 라우트:
  - `/fmus/:fmuId` → ModelStep, `/resources`, `/objectives`, `/objectives/new`, `/objectives/:objectiveId`, `/run` (`?tab=batch|optimize`), `/results`
  - `/fmus/:fmuId/batch` → `<Navigate to="../run?tab=batch">`, `/optimize` → `run?tab=optimize`. `/results` 그대로.
- 사이드바(App Layout): 상단 `홈`, `FMU` 그룹(모델명 목록, 현재 FMU 강조), `공용` 그룹(`목적함수 라이브러리` `/objectives`, `프리셋`, `잡 전체`). 헤더: `FMU Controller` + 병렬 배지 + `ColorSchemeToggle`.

- [ ] **Step 1: 실패 테스트 `Workspace.test.tsx`** (mock client, 픽스처 FMU 사용)
```tsx
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
test('다음 버튼은 다음 단계로 이동', async () => {
  renderApp({ route: `/fmus/${FMU_ID}` });
  await userEvent.click(await screen.findByRole('link', { name: '다음: ② 변수·리소스' }));
  expect(await screen.findByRole('link', { name: /② 변수·리소스/ })).toHaveAttribute('aria-current', 'step');
});
```
  완료 단계는 링크 안에 `✓`(aria-label `완료`) 표시.
- [ ] **Step 2: FAIL → Step 3: 구현.** ModelStep = 기존 FmuDetailPage의 메타 카드 + 파라미터/출력/전체 탭 (Resources 탭 제외). ResourcesStep = `ResourcesPanel` + 안내문 `"기록할 변수는 ④ 실행에서 고릅니다. 여기서는 resources/ 후보 파일을 관리합니다."` + mount 시 `markResourcesVisited`. RunStep = Tabs(`배치 해석`=BatchSetupPage 본문, `최적화`=OptimizationSetupPage 본문, `잡` = 이 FMU 잡 목록, JobListPage 표 재사용). ObjectivesStep·ResultsStep은 이 Task에선 기존 ObjectiveEditorPage/ResultsPage를 감싼 자리표시. 각 단계 하단 오른쪽 `다음: <다음 단계 label>` 링크.
  BatchSetupPage/OptimizationSetupPage가 제출 후 navigate하는 경로는 그대로 (`/jobs/:id`).
- [ ] **Step 4: 기존 테스트 경로 업데이트** (`BatchSetupPage.test.tsx` 등 `/fmus/x/batch` 사용하는 테스트는 리다이렉트로 그대로 통과해야 함 — 실패하면 탭 셀렉터만 보정).
- [ ] **Step 5: `npm test` PASS → Step 6: Commit** `feat(frontend): FMU workspace with step bar`

### Task 4: 홈 대시보드

**Files:** Create `frontend/src/pages/HomePage.tsx`, `frontend/src/pages/HomePage.test.tsx`; Modify `App.tsx` (`/` → HomePage, `/fmus` → HomePage로 리다이렉트), FmuListPage 업로드 드롭존을 `components/FmuUpload.tsx`로 추출해 재사용.

**Interfaces:** Consumes `useWorkflowInput`, `nextAction`, `stepDone`.

- [ ] **Step 1: 실패 테스트**
```tsx
test('FMU 카드에 다음 할 일 버튼', async () => {
  renderApp({ route: '/' });
  const card = await screen.findByTestId(`fmu-card-${FMU_ID}`);
  expect(within(card).getByRole('link', { name: /변수·리소스 확인|목적함수 설계하기|배치\/최적화 실행|결과 분석/ })).toBeInTheDocument();
});
test('FMU가 없으면 시작 가이드와 업로드', async () => {
  renderApp({ route: '/', client: createMockClient({ tickMs: 10, empty: true }) });
  expect(await screen.findByText('시작하기')).toBeInTheDocument();
  expect(screen.getByText(/FMU 파일을 끌어다 놓거나/)).toBeInTheDocument();
});
test('실행 중인 잡 진행률', async () => { /* mock에 running 잡 하나 만들고 진행률 % 텍스트 확인 */ });
```
  `createMockClient`에 `empty?: boolean` 옵션이 없으면 추가 (픽스처 없이 시작).
- [ ] **Step 2: FAIL → Step 3: 구현.** 레이아웃: 상단 `.fmuc-label` "WORKSPACE", FMU 카드 그리드(모델명, 5단계 점 표시, run 수 `.fmuc-num`, 다음 할 일 버튼), 오른쪽 열 "실행 중/최근 잡"(최근 5개, 진행률 Progress), FMU 0개면 시작 가이드 체크리스트 5줄(단계 label) + 업로드.
- [ ] **Step 4: PASS → Step 5: Phase 1 전체 검증** (Global Constraints 명령 4개) **→ Step 6: Commit** `feat(frontend): home dashboard`

---

# Phase 2 — 목적함수 설계 도구

### Task 5: 수식 `lib/expr.ts`

**Files:** Create `frontend/src/lib/expr.ts`, `frontend/src/lib/expr.test.ts`

**Interfaces:**
```ts
export type Expr =
  | { k: 'num'; v: number } | { k: 'col'; name: string } | { k: 'param'; name: string }
  | { k: 'un'; op: '-'; a: Expr } | { k: 'bin'; op: '+' | '-' | '*' | '/' | '**'; a: Expr; b: Expr }
  | { k: 'call'; fn: ExprFn; args: Expr[] };
export const EXPR_FUNCS = ['sqrt','abs','sin','cos','tan','exp','log','log10','min','max','diff','cumsum'] as const;
export type ExprFn = typeof EXPR_FUNCS[number];
export function parseExpr(src: string): Expr;              // 실패 시 throw new ExprError(한국어 메시지)
export function exprColumns(e: Expr): string[];            // 참조 컬럼 (중복 제거, 등장 순)
export function exprParams(e: Expr): string[];
export function evalExpr(e: Expr, cols: Record<string, Float64Array>, params: Record<string, number>, n: number): Float64Array;
export function exprToPython(e: Expr, colVar: (name: string) => string): string;
```
  문법: 식별자 `[A-Za-z_][A-Za-z0-9_.]*` 또는 백틱 인용 `` `아무거나` ``는 컬럼, `params.k` 또는 `params["k"]`는 파라미터, 숫자(지수 표기 포함), 괄호, 위 연산자(`**` 우결합, 단항 `-`). 함수명이 아닌 식별자 뒤 `(`는 오류.
  의미: 요소별 numpy 의미. `min/max`는 2인자 요소별(np.minimum/np.maximum). `diff(x)`는 길이 유지: `np.diff(x, prepend=x[0])`. `cumsum` = `np.cumsum`.

- [ ] **Step 1: 실패 테스트**
```ts
test('컬럼·파라미터·연산', () => {
  const e = parseExpr('sqrt(x**2 + `a[1]`**2) * params.k');
  expect(exprColumns(e)).toEqual(['x', 'a[1]']);
  expect(exprParams(e)).toEqual(['k']);
  const r = evalExpr(e, { x: new Float64Array([3]), 'a[1]': new Float64Array([4]) }, { k: 2 }, 1);
  expect(r[0]).toBe(10);
});
test('점 있는 Modelica 이름', () => expect(exprColumns(parseExpr('vehicle.v*3.6'))).toEqual(['vehicle.v']));
test('diff는 길이 유지', () => expect([...evalExpr(parseExpr('diff(x)'), { x: new Float64Array([1, 3, 6]) }, {}, 3)]).toEqual([0, 2, 3]));
test('모르는 함수는 오류', () => expect(() => parseExpr('foo(x)')).toThrow('알 수 없는 함수: foo'));
test('괄호 불일치', () => expect(() => parseExpr('(x+1')).toThrow('괄호가 닫히지 않았습니다'));
test('Python 변환', () => expect(exprToPython(parseExpr('sqrt(`a[1]`)*params.k'), n => `col(${JSON.stringify(n)})`)).toBe('np.sqrt(col("a[1]")) * float(params["k"])'));
```
- [ ] **Step 2: FAIL → Step 3: 재귀 하강 파서 구현 → Step 4: PASS → Step 5: Commit** `feat(frontend): derived-signal expression parser`

### Task 6: 빌더 스펙과 TS 평가기

**Files:** Create `frontend/src/lib/builder/spec.ts`, `frontend/src/lib/builder/evaluate.ts`, `frontend/src/lib/builder/evaluate.test.ts`

**Interfaces:**
```ts
// spec.ts
export type Num = number | { param: string };
export type CmpOp = '>=' | '>' | '<=' | '<';
export type Trigger =
  | { kind: 'cross'; signal: string; dir: 'up' | 'down'; threshold: Num; occurrence: 'first' | 'last' }
  | { kind: 'reach'; signal: string; op: CmpOp; threshold: Num; occurrence: 'first' | 'last' }
  | { kind: 'time'; t: Num }
  | { kind: 'extremum'; signal: string; which: 'max' | 'min' }
  | { kind: 'hold'; signal: string; op: CmpOp; threshold: Num; durationSec: Num };
export type Window =
  | { kind: 'all' } | { kind: 'fromTrigger' } | { kind: 'untilTrigger' }
  | { kind: 'between' }                                  // triggers[0] ~ triggers[1]
  | { kind: 'around'; beforeSec: Num; afterSec: Num }    // triggers[0] ± N초 (데이터 범위로 자름)
  | { kind: 'mask'; signal: string; op: CmpOp; threshold: Num };
export type Calc =
  | { kind: 'delta' | 'integral' | 'mean' | 'rms' | 'max' | 'min' | 'std' | 'duration'; signal: string }
  | { kind: 'overshoot'; signal: string } | { kind: 'settling'; signal: string; tolPct: Num }
  | { kind: 'rmse'; signal: string; ref: string };
export type BuilderSpec = {
  version: 1;
  derived: { name: string; expr: string }[];
  triggers: Trigger[];            // window가 요구하는 개수: fromTrigger/untilTrigger/around=1, between=2, 나머지 0
  window: Window;
  calc: Calc;
  post: { abs: boolean; negate: boolean; scale: Num };
};
export const DEFAULT_SPEC: BuilderSpec;  // { version: 1, derived: [], triggers: [], window: { kind: 'all' }, calc: { kind: 'duration', signal: 'time' }, post: { abs: false, negate: false, scale: 1 } }
export function specColumns(s: BuilderSpec): string[];   // derived 이름 제외한 원본 컬럼 + 'time'
export function specParams(s: BuilderSpec): string[];
// evaluate.ts
export type BuilderData = { time: Float64Array; cols: Record<string, Float64Array>; params: Record<string, number> };
export type BuilderTrace = { triggerTimes: number[]; segments: [number, number][] /* 인덱스 구간, 양끝 포함 */ };
export function evaluateSpec(s: BuilderSpec, d: BuilderData): { value: number | null; error: string | null; trace: BuilderTrace | null };
```
  의미 (TS·Python 동일하게 — Task 7 헬퍼와 1:1):
  - 트리거 인덱스: `cross up` = `i≥1 && s[i-1] < th && s[i] >= th` (down은 `>`/`<=`), `reach` = 조건 참인 인덱스, `occurrence`로 첫/마지막. `time` = `t[i] >= T`인 첫 i. `extremum` = argmax/argmin(첫 번째). `hold` = 조건 참이 연속으로 이어진 구간 중 `t[end]-t[start] >= dur`인 첫 구간의 start.
  - 구간: `all` [0,n-1], `fromTrigger` [i,n-1], `untilTrigger` [0,i], `between` [i0,i1] (`i1<i0`면 오류 `"두 번째 트리거가 첫 번째보다 앞입니다"`), `around` [t_i-before, t_i+after]에 드는 인덱스, `mask` 조건 참인 연속 구간들.
  - 집계 (구간 집합 segs): `integral`=Σ trapz, `duration`=Σ(t[e]-t[s]), `delta`=Σ(s[e]-s[s]), `mean`=integral/duration (duration 0이면 s[s]), `rms`=sqrt(Σtrapz(s²)/duration), `max/min/std`(ddof=0)=구간 표본 전체, `rmse`=sqrt(mean((a-b)²)) 표본 평균, `overshoot`=(max-final)/|final-initial|*100 (initial=s[seg0.s], final=s[seg.last.e], 분모 0이면 오류 `"오버슛 계산 불가: 시작값과 끝값이 같습니다"`), `settling`= band=tol/100*|final-initial|, 구간 안 `|s-final|>band`인 마지막 인덱스 j가 있으면 `t[j]-t[seg0.s]` 없으면 0. `overshoot/settling`은 mask 구간에서 오류 `"이 계산은 연속 구간에서만 쓸 수 있습니다"`.
  - 후처리 순서: abs → negate → ×scale.
  - 오류 문구(정확히): 트리거 없음 `"트리거 조건을 만족하는 시점이 없습니다"`, 빈 구간 `"계산 구간이 비어 있습니다"`, 컬럼 없음 `"컬럼이 없습니다: <이름>"`, 파라미터 없음 `"파라미터가 없습니다: <이름>"`, 비유한 결과 `"결과가 유한한 수가 아닙니다"`.

- [ ] **Step 1: 실패 테스트** — 사용자 예시 포함:
```ts
const d = { time: f([0,1,2,3,4]), cols: { pedal: f([0,0.5,0.95,1,1]), x: f([0,1,3,6,10]), v: f([1,2,3,4,4]) }, params: { th: 0.9 } };
const base = { ...DEFAULT_SPEC, window: { kind: 'fromTrigger' } as const };
test('예시: 페달 ≥0.9 이후 이동 거리 (delta)', () => {
  const r = evaluateSpec({ ...base, triggers: [{ kind: 'cross', signal: 'pedal', dir: 'up', threshold: { param: 'th' }, occurrence: 'first' }], calc: { kind: 'delta', signal: 'x' } }, d);
  expect(r.value).toBe(7); expect(r.trace!.triggerTimes).toEqual([2]);
});
test('같은 거리를 속도 적분으로', () => { /* calc integral v → 3.5+3.5... = trapz([3,4,4],[2,3,4]) = 7.5 */ });
test('트리거 없음은 오류', () => expect(evaluateSpec({ ...base, triggers: [{ kind: 'cross', signal: 'pedal', dir: 'up', threshold: 2, occurrence: 'first' }], calc: { kind: 'delta', signal: 'x' } }, d)).toMatchObject({ value: null, error: '트리거 조건을 만족하는 시점이 없습니다' }));
test('mask 구간 duration', () => { /* pedal>=0.9 → idx 2..4 → 2 */ });
test('파생 신호 사용', () => { /* derived kmh = v*3.6, calc max kmh → 14.4 */ });
test('후처리 abs→negate→scale', () => { /* delta x 전체 = 10, negate, scale 2 → -20 */ });
test('settling, overshoot', () => { /* 직접 만든 계단응답 배열로 */ });
```
- [ ] **Step 2: FAIL → Step 3: 구현 → Step 4: PASS → Step 5: Commit** `feat(frontend): objective builder spec and evaluator`

### Task 7: Python 코드 생성과 모드 판정

**Files:** Create `frontend/src/lib/builder/codegen.ts`, `codegen.test.ts`

**Interfaces:**
```ts
export const HEADER_PREFIX = '# fmuc-builder: ';
export function generateCode(s: BuilderSpec): string;               // 첫 줄 HEADER_PREFIX + JSON.stringify(spec)
export function parseBuilderCode(code: string): { spec: BuilderSpec; intact: boolean } | null;
// 헤더 없거나 JSON 파싱 실패 → null. intact = (generateCode(spec) === code 정규화 비교: 줄끝 \r\n→\n, 끝 공백줄 제거)
```
  생성 코드 구조: 헤더 → `import numpy as np` → 고정 헬퍼 블록(`_trigger_index`, `_segments`, `_calc`, 오류는 `raise ValueError("<Task 6의 정확한 문구>")`) → `def evaluate(result, params):` 안에서 `col = lambda n: result[n].to_numpy(dtype=float)` (없으면 `ValueError("컬럼이 없습니다: n")`), 파생 신호를 `sig` dict에 계산 (`exprToPython`), 스펙 값을 리터럴로 넣어 헬퍼 호출, 후처리, `return float(v)`.

- [ ] **Step 1: 실패 테스트**
```ts
test('헤더 왕복', () => { const c = generateCode(SPEC_EX); expect(parseBuilderCode(c)).toEqual({ spec: SPEC_EX, intact: true }); });
test('본문을 고치면 intact=false', () => expect(parseBuilderCode(generateCode(SPEC_EX).replace('return float(v)', 'return float(v) * 2'))!.intact).toBe(false));
test('CRLF여도 intact', () => expect(parseBuilderCode(generateCode(SPEC_EX).replace(/\n/g, '\r\n'))!.intact).toBe(true));
test('헤더 없는 코드는 null', () => expect(parseBuilderCode('def evaluate(r, p):\n    return 1.0\n')).toBeNull());
test('이상한 컬럼명은 문자열 리터럴로', () => expect(generateCode({ ...SPEC_EX, calc: { kind: 'max', signal: 'a["b"]' } })).toContain('col("a[\\"b\\"]")'));
test('evaluate 함수 정의 포함', () => expect(generateCode(DEFAULT_SPEC)).toMatch(/^def evaluate\(result, params\):/m));
```
- [ ] **Step 2: FAIL → Step 3: 구현 → Step 4: PASS → Step 5: Commit** `feat(frontend): builder python codegen`

### Task 8: TS ↔ Python 패리티

**Files:** Create `frontend/src/lib/builder/cases.ts`, `frontend/src/lib/builder/parity.test.ts`, `backend/tests/fixtures/builder_parity.json`, `backend/tests/test_builder_parity.py`

**Interfaces:**
- `cases.ts`: `export const PARITY_CASES: { name: string; spec: BuilderSpec; data: { time: number[]; cols: Record<string, number[]>; params: Record<string, number> } }[]` — Task 6 테스트의 모든 케이스 + 트리거 6종 × 구간 6종 중 대표 조합 ≥ 20개, 오류 케이스(트리거 없음, 빈 구간, 컬럼 없음) 포함.
- fixture JSON: `[{ name, code, data, expected: { value: number|null, error: string|null } }]`

- [ ] **Step 1: `parity.test.ts`** — 각 케이스에 `generateCode`와 `evaluateSpec`을 돌려 fixture 배열을 만든다. `process.env.UPDATE_PARITY === '1'`이면 `backend/tests/fixtures/builder_parity.json`에 쓰고(`node:fs`), 아니면 파일 내용과 `toEqual` (fixture가 낡으면 실패).
- [ ] **Step 2: `UPDATE_PARITY=1 npm test -- parity`로 fixture 생성** (PowerShell: `$env:UPDATE_PARITY='1'; npm test -- parity; Remove-Item Env:UPDATE_PARITY`)
- [ ] **Step 3: `test_builder_parity.py`** — 각 케이스: `pd.DataFrame({"time": data.time, **data.cols})`로 `app.objectives.worker.evaluate_item`과 같은 경로(코드 exec → `evaluate(df, params)` → `to_scalar`, 예외면 `str(e)`)로 계산해 `expected.value`와 `pytest.approx(rel=1e-9)`, 오류면 메시지 일치. 실제 parquet 경로가 필요하면 `write_result`로 tmp에 써서 `evaluate_item(code, EvalItem(...))` 사용 — 오류 문자열은 traceback 마지막 줄에 메시지가 포함되는지(`in`) 비교.
- [ ] **Step 4: `pytest tests/test_builder_parity.py` PASS, `npm test -- parity` PASS** (실패 시 TS/Python 헬퍼 중 틀린 쪽을 고친다)
- [ ] **Step 5: Commit** `test: builder TS/Python parity fixture`

### Task 9: 호환성 `lib/compat.ts`

**Files:** Create `frontend/src/lib/compat.ts`, `compat.test.ts`

**Interfaces:**
```ts
export function requiredColumns(code: string): { columns: string[]; estimated: boolean };
// 빌더 코드면 specColumns (estimated=false), 아니면 정규식 /result\[\s*(['"])(.+?)\1\s*\]/g 추출 + 'time' 제외 (estimated=true)
export type JobCompat = { jobId: string; jobName: string; ok: boolean; missing: string[] };
export function jobCompat(required: string[], jobs: Job[], outputNames: string[]): JobCompat[];
// recordVariables가 [] 이면 outputNames 기준. 'time'은 항상 있음.
export function fmuCompat(required: string[], fmuVarNames: string[]): { recordable: boolean; unknown: string[] };
export function summarize(c: JobCompat[]): { okJobs: number; totalJobs: number };
```
- [ ] **Step 1: 실패 테스트** — 빌더 코드 → estimated false; 손코드 `result["x"]`, `result['a.b']` 추출; `recordVariables: []` 잡은 outputNames로 판정; 누락 목록 정확; fmuCompat unknown.
- [ ] **Step 2–4: FAIL → 구현 → PASS → Step 5: Commit** `feat(frontend): objective compatibility checks`

### Task 10: 일괄 테스트 API

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/routers/objectives.py`, `frontend/src/api/{types.ts,client.ts,http/httpClient.ts,mock/mockClient.ts}`
- Test: `backend/tests/test_objectives_batch.py`, `frontend/src/api/mock/mockClient.test.ts`(추가), `httpClient.test.ts`(추가)

**Interfaces:**
- `POST /api/objectives/test-batch` body `ObjectiveTestBatchIn { code: str; run_ids: list[str] = Field(min_length=1, max_length=200) }` → `ObjectiveTestBatchOut { results: dict[str, ObjectiveTestResult] }` (run id → 결과). 라우트는 `/{objective_id}`보다 위에 선언.
- 없는 run → 그 run 결과에 `error="run을 찾을 수 없습니다"`, 실패 run → `"시뮬레이션이 실패한 run으로는 테스트할 수 없습니다"` (요청 전체를 404/409로 실패시키지 않음).
- 계산: `await run_in_threadpool(evaluator.evaluate, code, items)` (캐시 사용 OK — 값은 메모리 캐시뿐, DB 미저장).
- TS: `testObjectiveBatch(req: { code: string; runIds: string[] }): Promise<{ results: Record<string, ObjectiveTestResult> }>`

- [ ] **Step 1: 실패 테스트 (pytest)** — run 2개(ok) + 실패 run 1개 + 없는 id → 상태 200, ok run은 값, 나머지는 위 메시지; 201개 → 422; 호출 후 DB에 목적함수 값 관련 테이블/컬럼 변화 없음(Run 행 그대로).
- [ ] **Step 2: FAIL → Step 3: 구현 (CRLF 유지) → Step 4: PASS**
- [ ] **Step 5: 프론트 mock/http 구현 + 테스트** (mock은 `evaluateMock` 재사용)
- [ ] **Step 6: Commit** `feat: batch objective test endpoint`

### Task 11: 목적함수 설계기 컴포넌트

**Files:** Create `frontend/src/components/objective/{BuilderPanel,PreviewCharts,ObjectiveDesigner,BatchApply,TrialRunButton}.tsx`, `ObjectiveDesigner.test.tsx`

**Interfaces:**
- Consumes: Task 5–7, 9, 10, `api.getTimeseries`, `api.createBatch`, `api.subscribeJob`, `api.listVariables`.
- Produces:
```tsx
<ObjectiveDesigner fmuId={string} value={{ name: string; code: string }} onChange={(v) => void} />
// 내부 상태 mode: 'builder' | 'code'. value.code를 parseBuilderCode → intact면 builder, 아니면 code.
// builder 모드에서 스펙이 바뀔 때마다 onChange({ name, code: generateCode(spec) }).
<TrialRunButton fmuId columns={string[]} onDone={(runId: string) => void} />
<BatchApply code fmuId />
```
  - BuilderPanel: 섹션 라벨 `파생 신호`, `트리거`, `구간`, `계산`, `후처리`. 신호 선택은 미리보기 run의 기록 컬럼 + 파생 신호 이름(Select, searchable). 임계값 등 `Num` 입력은 NumberInput + "파라미터" 토글(파라미터 이름 Select). 구간 종류에 따라 트리거 개수 자동 조정. mask 구간이면 overshoot/settling 비활성.
  - 오른쪽: 미리보기 run Select(이 FMU의 ok run, `listRuns({fmuId,status:'ok',limit:200})`), 큰 값 표시(`.fmuc-num`, `data-testid="builder-value"`) 또는 오류 Alert, 필요한 컬럼 Badge들, PreviewCharts(관련 신호마다 subplot 1개 — ECharts grid 여러 개, 공유 x축, `markLine` 트리거 시각, `markArea` 구간).
  - 미리보기 run이 없거나 필요한 컬럼을 기록한 run이 없으면 TrialRunButton: 라벨 `기본값으로 시험 실행`, 동작은 `listVariables(fmuId,{causality:'parameter',limit:500})`에서 type Real·start 숫자인 첫 변수로 `params: [{ name, mode: 'list', values: [start] }]`, `sampling: 'grid'`, `nSamples: null`, `fixedParams: {}`, `sim: defaultSimSettings(fmu.defaultExperiment)`, `recordVariables: columns`(time 제외), `plotVariables: []`, `workers: 1`, `runTimeoutSec: 600`, `name: '시험 실행 ' + HH:mm:ss`. 그런 파라미터가 없으면 비활성 + 툴팁 `"시험 실행에 쓸 수치 파라미터가 없습니다"`. 잡 끝나면 그 잡의 첫 ok run으로 `onDone`.
  - 코드 패널: 접힘 상태 기본, Monaco readOnly(builder) / 편집 가능(code). 버튼 `코드로 직접 편집`(→ code 모드), code 모드에서 헤더가 있으면 `빌더로 되돌리기`(확인 모달 `"직접 고친 코드가 사라집니다"`).
  - 호환성 박스: `jobCompat`/`summarize` → `"이 FMU 잡 N개 중 M개 호환"` + 누락 목록, 잡이 없으면 `fmuCompat` → `"기록 가능"`/`"FMU에 없는 변수: …"`. 누락 있으면 링크 `④ 실행에서 기록 변수에 추가` → `/fmus/:fmuId/run?tab=batch&record=<콤마 목록>` (BatchSetupPage가 `record` 쿼리를 읽어 기록 변수에 합치도록 수정 — 이 Task에 포함).
  - BatchApply: 버튼 `여러 run에 일괄 적용`(최근 ok run ≤200) → `testObjectiveBatch` → 히스토그램 + 오류 run 목록. 히스토그램은 이 Task에서 `lib/vizStats.ts`를 만들어 Task 13에 적힌 `histogram` 시그니처·테스트 그대로 먼저 구현한다 (Task 13은 나머지 함수만 추가).
- [ ] **Step 1: 실패 테스트** (mock client)
```tsx
test('예시 목적함수를 빌더로 만들면 값과 코드가 나온다', async () => { /* 트리거 cross up pedal 0.9, 구간 fromTrigger, 계산 delta x 선택 → builder-value 표시, 코드 패널에 '# fmuc-builder:' */ });
test('트리거가 안 걸리는 임계값이면 오류 문구', async () => { /* threshold 999 → '트리거 조건을 만족하는 시점이 없습니다' */ });
test('손으로 고친 빌더 코드는 코드 모드로 열린다', () => { /* value.code = generateCode(spec)+'\n# x' → '빌더로 되돌리기' 버튼 존재 */ });
test('run이 없으면 시험 실행 버튼', async () => { /* empty runs mock → '기본값으로 시험 실행' 클릭 → createBatch 호출 인자 검사(recordVariables, params 1개 list) */ });
```
  mock 픽스처에 pedal/x 같은 신호가 없으면 픽스처의 실제 컬럼명으로 맞춘다.
- [ ] **Step 2–4: FAIL → 구현 → PASS → Step 5: Commit** `feat(frontend): objective designer`

### Task 12: ③ 목적함수 단계와 라이브러리 화면

**Files:** Modify `frontend/src/pages/workspace/ObjectivesStep.tsx`, `frontend/src/pages/ObjectiveEditorPage.tsx`, `frontend/src/components/useWorkflowInput.ts`; Test `ObjectivesStep.test.tsx`, `ObjectiveEditorPage.test.tsx`(갱신)

- ObjectivesStep: 목록 표(이름, 해시 배지, 호환 배지 `M/N 잡` 또는 `기록 가능`/`비호환`, 빌더/코드 표시, 수정 시각). `새로 설계` → `/fmus/:fmuId/objectives/new` (이름 입력 + ObjectiveDesigner, 저장 시 `createObjective`), 행 클릭 → `/fmus/:fmuId/objectives/:id` (ObjectiveDesigner + 저장/삭제, 기존 SAVE_NOTE·미저장 이동 확인 유지).
- ObjectiveEditorPage(`/objectives`, 공용 라이브러리): 빌더 코드는 FMU 선택 Select를 띄워 ObjectiveDesigner로, 아니면 기존 Monaco + TestPanel. 새로 만들기는 빌더가 기본(`DEFAULT_SPEC`), 옆에 `빈 코드로 시작`.
- `useWorkflowInput`의 `nCompatibleObjectives` = 이 FMU 잡 기준 호환(잡 없으면 fmuCompat recordable) 목적함수 수.
- [ ] **Step 1: 실패 테스트** — 호환 배지 텍스트, 새로 설계 → 저장 → 목록에 나타남, 기존 ObjectiveEditorPage 테스트 갱신 후 통과.
- [ ] **Step 2–4: FAIL → 구현 → PASS → Step 5: Phase 2 전체 검증 → Step 6: Commit** `feat(frontend): objectives step with compatibility`

---

# Phase 3 — 시각화 작업대

### Task 13: 통계 함수 `lib/vizStats.ts`

**Files:** Create `frontend/src/lib/vizStats.ts`, `vizStats.test.ts` (기존 `lib/stats.ts`의 `boxStats`는 재사용, 이동하지 않음)

**Interfaces:**
```ts
export function histogram(xs: number[], bins?: number): { edges: number[]; counts: number[] };   // NaN·null 제외, 기본 bins = ceil(sqrt(n)) clamp 5..50
export function rank(xs: number[]): number[];                     // 동순위 평균
export function pearson(a: number[], b: number[]): number | null; // 쌍 중 하나라도 비유한이면 그 쌍 제외, 유효쌍<3 → null
export function spearman(a: number[], b: number[]): number | null;
export function corrMatrix(cols: Record<string, (number | null)[]>, method: 'pearson' | 'spearman'): { names: string[]; m: (number | null)[][] };
export function kde(xs: number[], at: number[], bandwidth?: number): number[];   // 가우시안, 기본 Silverman
export function idwGrid(pts: { x: number; y: number; z: number }[], nx: number, ny: number, power?: number): { xs: number[]; ys: number[]; z: number[][] };
export function fft(signal: number[], dt: number): { freq: number[]; amp: number[] };  // 길이를 2의 거듭제곱으로 zero-pad, 단측 진폭
export function bestSoFar(values: (number | null)[], dir: 'minimize' | 'maximize'): (number | null)[];
export function band(series: number[][]): { mean: number[]; min: number[]; max: number[] };   // 같은 길이 가정
export function resampleTo(t: number[], y: number[], grid: number[]): number[];  // 선형 보간
```
- [ ] **Step 1: 실패 테스트** — 각 함수 1~2개, null/NaN 포함 입력 케이스 필수 (Review Focus 4): `pearson([1,2,null,4],[2,4,6,8])` 유효쌍 3 → 1; `histogram([])` → counts 빈 배열; `fft` 사인 5Hz → 최대 진폭 주파수 ≈5; `bestSoFar([3,null,1,2],'minimize')` → `[3,3,1,1]`; spearman 단조 비선형 → 1.
- [ ] **Step 2–4: FAIL → 구현 → PASS → Step 5: Commit** `feat(frontend): visualization statistics helpers`

### Task 14: `dashboard` 프리셋 종류

**Files:** Modify `backend/app/schemas.py`, `backend/tests/test_presets.py`, `frontend/src/api/types.ts`, `frontend/src/api/mock/mockClient.ts`, `frontend/src/lib/presets.ts`(kind 분기 영향 시), `frontend/src/pages/PresetsPage.tsx`(종류 라벨 `대시보드`)

**Interfaces:**
- Python: `class DashboardPresetConfig(CamelModel): layout: Literal["1x1","1x2","2x2","2x3","3x2","3x3"] = "2x2"; sync_time_zoom: bool = True; panels: list[dict] = []` — 패널 내용은 프론트 소유라 dict 그대로. `PRESET_CONFIGS["dashboard"]`, `PresetKind`에 `"dashboard"`. `PresetRunConfig`를 상속하지 않으므로 `PRESET_CONFIGS` 타입을 `dict[str, type[CamelModel]]`로.
  - `catalog.config_candidate_ids()` 등 프리셋 config를 순회하는 코드가 dashboard를 만나도 깨지지 않는지 확인 (grep `PRESET_CONFIGS`, `kind ==`).
- TS: `DashboardPresetConfig = { layout: DashboardLayout; syncTimeZoom: boolean; panels: PanelSpec[] }` (`PanelSpec`은 Task 15 `lib/workbench.ts`에서 정의하고 types.ts에서 re-export 하지 말고 types.ts에는 `panels: unknown[]`, 사용처에서 `parsePanels`로 검증). `PresetConfigs`에 `dashboard` 추가.
- [ ] **Step 1: 실패 테스트 (pytest)** — dashboard 생성·조회·`kind=dashboard` 필터, 잘못된 layout → 422.
- [ ] **Step 2–4: FAIL → 구현 → PASS (pytest + npm test + tsc) → Step 5: Commit** `feat: dashboard preset kind`

### Task 15: 작업대 틀

**Files:** Create `frontend/src/lib/workbench.ts`, `workbench.test.ts`, `frontend/src/components/workbench/{Workbench,Panel,PanelEditor,SelectionContext,useWorkbenchData}.tsx|ts`, `Workbench.test.tsx`

**Interfaces:**
```ts
// lib/workbench.ts
export type ChartKind =
  | 'scatter' | 'scatterMatrix' | 'parallel' | 'histogram' | 'boxViolin' | 'corrHeatmap' | 'radar' | 'bar'
  | 'contour' | 'tornado' | 'slice1d' | 'scatter3d' | 'surface3d'
  | 'convergence' | 'pareto' | 'importance' | 'trialOverview'
  | 'tsSubplots' | 'tsOverlay' | 'tsBand' | 'tsDiff' | 'phase' | 'fft';
export type FieldRef = { kind: 'param' | 'objective'; name: string } ;   // 목적함수는 이름으로 (프리셋 이식성)
export type PanelSpec = {
  id: string; title: string; chart: ChartKind;
  x?: FieldRef; y?: FieldRef; z?: FieldRef; color?: FieldRef | { kind: 'job' | 'variant' }; size?: FieldRef;
  fields?: FieldRef[];          // scatterMatrix/parallel/corrHeatmap/radar/tornado/importance
  groupBy?: 'job' | 'variant';  // boxViolin/bar
  vars?: string[];              // 시계열 변수
  refRunId?: string;            // tsDiff
  objectiveDir?: 'minimize' | 'maximize';
  violin?: boolean; method?: 'pearson' | 'spearman';
};
export const CHART_LABELS: Record<ChartKind, string>;   // 한국어 이름
export const CHART_GROUPS: { label: string; charts: ChartKind[] }[];  // 'run 단위 값','응답면·민감도','최적화','시계열'
export function layoutDims(l: DashboardLayout): { rows: number; cols: number };
export function parsePanels(raw: unknown[]): PanelSpec[];     // 형식 안 맞는 항목은 버림
export function missingRefs(p: PanelSpec, ctx: { params: string[]; objectives: string[]; vars: string[] }): string[];
export function defaultDashboard(): DashboardPresetConfig;    // 2x2: scatter, parallel, tsSubplots, corrHeatmap
// SelectionContext
export const SelectionProvider; export function useSelection(): { selected: string[]; set(ids: string[]): void; toggle(id: string): void };
// useWorkbenchData(fmuId, filter) → { rows: RunRow[]; objectives: { id; name }[]; params: string[]; vars: string[]; jobs: Job[]; variants: Variant[]; isLoading }
//   rows = listRuns({...filter, objectiveIds: 전체 목적함수 id, limit: 100000}); vars = 필터된 잡들의 recordVariables 합집합 (빈 목록이면 FMU outputs)
// Panel: props { spec, data, onEdit, onRemove }; chart 함수 = CHART_BUILDERS[spec.chart](spec, data, selected) → EChartsOption | { empty: string }
```
  - Workbench: 툴바(레이아웃 SegmentedControl, `시간축 줌 동기화` Switch, `패널 추가` 메뉴 = CHART_GROUPS, `레이아웃 저장`/`불러오기` = PresetMenuBar 패턴의 dashboard 프리셋), Mantine `SimpleGrid cols` 격자, 패널 최대화 모달.
  - 패널 헤더: 제목, 편집(PanelEditor 드로어: 차트 종류·필드 매핑), PNG 내보내기(`echartsInstance.getDataURL({ pixelRatio: 2, backgroundColor })`), CSV 내보내기(패널에 쓰인 run 행 + 필드), 삭제.
  - 연동: 산점도류는 `brush`/`click` 이벤트 → `useSelection().set/toggle`; 선택 run은 다른 패널에서 강조(나머지 opacity 0.15). 시계열 패널은 선택 run(없으면 처음 5개, 최대 50개)을 그림.
  - 줌 동기화: 시계열 패널의 echarts 인스턴스에 같은 `group`을 주고 `echarts.connect(group)`.
  - 누락 참조: `missingRefs`가 비지 않으면 차트 대신 `찾을 수 없음: a, b` (Review Focus 5).
  - `CHART_BUILDERS`는 이 Task에서 `lib/charts/index.ts`에 빈 레지스트리로 만들고, 등록 안 된 종류는 `{ empty: '준비 중' }`. Task 16–19가 채운다.
- [ ] **Step 1: 실패 테스트** — `parsePanels` 잘못된 항목 제거, `missingRefs`, `layoutDims('2x3')`; Workbench 렌더: 기본 4패널 제목 보임, 패널 추가 메뉴로 'histogram' 추가 → 5개, 다른 FMU 변수 참조 프리셋 로드 → `찾을 수 없음:` 텍스트.
- [ ] **Step 2–4: FAIL → 구현 → PASS → Step 5: Commit** `feat(frontend): workbench frame with linked selection`

### Task 16: run 단위 차트 8종 `lib/charts/scalar.ts`

**Files:** Create `frontend/src/lib/charts/scalar.ts`, `scalar.test.ts`; register in `lib/charts/index.ts`

**Interfaces:** 각 `(spec: PanelSpec, data: WorkbenchData, selected: string[]) => EChartsOption | { empty: string }` — `scatter`, `scatterMatrix`(fields ≤6, n×n grid), `parallel`, `histogram`, `boxViolin`(boxStats + kde 폴리곤 custom series), `corrHeatmap`(corrMatrix, visualMap -1..1), `radar`(선택 run ≤8, 필드별 min-max 정규화), `bar`(groupBy별 평균 ± std).
- 공통: 값 추출은 `fieldValue(row, ref, objectives)` 헬퍼(목적함수 이름→id 매핑) — null은 제외, 유효점 0이면 `{ empty: '값 없음' }`. 데이터 각 점의 `name`/`id`에 run id를 넣어 선택 이벤트가 run id를 돌려주게.
- [ ] **Step 1: 실패 테스트** — 차트별 1개: 시리즈 개수/데이터 길이, null 섞인 행 제외, 전부 null → `{ empty: '값 없음' }`, scatterMatrix 3필드 → grid 9개, radar 선택 0개 → `{ empty: '비교할 run을 선택하세요' }`.
- [ ] **Step 2–4 → Step 5: Commit** `feat(frontend): run-level charts`

### Task 17: 응답면·민감도 차트 `lib/charts/surface.ts`

**Interfaces:** `contour`(idwGrid 40×40 → heatmap + 원 데이터 scatter), `tornado`(목적함수 y 하나 vs fields 각각 spearman, |ρ| 내림차순 가로 막대, 양/음 색), `slice1d`(x 파라미터 구간 10개로 나눠 y 평균·범위), `scatter3d`, `surface3d`(idwGrid → `surface` series) — 3D 두 개는 `import 'echarts-gl'`를 이 파일에서 하고 vitest에서는 옵션 객체만 검사.
- [ ] **Step 1: 실패 테스트** — tornado 정렬·부호, contour heatmap 데이터 1600점, 3D series type이 `scatter3D`/`surface`.
- [ ] **Step 2–4 → Step 5: Commit** `feat(frontend): response surface and sensitivity charts`

### Task 18: 최적화 차트 `lib/charts/optimization.ts`

**Interfaces:** `convergence`(x=run index, 산점 + bestSoFar 계단선, objectiveDir), `pareto`(목적함수 2개 → 2D, 3개 → scatter3D; 기존 `lib/pareto.ts` 사용, 프런트 점 강조·연결선), `importance`(설계변수별 |spearman| 막대, 합 1로 정규화), `trialOverview`(x=index, y=elapsedSec 막대, 실패는 빨강).
  잡 필터가 최적화 잡이 아니면 convergence/pareto/importance도 그대로 동작(배치에도 의미 있음) — 제한 없음.
- [ ] **Step 1–4 → Step 5: Commit** `feat(frontend): optimization charts`

### Task 19: 시계열 차트 `lib/charts/timeseries.ts` + 데이터 훅

**Files:** Create `lib/charts/timeseries.ts`, `timeseries.test.ts`, `components/workbench/useTimeseriesData.ts`

**Interfaces:**
- `useTimeseriesData(runIds: string[], vars: string[]): { byRun: Record<string, Timeseries>; isLoading; error }` — `useQueries` + `getTimeseries(runId, vars, 2000)`, 기존 키 `['timeseries', runId, vars]`.
- 옵션 빌더는 `(spec, data, selected, ts: Record<string, Timeseries>)`:
  - `tsSubplots`: 변수마다 grid 1개(세로 쌓기), 공유 x(`axisPointer.link`), 선택 run 겹침.
  - `tsOverlay`: 변수 1개, run마다 선, `color` 필드 있으면 파라미터 값 → visualMap 그라데이션.
  - `tsBand`: 공통 시간 격자(첫 run time)로 `resampleTo` → `band` → 평균선 + min/max 영역(stack 트릭).
  - `tsDiff`: `refRunId`(없으면 선택 첫 run) 기준 `y - y_ref` (격자 맞춤).
  - `phase`: vars[0] vs vars[1] XY 선.
  - `fft`: vars[0], 비균일 간격이면 평균 dt 격자로 `resampleTo` 후 `fft`, 진폭 스펙트럼 선형 y축.
- [ ] **Step 1: 실패 테스트** — subplots grid 수 = vars 수, band 길이, diff 기준 run은 0선, phase 데이터 쌍, fft 피크.
- [ ] **Step 2–4 → Step 5: Commit** `feat(frontend): timeseries charts`

### Task 20: ⑤ 결과 분석 단계 통합

**Files:** Modify `frontend/src/pages/workspace/ResultsStep.tsx`, `frontend/src/pages/ResultsPage.tsx`(필터 바·RunTable 부분을 `components/ResultsFilters.tsx`로 추출해 공유), `ResultsPage.test.tsx`; Create `ResultsStep.test.tsx`

- ResultsStep: 상단 필터(잡/variant/상태/목적함수) → Tabs `작업대`(기본) / `결과 표`(기존 RunTable·CSV·페이지네이션). 선택 run은 SelectionContext로 두 탭 공유 (RunTable 체크박스 ↔ 작업대 선택).
- `/fmus/:fmuId/results` 라우트가 ResultsStep을 렌더 (기존 ResultsPage 테스트는 결과 표 탭 기준으로 갱신).
- [ ] **Step 1: 실패 테스트** — 기본 작업대 4패널 렌더, 결과 표에서 run 체크 → 작업대 탭 시계열 패널 범례에 그 run 라벨, 대시보드 저장 → `listPresets({kind:'dashboard'})`에 존재.
- [ ] **Step 2–4: FAIL → 구현 → PASS**
- [ ] **Step 5: 최종 검증** — Global Constraints의 4개 명령 전부 + `.\run.ps1 -Build` 후 브라우저에서 홈 → FMU → ③ 예시 목적함수(시험 실행 포함) → ④ 배치 → ⑤ 작업대 흐름을 직접 확인 (실제 FMU `my_0test_DriveCycleAT.fmu`).
- [ ] **Step 6: README.md, CLAUDE.md 구조 절 갱신** (새 폴더 `pages/workspace/`, `lib/builder/`, `lib/charts/`, `components/workbench/`, `components/objective/`; React Query 키 변경 없음 확인)
- [ ] **Step 7: Commit** `feat(frontend): results step with workbench; docs`
