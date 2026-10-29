# FMU Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FMU 파라미터를 병렬로 바꿔가며 배치 해석·(다목적) 최적화하고, 파라미터와 시계열을 FMU별 DB에 누적하며, GUI에서 편집한 Python 목적함수(파일 1개 = 스칼라 1개)를 조회 시점의 최신 코드로 계산해 결과를 조회·비교하는 로컬 웹 앱.

**Architecture:** `frontend/`(React SPA)는 `src/api/` 의 단일 `ApiClient` 인터페이스로만 서버와 통신한다. Phase 1에서는 mock 구현으로 모든 화면을 완성하고, Phase 2에서 백엔드 기능을 하나씩 구현하며 도메인별로 mock → http 로 전환한다. `backend/`(FastAPI)는 SQLite에 FMU·잡·run(파라미터) 메타데이터를, 파일시스템(`data/`)에 FMU 원본·시계열(Parquet)·목적함수(.py)를 저장한다. **목적함수 값은 영속 저장하지 않으며**, 조회 요청 시 현재 코드로 계산하고 `(run_id, code_hash)` 키의 메모리 캐시로만 재사용한다. FMU 제어는 FMPy로 하고, 병렬 처리(시뮬레이션·목적함수 평가)는 공통 `ParallelExecutor` 인터페이스를 거친다. 기본 구현은 Ray이며, Ray를 import하거나 초기화할 수 없으면 `multiprocessing.Pool` 구현으로 폴백한다.

**Tech Stack:**
- Frontend: Node 24, Vite + React 18 + TypeScript, react-router v6, TanStack Query v5, Mantine v7, `@monaco-editor/react`, ECharts(`echarts-for-react`), Vitest + React Testing Library
- Backend: Python 3.12 (miniconda env `backend/.venv`), FastAPI, uvicorn, FMPy (FMU 제어, CVode, ModelExchange), Ray (병렬, 폴백: `multiprocessing.Pool`), SQLAlchemy 2.x + SQLite, pandas + pyarrow(Parquet), Optuna(단일/다목적 최적화), sse-starlette(진행 이벤트), pytest + httpx

**Spec:** `docs/superpowers/specs/2026-10-29-fmu-controller-requirements.md`

## Global Constraints

- 진행 순서: Phase 1(UI, mock) 전체 완료 → Phase 2(백엔드) 기능별 순차. 각 백엔드 Task 끝에서 해당 도메인의 프론트 mock을 http로 전환하고 실서버로 UI가 동작하는지 확인한다.
- **FMU 제어는 Python FMPy 라이브러리만 사용.** 대상 FMU는 FMI 2.0 **ModelExchange 전용** → 시뮬레이션은 `fmpy.simulate_fmu(..., fmi_type="ModelExchange", solver="CVode")`.
- **병렬 처리는 Ray 사용, 불가능하면 `multiprocessing.Pool`로 폴백.** 선택은 환경변수 `FMUC_PARALLEL=auto|ray|pool`(기본 `auto`): `auto`는 `import ray` + `ray.init(include_dashboard=False)`를 시도하고 실패하면 사유를 로그에 남긴 뒤 Pool을 쓴다. `ray`를 명시했는데 실패하면 기동 에러. 잡 러너·최적화·목적함수 평가는 `ParallelExecutor` 인터페이스만 사용하고 `ray`/`multiprocessing`을 직접 import하지 않는다. 현재 백엔드는 `GET /api/health`의 `parallelBackend`(`"ray"|"pool"`)로 노출하고 UI 헤더에 표시한다.
- **목적함수 파일 1개 = 지표 1개.** 계약: `def evaluate(result: pandas.DataFrame, params: dict) -> float` — `result`는 `time` 컬럼 + 기록 변수 컬럼. 반환은 실수 스칼라(int/float/numpy 실수 허용, bool·문자열·dict 등은 에러). 지표명 = 목적함수 이름. 다목적 최적화는 목적함수 파일 N개를 선택해 수행한다.
- **DB(app.db)에는 목적함수 값을 저장하지 않는다.** 저장 대상은 FMU, 변수, 목적함수 메타(이름·코드 해시), 잡, run(파라미터·상태·Parquet 경로)뿐. 배치 잡은 목적함수를 계산하지 않는다.
- **목적함수 값은 항상 현재(최신) 코드로 계산해 보여준다.** 목적함수 코드는 버전 이력 없이 최신본 1개만 유지. 계산값 재사용은 메모리 캐시 키 `(run_id, sha256(code))`로만 하며, 코드가 바뀌면 자동으로 무효화된다. 모든 값 응답에는 계산에 쓴 `codeHash`를 함께 내려 UI에 표시한다.
- 최적화는 제출 시점 코드의 스냅샷(코드 + 해시)으로 진행한다(실행 중 편집해도 최적화 일관성 유지). 잡에는 스냅샷 해시만 메타데이터로 기록하고, 조회 시 현재 해시와 다르면 UI에 경고 "최적화 실행 당시와 목적함수 코드가 다릅니다. 표시된 값은 현재 코드 기준입니다."를 표시한다.
- 서버는 `127.0.0.1`에만 바인딩한다 (목적함수 .py는 임의 코드 실행이므로 로컬 단일 사용자 전제).
- 앱이 쓰는 모든 저장 경로는 ASCII만 사용: `backend/data/fmus/<fmu_id>.fmu`, `backend/data/extract/<fmu_id>/`, `backend/data/results/<job_id>/<run_id>.parquet`, `backend/data/objectives/<objective_id>.py`, `backend/data/app.db`. (원본 FMU 경로에 한글 "복사본"이 포함돼 있어 DLL 로딩 문제 회피 목적)
- FMU 동일성 = 파일 SHA-256. `fmu_id` = SHA-256 hex 앞 16자. 같은 내용 재업로드 시 기존 레코드 반환. "동일 FMU 기준 누적"은 이 `fmu_id` 단위.
- 기본 기록 변수 = FMU의 `causality="output"` 변수 전체(140개). 사용자가 추가/제거 가능.
- UI 문구는 한국어, 변수명·목적함수명은 원문 그대로.
- 프론트 컴포넌트는 `fetch`를 직접 호출하지 않는다. 오직 `useApi()`가 돌려주는 `ApiClient` 사용.

## Review Focus

1. **특정 파라미터 조합에서 시뮬레이션이 실패하거나 멈춤** → 해당 run만 `failed`(에러 메시지 저장)로 표시되고 잡은 계속 진행; run당 타임아웃(`runTimeoutSec`, 기본 600) 초과 시 워커 프로세스 종료 후 `failed: timeout`. (Task 12 테스트)
2. **목적함수 코드 수정 직후 결과 화면/최적화 잡 조회** → 이전 코드로 계산된 값이 절대 보이지 않고 새 코드로 재계산된 값과 새 `codeHash`가 표시됨; 최적화 잡은 스냅샷 해시와 다르면 경고 표시. (Task 11, 13, 14 테스트, Task 4·6 UI 테스트)
3. **목적함수 코드가 예외/무한루프/잘못된 반환(dict, 문자열, bool, None, NaN)** → 해당 run의 값만 `null` + 에러 메시지, 다른 run 계산은 계속; 무한루프는 run당 10초 타임아웃; 최적화에서는 실패 trial로 보고. (Task 11, 13 테스트)
4. **한글/공백이 들어간 원본 경로에서 업로드한 FMU** → 저장·압축해제는 ASCII 경로로만 이뤄져 정상 시뮬레이션. (Task 9, 10 테스트)
5. **잡 실행 중 서버 재시작** → 시작 시 `running`/`queued` 잡을 `failed`(사유 `interrupted`)로 정리, 완료된 run의 시계열은 보존되고 목적함수 값은 재계산되어 조회 가능. (Task 12 테스트)

---

## API 계약 (Phase 1·2 공통)

프론트 `frontend/src/api/types.ts`와 백엔드 `backend/app/schemas.py`는 아래 형태를 그대로 쓴다 (JSON 필드명 camelCase; 백엔드는 Pydantic `alias_generator=to_camel`).

```ts
type FmuSummary = { id: string; fileName: string; modelName: string; guid: string; fmiVersion: string;
  fmiTypes: ('ModelExchange'|'CoSimulation')[]; generationTool: string;
  defaultExperiment: { startTime: number; stopTime: number; tolerance: number | null };
  nParameters: number; nOutputs: number; nVariables: number; uploadedAt: string; nRuns: number };
type Variable = { name: string; valueReference: number; causality: string; variability: string;
  type: 'Real'|'Integer'|'Boolean'|'String'|'Enumeration'; start: number|boolean|string|null;
  unit: string|null; description: string|null };
type Page<T> = { total: number; items: T[] };

type SimSettings = { startTime: number; stopTime: number; tolerance: number; outputInterval: number };
type SweepParam = { name: string; mode: 'list'; values: number[] }
                | { name: string; mode: 'range'; min: number; max: number; steps: number };
type BatchRequest = { name: string; fmuId: string; params: SweepParam[];
  sampling: 'grid'|'zip'|'lhs'|'random'; nSamples: number | null; fixedParams: Record<string, number|boolean>;
  sim: SimSettings; recordVariables: string[]; workers: number; runTimeoutSec: number };   // 목적함수 없음
type DesignVar = { name: string; min: number; max: number; kind: 'float'|'int' };
type OptObjective = { objectiveId: string; direction: 'minimize'|'maximize' };
type OptimizationRequest = { name: string; fmuId: string; designVars: DesignVar[];
  objectives: OptObjective[];                                   // 1개 = 단일, 2개 이상 = 다목적
  algorithm: 'tpe'|'cmaes'|'random'|'nsga2';                    // cmaes는 단일목적 전용
  nTrials: number; fixedParams: Record<string, number|boolean>;
  sim: SimSettings; recordVariables: string[]; workers: number; runTimeoutSec: number };

type JobStatus = 'queued'|'running'|'done'|'failed'|'cancelled';
type Job = { id: string; kind: 'batch'|'optimization'; name: string; fmuId: string; status: JobStatus;
  total: number; completed: number; failed: number; createdAt: string; finishedAt: string|null;
  error: string|null; config: BatchRequest | OptimizationRequest;
  objectiveSnapshot: Record<string, { name: string; codeHash: string }> | null };  // optimization만, 값 아님
type Run = { id: string; jobId: string; fmuId: string; index: number; params: Record<string, number|boolean>;
  status: 'ok'|'failed'; error: string|null; elapsedSec: number };
type JobEvent = { type: 'progress'; job: Job } | { type: 'run'; run: Run } | { type: 'end'; job: Job };

type Objective = { id: string; name: string; code: string; codeHash: string; updatedAt: string };
type ObjectiveValue = { value: number | null; error: string | null };
type ObjectiveTestResult = ObjectiveValue & { stdout: string; durationMs: number };
type RunQuery = { fmuId?: string; jobIds?: string[]; status?: 'ok'|'failed';
  objectiveIds?: string[];                                       // 지정 시 현재 코드로 계산해 함께 반환
  sortBy?: 'index'|'elapsedSec'|`param:${string}`|`objective:${string}`; sortDir?: 'asc'|'desc';
  offset?: number; limit?: number };
type RunRow = Run & { objectives: Record<string, ObjectiveValue> };   // objectiveId → 값
type RunPage = Page<RunRow> & { codeHashes: Record<string, string> }; // 계산에 쓴 objectiveId → codeHash
type Timeseries = { time: number[]; series: Record<string, number[]> };
```

| 메서드 (`ApiClient`) | HTTP |
|---|---|
| `health(): {status, parallelBackend: 'ray'\|'pool'}` | `GET /api/health` |
| `listFmus(): FmuSummary[]` | `GET /api/fmus` |
| `uploadFmu(file: File): FmuSummary` | `POST /api/fmus` (multipart `file`) |
| `getFmu(id)` / `deleteFmu(id)` | `GET` / `DELETE /api/fmus/{id}` |
| `listVariables(fmuId, {q, causality, offset, limit}): Page<Variable>` | `GET /api/fmus/{id}/variables` |
| `listObjectives()` / `getObjective(id)` | `GET /api/objectives`, `GET /api/objectives/{id}` |
| `createObjective({name, code})` / `updateObjective(id, {name, code})` / `deleteObjective(id)` | `POST /api/objectives`, `PUT`/`DELETE /api/objectives/{id}` |
| `testObjective({code, runId}): ObjectiveTestResult` | `POST /api/objectives/test` (저장 전 코드로 1개 run 계산) |
| `createBatch(req): Job` / `createOptimization(req): Job` | `POST /api/jobs/batch`, `POST /api/jobs/optimization` |
| `listJobs({fmuId?}): Job[]` / `getJob(id)` / `cancelJob(id)` | `GET /api/jobs`, `GET /api/jobs/{id}`, `POST /api/jobs/{id}/cancel` |
| `subscribeJob(id, onEvent): () => void` | `GET /api/jobs/{id}/events` (SSE) |
| `listRuns(q: RunQuery): RunPage` | `GET /api/runs` (`jobIds`, `objectiveIds`는 콤마 구분) |
| `getTimeseries(runId, vars, maxPoints=2000): Timeseries` | `GET /api/runs/{id}/timeseries?vars=a,b&maxPoints=` |

---

## File Structure

```
fmu_controller/
  frontend/
    package.json, vite.config.ts, tsconfig.json, index.html
    scripts/gen_mock_fixtures.py        # modelDescription.xml → mock fixture JSON
    src/
      main.tsx, App.tsx                  # 라우팅 + AppShell(사이드 내비)
      api/types.ts                       # 위 계약
      api/client.ts                      # ApiClient 인터페이스, ApiProvider, useApi()
      api/mock/mockClient.ts             # 메모리 기반 mock 구현 (잡 진행·목적함수 계산 흉내)
      api/mock/fixtures/*.json
      api/http/httpClient.ts             # fetch/EventSource 구현
      api/select.ts                      # 도메인별 mock/http 선택 (VITE_API_<DOMAIN>=mock|http)
      lib/sweep.ts                       # 케이스 수 계산·미리보기
      lib/pareto.ts                      # 비지배해 판정 (UI 강조용)
      components/VariablePicker.tsx      # 검색+페이지네이션 변수 선택기 (공용)
      components/ObjectivePicker.tsx     # 목적함수 다중 선택 + 현재 codeHash 표시
      components/CodeHashBadge.tsx, StaleSnapshotAlert.tsx
      components/TimeseriesChart.tsx, ScatterChart.tsx, JobStatusBadge.tsx, SimSettingsForm.tsx
      pages/FmuListPage.tsx, FmuDetailPage.tsx
      pages/BatchSetupPage.tsx, OptimizationSetupPage.tsx
      pages/ObjectiveEditorPage.tsx
      pages/JobListPage.tsx, JobMonitorPage.tsx
      pages/ResultsPage.tsx              # FMU별 누적 결과 + 비교
      test/setup.ts, **/*.test.tsx
  backend/
    pyproject.toml
    app/main.py                          # FastAPI 앱, 라우터, 정적 프론트 서빙, startup 정리
    app/config.py                        # DATA_DIR 등 경로 설정 (ASCII 강제)
    app/db.py, app/models.py             # SQLAlchemy 엔진/세션, ORM 테이블
    app/schemas.py                       # Pydantic (camelCase alias)
    app/fmu/registry.py                  # 업로드·해시·modelDescription 파싱·변수 조회
    app/fmu/simulate.py                  # 단일 run 실행 (워커 프로세스에서 호출)
    app/objectives/store.py              # .py 파일 CRUD (최신본만), code_hash
    app/objectives/worker.py             # 워커에서 실행되는 evaluate_item() (최상위 함수, 피클 가능)
    app/objectives/evaluator.py          # Evaluator: ParallelExecutor로 분산 + (run_id, code_hash) 메모리 캐시
    app/parallel/base.py                 # ParallelExecutor 프로토콜, TaskHandle, TaskTimeout, create_executor()
    app/parallel/ray_backend.py          # RayExecutor
    app/parallel/pool_backend.py         # PoolExecutor (multiprocessing.Pool 폴백)
    app/jobs/sampling.py                 # grid/zip/lhs/random 케이스 생성
    app/jobs/runner.py                   # JobManager: 프로세스 풀, 진행 이벤트, 취소
    app/jobs/optimize.py                 # Optuna ask/tell 루프 (단일/다목적)
    app/results/storage.py               # Parquet 저장/읽기/다운샘플
    app/routers/fmus.py, objectives.py, jobs.py, runs.py
    tests/conftest.py                    # 임시 DATA_DIR, TestClient, 실 FMU fixture
    tests/test_*.py
  docs/superpowers/{specs,plans}/
```

**DB 테이블 (`app/models.py`) — 목적함수 값 컬럼/테이블 없음**
- `fmus(id PK, file_name, model_name, guid, fmi_version, fmi_types JSON, generation_tool, default_experiment JSON, n_parameters, n_outputs, n_variables, uploaded_at)`
- `variables(fmu_id FK, name, value_reference, causality, variability, type, start TEXT(JSON), unit, description)` — 인덱스 `(fmu_id, causality)`, `(fmu_id, name)`
- `objectives(id PK, name UNIQUE, code_hash, updated_at)` — 코드는 `data/objectives/<id>.py` 최신본 1개
- `jobs(id PK, kind, name, fmu_id FK, status, total, completed, failed, config JSON, objective_snapshot JSON NULL, error, created_at, finished_at)`
- `runs(id PK, job_id FK, fmu_id FK, index, params JSON, status, error, elapsed_sec, result_path)`

---

## Task 0: 실행 가능성 확인 (spike — git init과 문서 커밋 외에는 코드 커밋 없음)

UI 설계가 의존하는 가정(FMPy로 이 ME FMU가 Python 3.12에서 돌아가는지, 1회 해석 시간)을 먼저 검증한다.

- [ ] **Step 1:** 저장소 초기화 — `git init`, `.gitignore`에 `node_modules/`, `backend/data/`, `__pycache__/`, `.venv/`, `*.zip`, `my_0test_DriveCycleAT - 복사본/` 추가 후 문서만 커밋.
- [ ] **Step 2:** `conda create -p backend/.venv -c conda-forge python=3.12 pip` (완료됨) 후 `backend/.venv/python.exe -m pip install`로 `pip install fmpy optuna pyarrow sqlalchemy sse-starlette uvicorn python-multipart pytest httpx`, 이어서 `pip install "ray[default]"`를 따로 실행. fmpy 등 필수 패키지 설치가 실패하면 중단하고 사용자에게 보고 . **Ray만 실패하면 계속 진행**하되(Pool 폴백 경로), ledger에 기록하고 Pool 폴백으로 진행한다.
- [ ] **Step 2b:** Ray가 설치됐다면 스크래치 스크립트로 `ray.init(include_dashboard=False)` → `@ray.remote` 함수 안에서 Step 3의 짧은 시뮬레이션 2건을 동시에 실행. 결과(성공 여부, 초기화 시간)를 "측정값"에 기록.
- [ ] **Step 3:** 스크래치 스크립트로 FMU를 ASCII 임시 경로에 복사 후 `simulate_fmu(path, fmi_type="ModelExchange", solver="CVode", stop_time=20, output_interval=0.1)` 실행.
  Expected: 예외 없이 결과 배열 반환. 라이선스/DLL 오류 시 중단하고 보고.
- [ ] **Step 4:** `stop_time=1400` 전체 해석 시간 측정, 출력에 즉시 영향을 주는 파라미터 1개 선정 → 하단 "측정값"에 기록.

---

# Phase 1 — UI (mock API)

### Task 1: 프론트엔드 스캐폴드 + API 계층 + mock 기반

**Files:**
- Create: `frontend/` (Vite react-ts 템플릿), `frontend/src/api/{types,client,select}.ts`, `frontend/src/api/mock/mockClient.ts`, `frontend/scripts/gen_mock_fixtures.py`, `frontend/src/api/mock/fixtures/{fmus,variables}.json`, `frontend/src/App.tsx`, `frontend/src/test/setup.ts`
- Test: `frontend/src/api/mock/mockClient.test.ts`, `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `interface ApiClient` (API 계약 표의 메서드 전부, 모두 `Promise` 반환, `subscribeJob`만 동기 unsubscribe 반환), `ApiProvider({client, children})`, `useApi(): ApiClient`, `createMockClient(opts?: {tickMs?: number}): ApiClient`, `createClient(): ApiClient`(select.ts). 라우트: `/fmus`, `/fmus/:fmuId`, `/fmus/:fmuId/batch`, `/fmus/:fmuId/optimize`, `/fmus/:fmuId/results`, `/objectives`, `/objectives/:objectiveId`, `/jobs`, `/jobs/:jobId`.

- [ ] **Step 1:** `npm create vite@latest frontend -- --template react-ts`, 의존성 설치(@mantine/core @mantine/hooks @mantine/dropzone @mantine/notifications @tanstack/react-query react-router-dom @monaco-editor/react echarts echarts-for-react; dev: vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom). `package.json`에 정확한 버전 고정.
- [ ] **Step 2:** `gen_mock_fixtures.py <modelDescription.xml> <outdir>` 작성: FMU 요약 1건 + 변수 fixture(파라미터 300개 + 출력 140개 전부)를 JSON으로 출력. 실 FMU의 modelDescription으로 실행해 fixture 생성.
- [ ] **Step 3: 실패하는 테스트 작성** (`mockClient.test.ts`, fake timers)

```ts
test('listVariables filters and paginates', async () => {
  const api = createMockClient();
  const p = await api.listVariables(FMU_ID, { q: 'road.stop', causality: 'parameter', offset: 0, limit: 5 });
  expect(p.items).toHaveLength(5);
  expect(p.items.every(v => v.name.includes('road.stop') && v.causality === 'parameter')).toBe(true);
  expect(p.total).toBeGreaterThan(5);
});
test('batch job progresses to done and emits run events', async () => {
  const api = createMockClient({ tickMs: 10 });
  const job = await api.createBatch(batchReq({ params: [{ name: 'p', mode: 'list', values: [1, 2, 3] }] }));
  const events: JobEvent[] = [];
  api.subscribeJob(job.id, e => events.push(e));
  await vi.advanceTimersByTimeAsync(200);
  expect(events.filter(e => e.type === 'run')).toHaveLength(3);
  expect(events.at(-1)).toMatchObject({ type: 'end', job: { status: 'done', completed: 3 } });
});
test('listRuns computes objectives with current code and reports codeHash', async () => {
  // 목적함수 생성 → listRuns({objectiveIds:[id]}) 값 v1, codeHashes[id]=h1
  // updateObjective로 코드 변경 → 다시 listRuns → codeHashes[id] !== h1, 값이 새 코드 기준
});
test('optimization job stores objectiveSnapshot', ...);  // job.objectiveSnapshot[id].codeHash === 제출 시점 해시
test('cancelJob stops progress with status cancelled', ...);
test('testObjective returns error when code lacks evaluate', ...); // error === 'evaluate 함수가 정의되지 않았습니다'
```

- [ ] **Step 4:** `npx vitest run src/api` → FAIL 확인.
- [ ] **Step 5:** `mockClient.ts` 구현 — 메모리 Map 저장, 잡은 `setInterval(tickMs)`로 run을 하나씩 생성. mock 목적함수 값은 `hash(code + runId)`에서 결정적으로 만든 수(코드가 바뀌면 값도 바뀜), `codeHash`는 코드 문자열의 간단 해시. 시계열은 sin/노이즈 합성. `select.ts`는 `VITE_API_FMUS|OBJECTIVES|JOBS|RUNS` 각각 `mock|http`(기본 mock).
- [ ] **Step 6:** `App.tsx` — Mantine `AppShell` 사이드 내비(FMU / 목적함수 / 잡), 위 라우트에 빈 페이지 연결. `App.test.tsx`: 각 내비 클릭 시 해당 페이지 제목 렌더.
- [ ] **Step 7:** `npx vitest run` PASS, `npm run build` 성공.
- [ ] **Step 8:** 커밋 `feat(frontend): scaffold app shell, API contract and mock client`

### Task 2: FMU 라이브러리 화면 (목록·업로드·상세)

**Files:**
- Create: `frontend/src/pages/FmuListPage.tsx`, `FmuDetailPage.tsx`, `frontend/src/components/VariablePicker.tsx`
- Test: `frontend/src/pages/FmuListPage.test.tsx`, `frontend/src/components/VariablePicker.test.tsx`

**Interfaces:**
- Consumes: `useApi().listFmus/uploadFmu/deleteFmu/getFmu/listVariables`
- Produces: `<VariablePicker fmuId causality?: 'parameter'|'output'|'local'|'all' mode: 'single'|'multi' value: string[] onChange(names: string[]) pageSize?=100 />` — Task 3, 5, 7에서 재사용.

- [ ] **Step 1: 실패하는 테스트**
  - `FmuListPage`: 목록에 `modelName`, `fmiTypes`, `nParameters`, `nRuns` 표시; Dropzone에 `.fmu` 드롭 시 `uploadFmu` 호출 후 목록 갱신; `.fmu` 아닌 파일은 거절 메시지 "FMU 파일(.fmu)만 업로드할 수 있습니다".
  - `VariablePicker`: 검색어 입력(300ms debounce) 시 `listVariables`가 `{q}`로 호출됨; 다음 페이지 버튼 시 `offset=100`; multi 모드 체크 시 `onChange`에 이름 누적; 결과 0건이면 "일치하는 변수가 없습니다".
- [ ] **Step 2:** `npx vitest run src/pages/FmuListPage src/components/VariablePicker` → FAIL.
- [ ] **Step 3:** 구현. 상세 페이지: 요약 카드(DefaultExperiment, guid, 생성 도구) + 탭(파라미터/출력/전체) 각 탭에 `VariablePicker`(읽기 전용 표시 모드: 이름·타입·start·unit·description) + "배치 해석", "최적화", "결과 보기" 버튼.
- [ ] **Step 4:** 테스트 PASS.
- [ ] **Step 5:** 커밋 `feat(frontend): FMU library pages and variable picker`

### Task 3: 배치 해석 설정 화면

**Files:**
- Create: `frontend/src/lib/sweep.ts`, `frontend/src/pages/BatchSetupPage.tsx`, `frontend/src/components/SimSettingsForm.tsx`
- Test: `frontend/src/lib/sweep.test.ts`, `frontend/src/pages/BatchSetupPage.test.tsx`

**Interfaces:**
- Consumes: `VariablePicker`, `useApi().getFmu/createBatch`
- Produces: `countCases(params: SweepParam[], sampling, nSamples): number`, `expandValues(p: SweepParam): number[]`, `previewCases(params, sampling, nSamples, limit=20): Record<string, number>[]` (lhs/random은 미리보기 없이 개수만), `<SimSettingsForm value onChange defaults={fmu.defaultExperiment} />`(Task 5 재사용).

- [ ] **Step 1: 실패하는 테스트** (`sweep.test.ts`)

```ts
expect(expandValues({ name: 'a', mode: 'range', min: 0, max: 1, steps: 3 })).toEqual([0, 0.5, 1]);
expect(countCases([listA3, listB4], 'grid', null)).toBe(12);
expect(countCases([listA3, listB3], 'zip', null)).toBe(3);
expect(() => countCases([listA3, listB4], 'zip', null)).toThrow('zip 방식은 모든 파라미터의 값 개수가 같아야 합니다');
expect(countCases([rangeA], 'lhs', 50)).toBe(50);
```

  `BatchSetupPage.test.tsx`: 파라미터 2개 추가·값 입력 시 "총 12 케이스" 표시; 케이스 수 > 1000이면 확인 모달 "케이스가 많습니다 (N개). 계속하시겠습니까?"; 제출 시 `createBatch`가 계약 형태(`recordVariables` 기본값=출력 전체, `sim` 기본값=DefaultExperiment, `outputInterval` 기본 1.0)로 호출되고 `/jobs/<id>`로 이동; 파라미터 0개면 제출 버튼 비활성; 화면에 목적함수 선택 UI가 없음(안내 문구 "목적함수 값은 결과 조회 시 최신 코드로 계산됩니다" 표시).
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 화면 구성: ① 스윕 파라미터 표(VariablePicker로 추가, 행마다 mode list/range, 기본값=start 표시) ② 샘플링 방식+nSamples ③ 고정 파라미터 ④ SimSettingsForm ⑤ 기록 변수(VariablePicker multi, 기본 출력 전체 — 목적함수가 참조할 변수가 반드시 포함돼야 함을 안내) ⑥ workers(기본 `navigator.hardwareConcurrency-1`, 최소 1), runTimeoutSec ⑦ 케이스 미리보기 표.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(frontend): batch run setup page`

### Task 4: 목적함수 편집기

**Files:**
- Create: `frontend/src/pages/ObjectiveEditorPage.tsx`, `frontend/src/components/CodeHashBadge.tsx`, `frontend/src/api/mock/fixtures/objective_template.py.txt`
- Test: `frontend/src/pages/ObjectiveEditorPage.test.tsx`

**Interfaces:**
- Consumes: `useApi().listObjectives/getObjective/createObjective/updateObjective/deleteObjective/testObjective/listRuns/listJobs`
- Produces: `<CodeHashBadge hash: string />` (앞 8자 표시, 툴팁 전체) — Task 6, 7 재사용.

템플릿(신규 생성 시 기본 코드, 정확한 문구):

```python
import numpy as np
import pandas as pd


def evaluate(result: pd.DataFrame, params: dict) -> float:
    """result: 'time' 컬럼 + 기록된 변수 컬럼. 반환: 이 목적함수의 스칼라 값 1개."""
    t = result["time"].to_numpy()
    return float(t[-1] - t[0])
```

- [ ] **Step 1: 실패하는 테스트** — Monaco는 `vi.mock('@monaco-editor/react')`로 `<textarea>` 대체.
  - 좌측 목록 클릭 시 코드 로드, 이름 옆 `CodeHashBadge`; 편집 후 "저장" → `updateObjective` 호출 후 배지 해시가 바뀜; 미저장 변경이 있을 때 다른 항목 클릭 시 확인 모달 "저장하지 않은 변경 사항이 있습니다".
  - 저장 확인 문구: "저장하면 모든 결과 화면의 이 목적함수 값이 새 코드로 다시 계산됩니다."
  - "테스트 실행": run 선택(최근 ok run 목록, FMU 필터) 후 `testObjective({code, runId})` (편집 중 미저장 코드) → 값 1개 표시; `error`가 있으면 빨간 Alert에 traceback 그대로 표시, `stdout` 패널 표시.
  - 이름 중복 생성 시 서버 에러 메시지 표시.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 레이아웃: 좌 목록 / 중앙 Monaco(python, 저장 Ctrl+S) / 우 테스트 패널(run 선택, 결과 값, stdout, 선택 run의 기록 변수 컬럼명 목록 — 코드 작성 참고용).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(frontend): objective function editor with test run`

### Task 5: 최적화 설정 화면 (단일/다목적)

**Files:**
- Create: `frontend/src/pages/OptimizationSetupPage.tsx`, `frontend/src/components/ObjectivePicker.tsx`
- Test: `frontend/src/pages/OptimizationSetupPage.test.tsx`

**Interfaces:**
- Consumes: `VariablePicker`, `SimSettingsForm`, `CodeHashBadge`, `useApi().getFmu/listObjectives/createOptimization`
- Produces: `<ObjectivePicker value: string[] onChange(ids) withDirection?: boolean directions?: Record<string,'minimize'|'maximize'> onDirectionsChange? />` — Task 7 재사용(withDirection=false).

- [ ] **Step 1: 실패하는 테스트**
  - 설계변수 추가 시 min/max 기본값 = start×0.5 / start×1.5 (start=0이면 -1/1); `min >= max`면 "최솟값은 최댓값보다 작아야 합니다" & 제출 비활성.
  - 목적함수 1개 선택 → 알고리즘 옵션 `tpe|cmaes|random`, 기본 `tpe`; 2개 이상 선택 → 옵션 `nsga2|tpe|random`, 기본 `nsga2`, 이미 `cmaes`였으면 `nsga2`로 바뀌고 안내 "CMA-ES는 단일 목적만 지원합니다".
  - 목적함수 행마다 minimize/maximize 토글.
  - 제출 시 `createOptimization`이 `objectives: [{objectiveId, direction}, ...]`, nTrials 기본 50으로 호출 후 `/jobs/<id>` 이동; 목적함수 0개면 제출 비활성.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(frontend): single and multi-objective optimization setup page`

### Task 6: 잡 목록·실시간 모니터

**Files:**
- Create: `frontend/src/pages/JobListPage.tsx`, `JobMonitorPage.tsx`, `frontend/src/lib/pareto.ts`, `frontend/src/components/{JobStatusBadge,ScatterChart,TimeseriesChart,StaleSnapshotAlert}.tsx`
- Test: `frontend/src/lib/pareto.test.ts`, `frontend/src/pages/JobMonitorPage.test.tsx`

**Interfaces:**
- Consumes: `useApi().listJobs/getJob/subscribeJob/cancelJob/listRuns/listObjectives/getTimeseries`, `CodeHashBadge`, `ObjectivePicker`
- Produces: `paretoFront(points: number[][], directions: ('minimize'|'maximize')[]): boolean[]` (null 포함 점은 false), `<TimeseriesChart runs: {runId, label}[] vars: string[] />`(ECharts `sampling:'lttb'`), `<ScatterChart points: {x, y, id, highlight?}[] xLabel yLabel onPointClick(id) />`, `<StaleSnapshotAlert snapshot={job.objectiveSnapshot} current={codeHashes} />` — Task 7 재사용.

- [ ] **Step 1: 실패하는 테스트**
  - `pareto.test.ts`: `paretoFront([[1,5],[2,2],[3,3],[5,1]], ['minimize','minimize'])` → `[true,true,false,true]`; maximize 방향 반전 확인; `[null,1]` → false.
  - `JobMonitorPage` (mock `tickMs:10`, fake timers): 진행 바 `completed/total`과 실패 수가 이벤트로 갱신; `end` 후 "취소" 버튼 사라짐; run 이벤트 수신 시 run 표 갱신(`listRuns` 재조회, 디바운스 500ms).
  - 배치 잡: 기본 목적함수 컬럼 없음, `ObjectivePicker`로 선택하면 `listRuns({jobIds:[id], objectiveIds})`로 현재 코드 기준 값 컬럼 추가 + 컬럼 헤더에 `CodeHashBadge`.
  - 최적화 잡: 잡의 목적함수가 자동 선택됨; 단일목적 → 수렴 차트(x=trial, y=값, best-so-far 선); 2목적 이상 → 축 선택 가능한 산점도 + `paretoFront` 강조; `objectiveSnapshot` 해시 ≠ 응답 `codeHashes`이면 `StaleSnapshotAlert` 문구(Global Constraints의 정확한 문구) 표시, 같으면 미표시.
  - 행 선택(최대 10개) → 하단 `TimeseriesChart` 오버레이; 언마운트 시 unsubscribe 호출.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 잡 목록: 상태 배지·종류·FMU·진행률·생성시각, FMU 필터.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(frontend): job list and live monitor with Pareto view`

### Task 7: 결과 탐색·비교 화면 (FMU별 누적 DB 조회)

**Files:**
- Create: `frontend/src/pages/ResultsPage.tsx`
- Test: `frontend/src/pages/ResultsPage.test.tsx`

**Interfaces:**
- Consumes: `useApi().listFmus/listJobs/listRuns/listObjectives/getTimeseries`, `ObjectivePicker`, `CodeHashBadge`, `ScatterChart`, `TimeseriesChart`

- [ ] **Step 1: 실패하는 테스트**
  - `/fmus/:fmuId/results` 진입 시 해당 FMU의 모든 잡 run을 `listRuns({fmuId, offset, limit:100})` 서버 페이지네이션으로 표시(파라미터 컬럼만); 잡 다중 필터, 상태 필터.
  - 목적함수 선택 → `listRuns({..., objectiveIds})` 호출, 값 컬럼 + 헤더 `CodeHashBadge` + 상단 안내 "현재 목적함수 코드 기준으로 계산된 값입니다"; 계산 중 로딩 표시; 값 컬럼 클릭 시 `sortBy='objective:<id>'`; 값이 null인 셀은 에러 툴팁.
  - 목적함수 코드가 바뀐 뒤(mock에서 `updateObjective`) 화면 재진입 시 새 값·새 해시 표시(이전 값 미표시 — React Query 키에 objectiveIds 포함, 목적함수 저장 시 `runs` 쿼리 무효화).
  - 산점도: X축(파라미터 또는 목적함수)·Y축(목적함수) 선택 → 점 클릭 시 해당 run 행 선택.
  - "FMU 비교" 탭: FMU 2개 이상 + 목적함수 선택 → FMU별 값 분포(박스플롯)와 선택 run 시계열 오버레이(라벨 `<modelName>#<index>`).
  - CSV 내보내기: 현재 필터의 params + 선택 목적함수 값 + 헤더에 codeHash(`<name>[<hash8>]`) 포함 (Blob URL 생성 확인).
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS; `npm run build` 성공; `npm run dev`로 전체 흐름(업로드→배치→모니터→결과→목적함수 편집→결과 재조회 시 값 변경→다목적 최적화)을 mock으로 수동 확인.
- [ ] **Step 5:** 커밋 `feat(frontend): results explorer and multi-FMU comparison`

**Phase 1 체크포인트:** 사용자에게 화면 시연(스크린샷) 후 UI 피드백 반영을 받고 Phase 2 시작.

---

# Phase 2 — 백엔드 (기능별 순차)

각 Task 마지막 단계는 "해당 도메인 mock→http 전환 + 실서버로 UI 확인"이다. 프론트 `vite.config.ts`의 dev proxy `/api → http://127.0.0.1:8000`.

### Task 8: 백엔드 스캐폴드 + DB 스키마 + http 클라이언트

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/{main,config,db,models,schemas}.py`, `backend/tests/conftest.py`, `frontend/src/api/http/httpClient.ts`
- Test: `backend/tests/test_app.py`, `frontend/src/api/http/httpClient.test.ts`

**Interfaces:**
- Produces: `Settings(data_dir: Path)` (`FMUC_DATA_DIR` 환경변수, 기본 `backend/data`; 비ASCII 포함 시 `ValueError("data_dir must be ASCII-only")`), `get_session()` FastAPI 의존성, `init_db(engine)`, ORM 모델(File Structure의 테이블), Pydantic `CamelModel` 베이스. conftest fixture: `client`(tmp data_dir), `fmu_path`(실 FMU, `FMUC_TEST_FMU` 기본 `../my_0test_DriveCycleAT.fmu`, 없으면 skip). `createHttpClient(baseUrl='/api'): ApiClient` (계약 전 메서드 구현, `subscribeJob`은 `EventSource`).

- [ ] **Step 1: 실패하는 테스트** — `GET /api/health` → `{"status":"ok"}`; `Settings(data_dir=Path("D:/복사본"))` → ValueError; 앱 시작 시 테이블 생성되고 어떤 테이블에도 목적함수 값 컬럼이 없음(`inspect(engine)`로 `runs` 컬럼 집합이 정확히 `{id, job_id, fmu_id, index, params, status, error, elapsed_sec, result_path}`). `httpClient.test.ts`: `listRuns({jobIds:['a','b'], objectiveIds:['o']})` → `/api/runs?jobIds=a,b&objectiveIds=o`, 비2xx 시 서버 `detail`을 메시지로 갖는 `ApiError` throw.
- [ ] **Step 2:** `cd backend && pytest -v`, `cd frontend && npx vitest run src/api/http` → FAIL.
- [ ] **Step 3:** 구현. `uvicorn app.main:app --host 127.0.0.1 --port 8000`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(backend): scaffold FastAPI app, DB schema and HTTP client`

### Task 9: FMU 레지스트리 (업로드·파싱·변수 조회)

**Files:**
- Create: `backend/app/fmu/registry.py`, `backend/app/routers/fmus.py`
- Test: `backend/tests/test_fmus.py`

**Interfaces:**
- Produces: `register_fmu(session, src: BinaryIO, file_name: str, settings) -> Fmu` (SHA-256 → `fmu_id`, `data/fmus/<id>.fmu` 저장, `data/extract/<id>/`에 압축해제, `fmpy.read_model_description`으로 변수 일괄 insert), `get_extract_dir(fmu_id) -> Path`, `query_variables(session, fmu_id, q, causality, offset, limit) -> (total, list[Variable])` (q는 name/description 대소문자 무시 LIKE). `DELETE`는 run이 있으면 409 `"이 FMU에 저장된 해석 결과가 있어 삭제할 수 없습니다"`.

- [ ] **Step 1: 실패하는 테스트**

```python
def test_upload_parses_real_fmu(client, fmu_path):
    r = client.post("/api/fmus", files={"file": ("my 복사본.fmu", fmu_path.read_bytes())})
    body = r.json()
    assert r.status_code == 201 and body["modelName"] == "my_test.DriveCycleAT"
    assert body["fmiTypes"] == ["ModelExchange"]
    assert (body["nParameters"], body["nOutputs"], body["nVariables"]) == (2867, 140, 54616)
    assert body["defaultExperiment"] == {"startTime": 0.0, "stopTime": 1400.0, "tolerance": 1e-4}
def test_reupload_same_content_returns_same_id(client, fmu_path): ...   # 두 번째 200, 같은 id, fmus 1건
def test_variables_search_paginates(client, uploaded_fmu):
    r = client.get(f"/api/fmus/{uploaded_fmu}/variables", params={"q": "road.stopTable", "causality": "parameter", "limit": 2})
    assert r.json()["total"] >= 2 and len(r.json()["items"]) == 2
    assert r.json()["items"][0]["start"] == 45                      # road.stopTable[1,1]
def test_rejects_non_fmu(client): ...                                 # zip 아님 → 400 "유효한 FMU 파일이 아닙니다"
def test_stored_paths_are_ascii(client, fmu_path, settings): ...      # data_dir 하위 모든 경로 isascii()
```

- [ ] **Step 2:** `pytest tests/test_fmus.py -v` → FAIL.
- [ ] **Step 3:** 구현 (변수 insert는 `session.execute(insert(Variable), rows)` 일괄; 업로드는 임시파일에 스트리밍 후 해시).
- [ ] **Step 4:** PASS (변수 54,616개 insert 포함 업로드가 10초 이내인지 확인).
- [ ] **Step 5:** `VITE_API_FMUS=http`로 프론트 실행, 실 FMU 업로드·상세·변수 검색 수동 확인.
- [ ] **Step 6:** 커밋 `feat(backend): FMU registry with upload, parsing and variable search`

### Task 10: 단일 시뮬레이션 실행 + 시계열 저장

**Files:**
- Create: `backend/app/fmu/simulate.py`, `backend/app/results/storage.py`, `backend/app/routers/runs.py`(timeseries 엔드포인트만)
- Test: `backend/tests/test_simulate.py`, `backend/tests/test_storage.py`

**Interfaces:**
- Produces:
  - `@dataclass SimTask(fmu_id: str, extract_dir: str, start_values: dict[str, float|bool], sim: SimSettings, record_variables: list[str], out_path: str)`
  - `run_simulation(task: SimTask) -> SimOutcome` — 워커 프로세스용 최상위(피클 가능) 함수. `SimOutcome(ok: bool, error: str|None, elapsed_sec: float, columns: list[str])`. `fmpy.simulate_fmu(extract_dir, fmi_type="ModelExchange", solver="CVode", start_time, stop_time, relative_tolerance=tolerance, output_interval, start_values, output=record_variables)` 후 Parquet 저장. 예외는 잡아서 `ok=False, error=<마지막 줄 메시지>`.
  - `write_result(path, structured_array)`, `read_result(path, columns: list[str]|None) -> pd.DataFrame`, `downsample(df, max_points) -> df` (균등 stride, 첫·끝 점 포함).
  - `GET /api/runs/{id}/timeseries?vars=&maxPoints=` → `Timeseries`.

- [ ] **Step 1: 실패하는 테스트**

```python
def test_short_simulation_writes_parquet(uploaded_fmu_dir, tmp_path):
    out = run_simulation(SimTask(..., sim=SimSettings(0, 5, 1e-4, 0.1), record_variables=OUTPUTS[:3], out_path=str(tmp_path/"r.parquet")))
    df = read_result(tmp_path/"r.parquet")
    assert out.ok and list(df.columns) == ["time", *OUTPUTS[:3]] and df["time"].iloc[-1] == pytest.approx(5)
def test_start_value_is_applied(...): ...    # Task 0에서 고른 파라미터 변경 시 결과가 달라짐
def test_unknown_variable_returns_failed(...): # start_values={"nope": 1} → ok=False, error에 "nope" 포함
def test_downsample_keeps_endpoints(): ...    # 10_001행 → max_points=2000 → len<=2000, 첫/끝 time 보존
```

- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(backend): single FMU simulation runner and Parquet result storage`

### Task 10b: 병렬 실행 계층 (Ray / multiprocessing.Pool 폴백)

**Files:**
- Create: `backend/app/parallel/{base,ray_backend,pool_backend}.py`; Modify: `backend/app/main.py`(startup에서 `create_executor`, `app.state.executor`; shutdown에서 `shutdown()`), `backend/app/routers/` health 응답
- Test: `backend/tests/test_parallel.py` (두 백엔드에 같은 테스트를 parametrize; Ray 미설치 시 ray 케이스 skip)

**Interfaces:**
- Consumes: 없음 (작업 함수는 호출자가 주는 피클 가능한 최상위 함수, 예: `run_simulation`)
- Produces:
  - `class TaskHandle` (불투명 핸들), `class TaskTimeout(Exception)`, `class TaskCancelled(Exception)`
  - `class ParallelExecutor(Protocol)`: `name: Literal["ray","pool"]`, `max_workers: int`, `submit(fn, *args) -> TaskHandle`, `wait_any(handles: list[TaskHandle], timeout: float|None) -> list[TaskHandle]`(완료된 것들), `result(h) -> Any`(작업 예외는 그대로 다시 raise), `cancel(h, force: bool = True) -> None`, `shutdown() -> None`
  - 작업별 타임아웃은 호출자가 `submit` 시각을 기억해 두고 `cancel(h, force=True)`로 처리하며, 취소된 핸들의 `result(h)`는 `TaskCancelled`를 raise한다.
  - `create_executor(mode: Literal["auto","ray","pool"], max_workers: int) -> ParallelExecutor` — Global Constraints의 선택 규칙 그대로.
  - `RayExecutor`: `ray.remote(fn).options(num_cpus=1)`, `ray.wait(..., num_returns=1, timeout=)`, `ray.cancel(ref, force=True)`(멈춘 워커 프로세스 kill), `ray.init(num_cpus=max_workers, include_dashboard=False)`. 워커에는 `runtime_env`로 `backend/` 경로를 넘겨 `app.*` import가 되게 한다.
  - `PoolExecutor`: `multiprocessing.get_context("spawn").Pool(max_workers, maxtasksperchild=50)` + `apply_async`. Pool은 작업 하나만 죽일 수 없으므로 `cancel(force=True)`는 풀을 `terminate()` 후 새로 만들고, 그 풀에서 실행 중이던 **다른** 미완료 작업은 같은 인자로 자동 재제출한다(핸들은 유지).

- [ ] **Step 1: 실패하는 테스트** (`@pytest.mark.parametrize("mode", ["ray", "pool"])`, 테스트용 작업 함수는 `tests/_tasks.py`에 최상위로 정의)

```python
def test_runs_in_parallel(executor):        # sleep(0.5) × 4, max_workers=4 → 전체 < 1.5s, 결과 4개
def test_task_exception_propagates(executor):  # raise ValueError("boom") → result()가 ValueError("boom")
def test_force_cancel_kills_hung_task(executor):  # 무한 sleep 작업 + 정상 작업 1개 → cancel 후 result()가 TaskCancelled, 정상 작업은 결과 반환
def test_executor_survives_after_cancel(executor):  # cancel 다음에 submit한 작업도 정상 완료
def test_auto_falls_back_to_pool(monkeypatch):  # import ray가 ImportError를 내도록 패치 → create_executor("auto", 2).name == "pool", 경고 로그
def test_explicit_ray_failure_raises(monkeypatch):  # mode="ray" + import 실패 → RuntimeError("Ray를 사용할 수 없습니다: ...")
def test_health_reports_backend(client): ...   # GET /api/health → {"status":"ok","parallelBackend":"ray"|"pool"}
def test_runs_real_simulation(executor, uploaded_fmu_dir): ...  # run_simulation(SimTask stopTime=5) 2건 동시 실행 → 둘 다 ok
```

- [ ] **Step 2:** `pytest tests/test_parallel.py -v` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS (Ray 미설치 환경이면 pool 케이스만 PASS하고 ray 케이스는 skip되는지 확인).
- [ ] **Step 5:** 프론트 AppShell 헤더에 `parallelBackend` 배지 표시(`ApiClient.health(): Promise<{status: string; parallelBackend: 'ray'|'pool'}>`를 계약에 추가, mock은 `'ray'` 반환).
- [ ] **Step 6:** 커밋 `feat(backend): parallel executor with Ray and multiprocessing.Pool fallback`

### Task 11: 목적함수 저장소 + 온디맨드 평가기

**Files:**
- Create: `backend/app/objectives/{store,_child,evaluator}.py`, `backend/app/routers/objectives.py`
- Test: `backend/tests/test_objectives.py`, `backend/tests/test_evaluator.py`

**Interfaces:**
- Consumes: `read_result`, `ParallelExecutor`(`app.state.executor`; 테스트는 `create_executor("pool", 2)`)
- Produces:
  - `store.create(session, name, code) -> Objective`, `store.update(session, id, name, code) -> Objective`(파일 덮어쓰기, `code_hash = sha256(code.encode()).hexdigest()` 갱신, 이력 없음), `store.load(id) -> tuple[str, str]`(code, code_hash), `store.delete`.
  - `@dataclass EvalItem(run_id: str, result_path: str, params: dict)`; `@dataclass EvalResult(value: float|None, error: str|None, stdout: str, duration_ms: int)`.
  - `worker.evaluate_item(code: str, item: EvalItem) -> EvalResult` — 워커 프로세스에서 실행되는 최상위 함수. 코드를 새 네임스페이스에 `exec`하고, `contextlib.redirect_stdout`으로 출력을 잡으며, `evaluate(read_result(item.result_path), item.params)`를 호출한다.
  - `class Evaluator(executor: ParallelExecutor, item_timeout_sec: float = 10.0, cache_size: int = 200_000)`:
    - `evaluate(code: str, items: list[EvalItem]) -> dict[str, EvalResult]` — `code_hash`를 계산해 캐시 `(run_id, code_hash)` 적중분은 그대로 쓰고, 나머지는 항목마다 `executor.submit(evaluate_item, code, item)` 후 `wait_any`로 모은다. `item_timeout_sec`를 넘긴 항목은 `executor.cancel(h, force=True)`, `error="목적함수 실행 시간이 10초를 초과했습니다"`. 결과는 캐시에 넣는다.
    - `evaluate_one_uncached(code, item) -> EvalResult` — 테스트 엔드포인트용(캐시 미사용, 같은 executor·타임아웃).
  - 반환값 검증(`evaluate_item` 안에서): `evaluate` 없음 → `"evaluate 함수가 정의되지 않았습니다"`; bool/비실수(dict·str·None 등) → `"evaluate()는 실수 하나를 반환해야 합니다 (받은 타입: <type>)"`; NaN/inf → `value=None, error="evaluate()가 NaN 또는 무한대를 반환했습니다"`; 예외 → traceback 문자열.
  - `POST /api/objectives/test {code, runId}` → `ObjectiveTestResult` (`evaluate_one_uncached`).
  - `Evaluator`는 앱 수명 동안 싱글턴(`app.state.evaluator`), 최적화 루프와 조회 API가 공유.

- [ ] **Step 1: 실패하는 테스트**

```python
def test_evaluate_returns_scalar(evaluator, result_item):
    r = evaluator.evaluate(TEMPLATE, [result_item])[result_item.run_id]
    assert r.error is None and r.value == pytest.approx(5.0)
@pytest.mark.parametrize("ret,msg", [("{'a': 1}", "dict"), ("'x'", "str"), ("True", "bool"), ("None", "NoneType")])
def test_non_scalar_return_rejected(evaluator, result_item, ret, msg): ...   # value None, error에 타입명 포함
def test_nan_is_null_with_error(evaluator, result_item): ...
def test_missing_evaluate(evaluator, result_item): ...
def test_one_bad_item_does_not_block_others(evaluator, items3): ...  # 특정 runId에서만 raise → 나머지 2개 값 정상
def test_infinite_loop_times_out_then_continues(items3): ...         # Evaluator(item_timeout_sec=1), 첫 항목만 무한루프 → 첫 항목 timeout 에러, 나머지 정상
def test_cache_hit_same_code(evaluator, result_item, spy_executor): ...  # 두 번째 호출은 executor.submit 0회
def test_changed_code_recomputes(evaluator, result_item):
    a = evaluator.evaluate("def evaluate(r,p): return 1.0", [result_item])
    b = evaluator.evaluate("def evaluate(r,p): return 2.0", [result_item])
    assert (a[result_item.run_id].value, b[result_item.run_id].value) == (1.0, 2.0)
def test_update_overwrites_and_changes_hash(client): ...             # 이전 코드 파일 남지 않음
def test_duplicate_name_409(client): ...                              # detail "같은 이름의 목적함수가 이미 있습니다"
```

- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** `VITE_API_OBJECTIVES=http`로 편집기 저장·해시 변경 수동 확인 (테스트 실행은 Task 12 이후 실제 run이 생기면 확인).
- [ ] **Step 6:** 커밋 `feat(backend): objective store and on-demand cached evaluator`

### Task 12: 배치 잡 러너 (병렬 실행·진행 이벤트·취소) + run 조회 시 목적함수 계산

**Files:**
- Create: `backend/app/jobs/{sampling,runner}.py`, `backend/app/routers/jobs.py`; Modify: `backend/app/routers/runs.py`(목록), `backend/app/main.py`(startup 정리, JobManager/Evaluator 수명)
- Test: `backend/tests/test_sampling.py`, `backend/tests/test_runner.py`, `backend/tests/test_jobs_api.py`, `backend/tests/test_runs_api.py`

**Interfaces:**
- Consumes: `run_simulation`, `SimTask`, `get_extract_dir`, `ParallelExecutor`, `Evaluator.evaluate`, `store.load`
- Produces:
  - `generate_cases(params: list[SweepParam], sampling, n_samples, seed=0) -> list[dict[str, float]]` — grid=데카르트 곱, zip=길이 동일 필수(아니면 `ValueError`, 프론트와 같은 문구), lhs=`scipy.stats.qmc.LatinHypercube`(range 파라미터만, list면 `ValueError("LHS/random 방식은 range 파라미터만 지원합니다")`), random=균등.
  - `class JobManager(settings, session_factory, executor: ParallelExecutor, evaluator, sim_fn=run_simulation)` — `submit_batch(req) -> Job`, `cancel(job_id)`, `subscribe(job_id) -> asyncio.Queue[JobEvent]`, `shutdown()`. 잡마다 백그라운드 스레드 1개가 동시 실행 개수를 `min(req.workers, executor.max_workers)`로 유지하며 `executor.submit(sim_fn, SimTask)` → `wait_any(timeout=1.0)` 루프를 돈다. run이 끝나면 DB에 기록하고 이벤트를 발행한다(목적함수 계산 없음). `runTimeoutSec`를 넘긴 run은 `executor.cancel(h, force=True)` 후 `failed, error="timeout"`. 잡을 취소하면 실행 중인 핸들을 force cancel하고, 아직 시작하지 않은 케이스는 제출하지 않은 채 `cancelled`로 끝낸다.
  - `mark_interrupted_jobs(session)` — startup에서 `queued/running` → `failed`, `error="interrupted"`.
  - `query_runs(session, evaluator, q: RunQuery) -> RunPage` — 필터 후, `objectiveIds`가 있으면 각 목적함수의 현재 코드로 **필터된 ok run 전체**를 `evaluator.evaluate`(캐시) → `objective:<id>` 정렬(null은 방향과 무관하게 마지막) → 페이지 슬라이스. failed run의 목적함수 값은 `{value:null, error:"시뮬레이션 실패"}`. 존재하지 않는 objectiveId는 404.

- [ ] **Step 1: 실패하는 테스트** (`test_runner.py`는 가짜 `sim_fn`으로 FMU 없이)

```python
def test_grid_cases(): assert len(generate_cases([list3, range4], "grid", None)) == 12
def test_lhs_bounds(): ...                         # 50개, 모든 값 [min,max]
def test_batch_runs_all_cases_in_parallel(manager_fake):  # sim_fn sleep 0.2s, 8 케이스, workers=4 → 총 < 1.2s, completed=8
def test_batch_does_not_evaluate_objectives(manager_fake, spy_evaluator): ...  # evaluate 호출 0회
def test_failed_case_does_not_stop_job(...):       # 특정 params에서 ok=False → job done, failed=1, run.error 저장
def test_run_timeout_marks_failed(...):            # 무한 sleep, runTimeoutSec=1 → run.error == "timeout", job done
def test_cancel(...):                               # 20 케이스 중 cancel → cancelled, completed < 20
def test_interrupted_jobs_marked_on_startup(...):
def test_events_stream(client): ...                # SSE progress→run…→end 순서
# test_runs_api.py
def test_runs_with_objective_sorted(client, seeded_runs, objective): ... # sortBy=objective:<id>&sortDir=desc, null 마지막, codeHashes[id] == 현재 해시
def test_objective_edit_changes_values_immediately(client, seeded_runs, objective):
    v1 = values(client.get("/api/runs", params={"jobIds": J, "objectiveIds": objective}))
    client.put(f"/api/objectives/{objective}", json={"name": "obj", "code": "def evaluate(r,p): return 42.0"})
    v2 = values(client.get("/api/runs", params={"jobIds": J, "objectiveIds": objective}))
    assert v1 != v2 and set(v2) == {42.0}
def test_fmu_filter_does_not_mix(client, two_fmus_seeded): ...
def test_real_fmu_batch_smoke(client, uploaded_fmu):  # 실 FMU, stopTime=5, 1파라미터×2값, workers=2 → 2 ok runs, 템플릿 목적함수 값 ≈ 5, timeseries 조회 성공
```

- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 워커는 프로세스당 1회 `fmpy` import; `extract_dir`는 읽기 전용 공유. `test_runner.py`의 fake 테스트는 `mode` parametrize로 ray·pool 두 백엔드 모두에서 돌린다(ray 미설치 시 skip).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** `VITE_API_JOBS=http VITE_API_RUNS=http`로 실 FMU 배치(파라미터 1개 × 4값, workers 4) → 모니터, 결과 화면에서 목적함수 선택·정렬, 편집기에서 코드 수정 후 결과 재조회 시 값·해시 변경을 수동 확인. 1400s 해석 4건 병렬 시간을 측정값에 기록.
- [ ] **Step 6:** 커밋 `feat(backend): parallel batch runner and on-demand objective evaluation in run queries`

### Task 13: 최적화 잡 (단일/다목적)

**Files:**
- Create: `backend/app/jobs/optimize.py`; Modify: `backend/app/jobs/runner.py`(`submit_optimization`), `backend/app/routers/jobs.py`
- Test: `backend/tests/test_optimize.py`

**Interfaces:**
- Consumes: `JobManager` 실행/이벤트 경로, `Evaluator.evaluate`, `store.load`
- Produces: `JobManager.submit_optimization(req) -> Job`.
  - 제출 시 각 목적함수의 `(code, code_hash)`를 메모리에 스냅샷, `jobs.objective_snapshot = {id: {name, codeHash}}` 저장(값 아님). 검증: `objectives` 0개 → 422; `cmaes` + 2개 이상 → 422 `"CMA-ES는 단일 목적만 지원합니다"`.
  - `optuna.create_study(directions=[o.direction for o in objectives], sampler={tpe: TPESampler(seed=0), cmaes: CmaEsSampler(seed=0), random: RandomSampler(seed=0), nsga2: NSGAIISampler(seed=0)}[algorithm])`, storage 없음(메모리). ask/tell 루프로 `workers`개 trial 동시 진행: `ask` → `executor.submit(sim_fn, SimTask)` → 완료 시 스냅샷 코드로 `evaluator.evaluate`(캐시에 `(run_id, snapshot_hash)`로 남아 조회 시 코드가 같으면 재사용) → `tell(values)`. 시뮬 실패 또는 어떤 목적함수든 `value is None` → `tell(state=TrialState.FAIL)`. 목적함수 값은 DB에 쓰지 않는다.
  - trial마다 run 1개(`run.index = trial.number`). `kind='int'`는 `suggest_int`.

- [ ] **Step 1: 실패하는 테스트** (가짜 `sim_fn`이 params를 시계열 컬럼으로 기록, 목적함수가 그 값을 읽음)

```python
def test_single_objective_tpe_finds_minimum(manager_fake):  # (x-0.3)**2, nTrials=40, workers=4 → runs 재조회 시 최소값 < 0.01
def test_multi_objective_nsga2_returns_tradeoff(manager_fake):  # f1=x², f2=(x-1)², nTrials=40 → paretoFront 상의 점이 5개 이상, x ∈ [0,1]
def test_cmaes_rejects_multi(client): ...         # 422 문구
def test_failed_trials_counted_not_fatal(...):
def test_objective_error_fails_trial(...):        # 목적함수가 raise → 모든 trial FAIL, job done
def test_no_objective_values_in_db(manager_fake, engine): ...   # 잡 완료 후 DB 전체 덤프에 목적함수 값 없음(runs 컬럼 불변, 별도 테이블 없음)
def test_snapshot_used_even_if_edited_midrun(manager_fake): ...  # 실행 중 updateObjective → 최적화는 계속 스냅샷 코드로 tell, job.objective_snapshot 해시는 제출 시점 값
def test_query_after_edit_shows_current_code_values(client, finished_opt_job): ...  # listRuns codeHashes ≠ snapshot 해시
def test_int_design_var(...):
```

- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 실 FMU로 설계변수 1~2개, 목적함수 2개, nTrials 8, stopTime 단축 다목적 최적화 → UI Pareto 산점도와, 목적함수 수정 후 `StaleSnapshotAlert` 표시 확인.
- [ ] **Step 6:** 커밋 `feat(backend): Optuna single and multi-objective optimization jobs`

### Task 14: 마무리 + 통합 배포

**Files:**
- Modify: `backend/app/routers/fmus.py`(`nRuns`), `backend/app/routers/runs.py`(timeseries 검증), `backend/app/main.py`(`frontend/dist` 정적 서빙, SPA fallback), `frontend/src/api/select.ts`(기본값 http)
- Create: `run.ps1`(프론트 빌드 후 uvicorn 기동), `README.md`(설치·실행·목적함수 작성 규칙: 파일 1개=값 1개, 값은 항상 현재 코드로 재계산됨)
- Test: `backend/tests/test_static.py`, `backend/tests/test_runs_api.py`(추가)

**Interfaces:**
- Produces: `GET /api/runs/{id}/timeseries` 미기록 변수명은 400 `"기록되지 않은 변수: <name>"`; `/` 및 비 `/api` 경로 → `index.html`; `FmuSummary.nRuns`.

- [ ] **Step 1: 실패하는 테스트** — 미기록 변수 400, `/jobs/abc` GET → index.html 200, `nRuns`가 해당 FMU run 수와 일치, 서버 재시작(새 TestClient, 같은 data_dir) 후 run 목록·목적함수 값 조회 정상(캐시 비어도 재계산).
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `pytest -v` 전체 PASS, `npx vitest run` 전체 PASS.
- [ ] **Step 5:** `./run.ps1` → `http://127.0.0.1:8000`에서 mock 없이 전체 시나리오 수동 확인: 업로드 → 배치 → 목적함수 2개 작성·테스트 → 결과 정렬/산점도 → 목적함수 수정 후 값 변경 확인 → 다목적 최적화 → 두 번째 FMU 비교 → 서버 재시작 후 결과 유지.
- [ ] **Step 6:** 커밋 `feat: static frontend serving, run script and README`

---

## 측정값 (Task 0에서 기록)

- 1회 해석 시간 (stopTime=1400, tol=1e-4, outputInterval=1, 출력 140개): 5.5 초 (stopTime=20: 1.0 초)
- 기본 `runTimeoutSec`: 600 초 (측정값×5 < 600 → 최소값)
- 출력 반영 확인용 파라미터 (Task 10 테스트용): `vehicle.body.aerodynamics.Cd` (start 0.28, tunable) — 관측 출력 `controlBus.chassisBus.longitudinalVelocity`
- 4건 병렬 해석 총 시간 (Task 12): ____ 초 (백엔드: ray / pool)
- Ray 설치·초기화 결과 (Task 0 Step 2b): ray 2.59.0 설치 성공, `ray.init` 3.0 초, 2건 병렬 50s 해석 1.3 초 (run별 작업 디렉터리 필요 — 아래 참고)

### Task 0에서 발견한 제약 (모든 이후 Task에 적용)

- Dymola modelDescription은 FMPy 엄격 검증에 실패한다 (`requestedGear` Integer + continuous). `read_model_description(..., validate=False)`, `simulate_fmu(..., validate=False)`를 항상 사용.
- 이 모델은 초기화 시 **현재 작업 디렉터리**에 `massList.csv`를 만들고 지운다. 병렬 run이 같은 CWD를 공유하면 `fmi2ExitInitializationMode failed`가 난다. `run_simulation`은 run마다 `data/work/<run_id>/`(ASCII)로 `os.chdir` 후 실행하고 끝나면 원래 CWD로 돌아와 디렉터리를 지운다.
