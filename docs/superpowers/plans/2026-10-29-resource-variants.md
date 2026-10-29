# Resource 후보 파일 · Resource 조합 누적 · 최적화 보강 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FMU `resources/` 파일을 보여 주고, 사용자가 올린 후보 파일로 바꿔 끼워 배치·최적화를 돌리며, "FMU + resource 조합"(variant)별로 결과를 따로 누적·조회·비교한다. 최적화에 GP 추가와 resource 모니터링을 붙인다.

**Architecture:** 후보·variant는 SQLite 테이블, 후보 파일은 `data/resources/<fmu_id>/<sha256>`, variant 실행 폴더는 `data/variants/<variant_id>/`(원본 압축해제 폴더 복제 + 교체). 잡 스레드가 run 제출 전에 variant 폴더를 만들고 `SimTask.extract_dir`로 넘긴다. run은 `variant_id`를 가진다. UI 먼저(mock 클라이언트 포함), 그다음 백엔드를 기능별로.

**Tech Stack:** 기존 그대로 — FastAPI, SQLAlchemy 2.1, FMPy, Optuna 5.0, scipy, React 19 + Mantine + ECharts + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-resource-variants-design.md` (기반: `docs/superpowers/specs/2026-10-29-fmu-controller-requirements.md`)

## Global Constraints

- Python 3.12, 기존 고정 버전 유지. 새 필수 의존성 추가 금지. GP용 `torch`는 `[project.optional-dependencies] gp`로만.
- 목적함수 값은 DB에 저장하지 않는다 (기존 원칙).
- 원본 FMU 파일·원본 압축해제 폴더(`data/extract/<fmu_id>`)는 절대 수정하지 않는다.
- 후보 식별 = `(fmu_id, path, sha256)`. 후보 id = `sha256(f"{fmu_id}:{path}:{sha256}")[:16]`.
- variant id = `sha256(fmu_id + "".join(f"\n{path}={sha}" for path, sha in sorted(replaced)))[:16]` — `replaced`는 원본이 아닌 후보의 `(path, 후보 sha256)`만. 원본 variant = 빈 목록.
- variant 표시 이름: 원본 `원본`, 그 외 `", ".join(f"{basename(path)}={candidate.name}")` (path 정렬 순).
- resource path: `resources/` 기준 상대경로, `/` 구분 (예: `NEDC.mat`, `sub/a.csv`).
- 후보는 원본과 확장자가 같아야 한다(대소문자 무시). 에러 문구는 한국어.
- 배치: 케이스 = 파라미터 케이스(바깥) × resource 조합 직곱(안쪽, path 정렬, 후보는 요청 순서). index 0부터.
- 최적화: 탐색 모드 = `trial.suggest_categorical(f"resource:{path}", candidateIds)`, 후보 2개 이상. 탐색 모드가 있으면 CMA-ES는 422.
- API JSON은 camelCase, `frontend/src/api/types.ts` ↔ `backend/app/schemas.py` 동일 형태.
- 바이너리 dummy 파일은 저장소에 커밋하지 않는다 (테스트에서 생성).

## Review Focus

1. 원본과 내용이 같은 파일을 후보로 올림 → 원본 후보 반환, 새 variant가 생기지 않아야 한다. (Task 8)
2. 같은 워커 프로세스가 서로 다른 variant를 연달아 실행 → 결과가 섞이지 않아야 한다 (DLL/`_model_description` 캐시가 폴더별). (Task 11)
3. 하위 폴더 resource path와 한글 후보 파일명 → 저장은 sha로, 이름은 표시용으로만. (Task 8)
4. `variant_id` 컬럼이 없는 이전 DB → 서버가 뜨고 기존 run이 원본 variant로 보여야 한다. (Task 7)
5. 두 잡이 같은 variant 폴더를 동시에 만들 때 → 폴더 하나, 둘 다 성공. (Task 9)

---

## API 계약 (Task 1이 정의, 이후 모든 task가 사용)

TypeScript (`frontend/src/api/types.ts`에 추가/변경):

```ts
export type ResourceCandidate = { id: string; path: string; name: string; size: number; sha256: string; isOriginal: boolean; nRuns: number; createdAt: string };
export type ResourceFile = { path: string; size: number; sha256: string; candidates: ResourceCandidate[] }; // candidates[0]은 원본
export type CandidateUpload = ResourceCandidate & { existing: boolean };
export type MatVariable = { name: string; shape: number[]; dtype: string };
export type CandidatePreview =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'mat'; variables: MatVariable[]; plot: { name: string; rows: number[][] } | null }
  | { kind: 'binary'; note: string };
export type Variant = { id: string; fmuId: string; label: string; assignment: Record<string, string>; isOriginal: boolean; nRuns: number };
export type OptResource = { mode: 'fixed'; candidateId: string } | { mode: 'search'; candidateIds: string[] };
// 변경
BatchRequest.resources?: Record<string, string[]>;         // path -> candidateIds
OptimizationRequest.resources?: Record<string, OptResource>;
Algorithm = 'tpe' | 'gp' | 'cmaes' | 'random' | 'nsga2';
Health = { status: string; parallelBackend: 'ray' | 'pool'; gpAvailable: boolean };
Run.variantId: string;                                       // RunRow도 상속
RunQuery.variantIds?: string[];
```

`ApiClient` 추가 메서드 (도메인 `RESOURCES`, `select.ts`의 `DOMAIN_METHODS`에 추가, `VITE_API_RESOURCES`):

```ts
listResources(fmuId: string): Promise<ResourceFile[]>;
uploadCandidate(fmuId: string, path: string, file: File): Promise<CandidateUpload>;
deleteCandidate(fmuId: string, candidateId: string): Promise<void>;
previewCandidate(fmuId: string, candidateId: string, varName?: string): Promise<CandidatePreview>;
listVariants(fmuId: string): Promise<Variant[]>;
```

HTTP: `GET /api/fmus/{id}/resources`, `POST /api/fmus/{id}/resources/candidates` (multipart `path`, `file`; 새로 만들면 201, 기존이면 200), `DELETE /api/fmus/{id}/resources/candidates/{cid}` (204), `GET /api/fmus/{id}/resources/candidates/{cid}/preview?var=`, `GET /api/fmus/{id}/variants`, `GET /api/runs?variantIds=a,b`.

에러: 없는 path/후보 404, 확장자 불일치 400 `"원본과 같은 확장자(.mat)의 파일만 올릴 수 있습니다"`, 원본 삭제 400 `"원본 파일은 삭제할 수 없습니다"`, 사용 중 삭제 409 `"이 후보로 해석한 결과가 있어 삭제할 수 없습니다"`, 잡 검증 422.

---

### Task 1: 프론트엔드 API 계약 + mock + http 클라이언트

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/api/select.ts`, `frontend/src/api/http/httpClient.ts`, `frontend/src/api/mock/mockClient.ts`
- Create: `frontend/src/api/mock/fixtures/resources.json`
- Test: `frontend/src/api/mock/mockClient.test.ts`, `frontend/src/api/http/httpClient.test.ts`, `frontend/src/api/select.test.ts`

**Interfaces:**
- Produces: 위 "API 계약" 전부. mock export `MOCK_NEDC_PATH = 'NEDC.mat'`, `MOCK_TIR_PATH = 'tire.tir'`.

mock 동작:
- `MOCK_FMU_ID`의 resource = fixture의 `NEDC.mat`(mat), `tire.tir`(text). 다른 FMU(업로드된 mock FMU)도 같은 fixture로 시작.
- `uploadCandidate`: `await file.text()`의 `mockCodeHash`로 sha 흉내 → 같은 내용이면 기존 후보 `existing: true`; 확장자 불일치 400.
- variant id = `mockCodeHash(fmuId + 정렬된 path=sha)`.slice(0,16); `createBatch`는 파라미터 케이스 × resource 직곱, run에 `variantId`. `createOptimization`은 탐색 모드면 trial마다 `unit()`으로 후보 선택, CMA-ES+탐색이면 422.
- `evaluateMock`에 non-원본 variant면 `unit(code + variantId) * 0.5`를 더한다 (후보별 차이가 보이도록). `getTimeseries`의 gain에도 `unit(variantId)`를 곱한다.
- `previewCandidate`: `.mat` → `{kind:'mat', variables:[{name:'table', shape:[119,3], dtype:'float64'}], plot: varName ? {name, rows: 20행} : null}`, `.tir` → text.
- `health`는 `gpAvailable: false`.

- [ ] **Step 1: 테스트 작성** — `mockClient.test.ts`에:
  - `test('batch crosses params with resource candidates and tags variants')`: NEDC 후보 1개 업로드 후 `resources: {'NEDC.mat': [원본id, 새id]}`, 파라미터 3값 → job.total 6, 완료 후 `listVariants` 2개(하나는 `isOriginal`), 각 `nRuns` 3, `listRuns({variantIds:[새 variant]})`.total 3, run 순서 index 0=원본,1=새.
  - `test('uploading identical content returns the existing candidate')`: 같은 내용 다른 이름 → `existing: true`, 같은 id.
  - `test('rejects candidates with a different extension')` → ApiError 400.
  - `test('cmaes with a search-mode resource is rejected')` → 422.
  - `httpClient.test.ts`: `uploadCandidate`가 FormData(`path`, `file`)로 `POST /api/fmus/x/resources/candidates`, `listRuns({variantIds:['a','b']})` → `variantIds=a%2Cb`.
  - `select.test.ts`: `RESOURCES: 'mock'`이면 `listResources`가 mock으로 간다.
- [ ] **Step 2: 실패 확인** — `cd frontend; npx vitest run src/api` → FAIL (메서드/타입 없음).
- [ ] **Step 3: 구현** — 위 계약대로.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/api` PASS, `npx tsc --noEmit` 오류 없음 (기존 페이지가 `Run.variantId` 누락 등으로 깨지면 이 task에서 고친다).
- [ ] **Step 5: Commit** — `feat(frontend): resource/variant API contract with mock and http clients`

### Task 2: FMU 상세 — Resources 탭

**Files:**
- Create: `frontend/src/components/ResourcesPanel.tsx`, `frontend/src/components/CandidatePreview.tsx`
- Modify: `frontend/src/pages/FmuDetailPage.tsx` (탭 `Resources` 추가, value `resources`)
- Test: `frontend/src/components/ResourcesPanel.test.tsx`

**Interfaces:**
- Consumes: `listResources`, `uploadCandidate`, `deleteCandidate`, `previewCandidate`.
- Produces: `<ResourcesPanel fmuId />`, `<CandidatePreview fmuId candidateId />`.

UI: resource 표(경로, 크기, 후보 수) 행 클릭으로 펼침 → 후보 표(이름, 크기, 해시 앞 8자, `원본` 배지, run 수, `미리보기`·`삭제` 버튼; 원본은 삭제 버튼 없음). 행마다 `FileButton` "후보 업로드"(accept=원본 확장자). 업로드 결과 `existing`이면 알림 "같은 내용의 후보가 이미 있습니다: <name>". 미리보기 모달: text → `<Code block>`(+truncated 안내), mat → 변수 표 + 숫자 2D 변수 클릭 시 `ReactECharts`(`data-testid="mat-plot"`, 첫 열 x, 나머지 y), binary → note.

- [ ] **Step 1: 테스트 작성** — `ResourcesPanel.test.tsx`:
  - `lists resource files and expands candidates` (NEDC.mat, tire.tir 표시, 펼치면 `원본` 배지).
  - `uploads a candidate and shows it in the list` (userEvent.upload → 후보 2개).
  - `shows existing notice when identical content is uploaded`.
  - `previews text and mat candidates` (tire.tir → 텍스트, NEDC.mat → 변수 `table`, 클릭 → `mat-plot`의 `data-option` series 2개).
  - `original candidate has no delete button; deleting a candidate removes it`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/ResourcesPanel.test.tsx` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: Commit** — `feat(frontend): resources tab with candidate upload and preview`

### Task 3: 배치 설정 — Resource 그룹

**Files:**
- Create: `frontend/src/components/ResourceGroupSection.tsx`
- Modify: `frontend/src/pages/BatchSetupPage.tsx`
- Test: `frontend/src/pages/BatchSetupPage.test.tsx`

**Interfaces:**
- Produces: `<ResourceGroupSection fmuId mode="batch" value={Record<string,string[]>} onChange />` 와 `mode="optimize"` 변형(Task 4에서 `value: Record<string, OptResource>`). 헬퍼 `countResourceCombos(sel: Record<string,string[]>): number` (`frontend/src/lib/sweep.ts`에 추가).

UI: 파라미터 섹션 아래 Card 제목 "Resource 파일". 파일마다 한 줄: path + 후보 `Chip.Group multiple`(기본 원본만 선택, 0개 선택 불가 — 마지막 하나 해제 시 무시). 총 run 수 표시 `"총 {paramCases × combos}개 run (파라미터 {paramCases} × Resource 조합 {combos})"`. 기존 1000건 확인 모달은 총계 기준. 요청에는 원본만 선택된 path는 생략, 모두 원본이면 `resources` 생략.

- [ ] **Step 1: 테스트 작성** — `BatchSetupPage.test.tsx`에:
  - `resource group multiplies the run count` (파라미터 3값 + NEDC 후보 2개 선택 → "총 6개 run").
  - `submits selected resource candidates` (`createBatch` spy의 인자 `resources['NEDC.mat']`에 두 id).
  - `omits resources when only originals are selected`.
  - `sweep.test.ts`: `countResourceCombos({a:['1','2'], b:['x','y','z']}) === 6`, `({}) === 1`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/pages/BatchSetupPage.test.tsx src/lib/sweep.test.ts` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: Commit** — `feat(frontend): resource group in batch setup`

### Task 4: 최적화 설정 — Resource 그룹, GP, CMA-ES 제한

**Files:**
- Modify: `frontend/src/components/ResourceGroupSection.tsx`, `frontend/src/pages/OptimizationSetupPage.tsx`
- Test: `frontend/src/pages/OptimizationSetupPage.test.tsx`

UI: 파일마다 `SegmentedControl` 고정/탐색. 고정 → 후보 `Select`(기본 원본). 탐색 → 후보 멀티 Chip(2개 이상이어야 제출 가능, 미만이면 "탐색할 후보를 2개 이상 고르세요"). 방법 목록: 단일 `TPE / GP / CMA-ES / Random`, 다목적 `NSGA-II / TPE / GP`. `health().gpAvailable === false`면 GP 비활성 + Tooltip "torch 설치 필요". 탐색 모드가 하나라도 있으면 CMA-ES 비활성 + 안내 "CMA-ES는 파일 탐색(선택형 변수)을 지원하지 않습니다"; 이미 CMA-ES였으면 TPE로 바꾸고 안내를 띄운다. 요청: 고정·원본은 생략.

- [ ] **Step 1: 테스트 작성**:
  - `search-mode resource disables CMA-ES and switches to TPE`.
  - `GP is disabled when the server has no torch` (mock health false) / `GP is selectable when available` (`vi.spyOn(client,'health')` → true).
  - `submits fixed and search resources` (NEDC 탐색 2개, tire 고정 후보 → `createOptimization` 인자 확인).
  - `search mode needs at least two candidates` (제출 버튼 비활성 + 문구).
- [ ] **Step 2: 실패 확인** — `npx vitest run src/pages/OptimizationSetupPage.test.tsx` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: Commit** — `feat(frontend): resource group, GP and CMA-ES guard in optimization setup`

### Task 5: 잡 모니터 — Resource 조합 열, 최적 trial 카드, 후보별 막대

**Files:**
- Modify: `frontend/src/components/RunTable.tsx` (prop `variantLabel?: (variantId: string) => string` → 있으면 "Resource 조합" 열), `frontend/src/pages/JobMonitorPage.tsx`
- Create: `frontend/src/components/BestTrialCard.tsx`, `frontend/src/components/CandidateBarChart.tsx`
- Test: `frontend/src/pages/JobMonitorPage.test.tsx`

**Interfaces:**
- Consumes: `listVariants`, `listResources`.
- Produces: `RunTable`의 `variantLabel` prop (Task 6도 사용). `<CandidateBarChart rows variants resources path objectiveId direction />` — `data-testid="candidate-bar-<path>"`, x축 후보 이름, series 2개 `평균`, `최적`(direction 기준 min/max), 성공 run만. 후보 판정: `variant.assignment[path] ?? 원본후보id`.

화면: 잡 FMU에 variant가 2개 이상이거나 잡 config에 resources가 있으면 표에 조합 열. 단일 목적 최적화: `BestTrialCard`(`data-testid="best-trial"`, 목적값, 파라미터, 조합 이름). 다목적이면 목적 `Select`로 막대 기준 선택. 탐색 모드 path마다 `CandidateBarChart`.

- [ ] **Step 1: 테스트 작성**:
  - `batch with resources shows the resource column` (조합 이름 `원본`과 `NEDC.mat=<name>` 셀).
  - `single-objective optimization shows best trial with its resource combo`.
  - `search-mode resource shows per-candidate bars` (`candidate-bar-NEDC.mat` data-option의 xAxis.data가 후보 이름 2개).
- [ ] **Step 2: 실패 확인** — `npx vitest run src/pages/JobMonitorPage.test.tsx` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: Commit** — `feat(frontend): resource combos in job monitor`

### Task 6: 결과 화면 — 조합 필터, 열, CSV, 조합 비교

**Files:**
- Modify: `frontend/src/pages/ResultsPage.tsx`
- Test: `frontend/src/pages/ResultsPage.test.tsx`

UI: 결과 탭에 `MultiSelect` label "Resource 조합"(비우면 전체) → `listRuns({variantIds})`. RunTable에 `variantLabel`. CSV 헤더 `job,index,status,variant,<params>,<objectives>` (variant 열 = 조합 이름). 탭 추가 `Resource 조합 비교`: 목적함수 체크 → variant별 박스플롯(`data-testid="variant-boxplot"`, xAxis.data = 조합 이름, run 있는 variant만).

- [ ] **Step 1: 테스트 작성** — 기존 CSV 헤더 기대값 2개를 `job,index,status,variant,p,fuel[...]`로 수정하고:
  - `filters runs by resource combo` (spy `listRuns`가 `variantIds` 포함으로 호출, 행 수 감소).
  - `variant comparison shows a boxplot per combo`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/pages/ResultsPage.test.tsx` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — `npm test` 전체 PASS (기존 80개 + 신규), `npx tsc --noEmit`, `npm run build` 성공.
- [ ] **Step 5: Commit** — `feat(frontend): resource combo filter, CSV column and comparison`

### Task 7: 백엔드 모델, resource 색인, 마이그레이션

**Files:**
- Modify: `backend/app/models.py`, `backend/app/config.py` (`SUBDIRS`에 `"resources"`, `"variants"`), `backend/app/fmu/registry.py` (등록 시 색인, 삭제 시 정리), `backend/app/main.py` (lifespan에서 `init_db` 다음 `migrate`)
- Create: `backend/app/resources/__init__.py`, `backend/app/resources/catalog.py`, `backend/app/resources/variants.py` (id·label·`ensure_variant`만; 폴더 생성은 Task 9), `backend/app/resources/migrate.py`
- Test: `backend/tests/test_resources.py`

**Interfaces:**
- Produces:
  - 모델 `ResourceFile(fmu_id, path, size, sha256)` PK `(fmu_id, path)`; `ResourceCandidate(id, fmu_id, path, name, sha256, size, is_original, created_at)` unique `(fmu_id, path, sha256)`; `Variant(id, fmu_id, assignment: dict[str,str], created_at)`; `Run.variant_id: Mapped[str | None]` 인덱스.
  - `catalog.candidate_id(fmu_id, path, sha) -> str`, `catalog.index_resources(session, fmu_id, extract_dir: Path) -> None` (파일·원본 후보·원본 variant 생성, 멱등), `catalog.candidate_path(settings, cand) -> Path` (원본이면 extract_dir/resources/path).
  - `variants.variant_id(fmu_id, replaced: list[tuple[str, str]]) -> str`, `variants.original_variant_id(fmu_id) -> str`, `variants.ensure_variant(session, fmu_id, assignment: dict[str, str]) -> Variant` (assignment는 path→candidate_id, 원본 후보는 제거 후 id 계산, 없으면 생성), `variants.variant_label(session, variant) -> str`.
  - `migrate.migrate(engine, session_factory, settings) -> None`: `runs.variant_id` 없으면 `ALTER TABLE runs ADD COLUMN variant_id VARCHAR(16)` + 인덱스; resource 색인 없는 FMU마다 `index_resources`(압축해제 폴더 없으면 resource 없음); `variant_id IS NULL`인 run을 원본 variant로.

- [ ] **Step 1: 테스트 작성** — `test_resources.py`:
  - `test_variant_id_ignores_order_and_is_deterministic`, `test_original_variant_is_empty_assignment`.
  - `test_index_resources_records_files_and_original_candidates` (tmp extract dir에 `resources/a.mat`, `resources/sub/b.tir` → path `a.mat`, `sub/b.tir`, 원본 후보 2개, 원본 variant 1개, 두 번 호출해도 동일).
  - `test_upload_real_fmu_indexes_resources(client, uploaded_fmu)` → DB에 `NEDC.mat`, `RoadWithStops.mat`, `StraightRoad.mat`.
  - `test_migrates_old_db_without_variant_id(tmp_path)`: 현재 스키마로 앱 한 번 띄워 `seed_fake_fmu` + Job + Run 삽입 → 엔진으로 `ALTER TABLE runs DROP COLUMN variant_id`, `DROP TABLE resource_candidates/resource_files/variants` → 앱 재시작 → run의 `variant_id == original_variant_id(FMU_ID)`.
- [ ] **Step 2: 실패 확인** — `cd backend; .venv\python.exe -m pytest tests/test_resources.py` FAIL (모듈 없음).
- [ ] **Step 3: 구현.** `delete_fmu`는 해당 FMU의 candidates/variants/resource_files 행과 `data/resources/<fmu_id>`, 그 FMU variant들의 `data/variants/<vid>`를 지운다.
- [ ] **Step 4: 통과 확인** — `.venv\python.exe -m pytest` 전체 PASS (기존 126 + 신규).
- [ ] **Step 5: Commit** — `feat(backend): resource catalog, variants model and migration`

### Task 8: 후보 API (목록·업로드·삭제·미리보기·variant 목록)

**Files:**
- Create: `backend/app/routers/resources.py`, `backend/app/resources/preview.py`
- Modify: `backend/app/resources/catalog.py` (`add_candidate`, `delete_candidate`, `list_resources`), `backend/app/schemas.py` (`ResourceCandidateOut`, `ResourceFileOut`, `CandidateUploadOut`, `CandidatePreviewOut`(kind별 필드 optional), `VariantOut`), `backend/app/main.py` (router 등록)
- Test: `backend/tests/test_resources_api.py`

**Interfaces:**
- Produces: `catalog.add_candidate(session, settings, fmu_id, path, src: BinaryIO, name) -> tuple[ResourceCandidate, bool]` (스트리밍 해시, 임시파일 → `data/resources/<fmu_id>/<sha>`; 원본과 같은 sha면 원본 후보 반환), `catalog.delete_candidate(...)` (원본 → `ValueError`, run 있는 variant가 쓰면 `CandidateInUse`; 아니면 후보 + 그 후보를 쓰는 run 없는 variant와 폴더 삭제), `preview.preview(path: Path, var: str | None) -> dict`.
- 미리보기 규칙: 확장자 `.mat`이면 `scipy.io.whosmat` → mat (실패 시 `NotImplementedError`/`ValueError` → binary note `"MATLAB v7.3(HDF5) 등 미리보기를 지원하지 않는 형식입니다"`); `var`가 숫자 배열이면 2D로 맞춰(1D → 열 하나) 행을 균등 간격으로 2000개 이하. 그 외: 앞 8KB에 NUL 없으면 UTF-8 → cp949 → latin-1 디코드, 256KB까지 text + `truncated`. 아니면 binary note `"미리보기를 지원하지 않는 바이너리 파일입니다"`.
- `nRuns`(후보) = 그 후보를 assignment에 가진 variant(원본 후보는 원본 variant)의 run 수 합.

- [ ] **Step 1: 테스트 작성** — fake FMU 대신 실제 `uploaded_fmu` 사용:
  - `test_list_resources_has_original_first`.
  - `test_upload_candidate_201_then_same_content_200_existing` (이름만 다른 같은 내용).
  - `test_upload_same_as_original_returns_original` (Review Focus 1).
  - `test_upload_wrong_extension_400`, `test_upload_unknown_path_404`.
  - `test_korean_candidate_name_and_subfolder_path` — `index_resources`로 `sub/표.csv` 경로를 가진 FMU를 tmp에 구성해 업로드 이름 `한글.csv` → 파일은 sha 이름으로 저장, 응답 name 한글 (Review Focus 3).
  - `test_preview_mat_variables_and_plot` (NEDC.mat → `table` (119,3); `var=table` → rows ≤2000, 각 행 3개), `test_preview_text`, `test_preview_binary`.
  - `test_delete_original_400`, `test_delete_unused_candidate_204`, `test_delete_candidate_in_use_409` (그 후보 variant로 Run 행을 직접 삽입).
  - `test_list_variants_labels` (`원본`).
- [ ] **Step 2: 실패 확인** — `.venv\python.exe -m pytest tests/test_resources_api.py` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 전체 pytest PASS.
- [ ] **Step 5: Commit** — `feat(backend): resource candidate API and preview`

### Task 9: variant 폴더 생성 + 배치 resource + run 조회

**Files:**
- Modify: `backend/app/resources/variants.py` (`materialize`), `backend/app/jobs/runner.py`, `backend/app/schemas.py` (`BatchRequest.resources: dict[str, list[str]] = {}`, `RunOut.variant_id: str`), `backend/app/results/query.py` + `backend/app/routers/runs.py` (`variantIds`)
- Test: `backend/tests/test_variant_runs.py`

**Interfaces:**
- Produces:
  - `variants.materialize(settings, session, variant: Variant) -> Path` — 원본 variant면 `get_extract_dir`. 아니면 `data/variants/<id>/`가 있으면 그대로, 없으면 `data/variants/.tmp-<id>-<uuid>`에 원본 폴더를 복제(파일은 `os.link`, 실패 시 `shutil.copy2`)하고 교체 파일은 **실제 복사**(링크된 원본 파일을 덮어쓰지 않도록 먼저 unlink) 후 `os.replace`/rename; rename 실패(이미 생김)면 tmp 삭제 후 기존 사용. 모듈 수준 `threading.Lock` dict로 variant별 직렬화.
  - `CaseSpec(index, params, variant_id: str | None = None)` — None = 원본 variant.
  - `JobManager.run_cases`가 case마다 `variant_id`로 폴더를 구해(dict 캐시) `SimTask.extract_dir`에 넣고 `_record`가 `Run.variant_id` 저장.
  - `JobManager._resolve_resources(session, fmu_id, sel: dict[str, list[str]]) -> list[dict[str, str]]` — 검증(path 존재, 후보가 그 FMU·path 소속, 목록 비어 있지 않음; 위반 시 `JobValidationError`), path 정렬 직곱.
  - `submit_batch`: 케이스 = 파라미터 케이스 × 조합, `ensure_variant`로 variant id 확정, `total` = 곱.
  - `RunQuery.variant_ids`, `RunRow.variant_id`.

- [ ] **Step 1: 테스트 작성** (`rclient` 패턴처럼 `fake_sim` 사용; fake sim이 `task.extract_dir/resources/<path>` 내용을 결과 컬럼으로 쓰도록 `tests/_tasks.py`에 `resource_echo_sim` 추가):
  - `test_batch_crosses_resources_and_tags_variants` — 파라미터 2값 × 후보 2개 → total 4, index 0..3 순서 (p0-원본, p0-후보, p1-원본, p1-후보), variant 2개.
  - `test_variant_dir_contains_replaced_file_and_original_untouched` — 교체 파일 내용 = 업로드 내용, `data/extract/<fmu>/resources/...` 내용 변화 없음.
  - `test_concurrent_materialize_same_variant` — 스레드 4개 동시 `materialize` → 같은 경로, `.tmp-*` 잔여 없음 (Review Focus 5).
  - `test_runs_filter_by_variant_ids`.
  - `test_batch_rejects_candidate_from_other_path_or_fmu` → 422.
- [ ] **Step 2: 실패 확인** — `.venv\python.exe -m pytest tests/test_variant_runs.py` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 전체 pytest PASS.
- [ ] **Step 5: Commit** — `feat(backend): variant materialization and resource batches`

### Task 10: 최적화 resource + GP + health

**Files:**
- Modify: `backend/app/jobs/optimize.py`, `backend/app/jobs/runner.py` (`submit_optimization`), `backend/app/schemas.py` (`OptResourceFixed`, `OptResourceSearch` discriminated by `mode`, `OptimizationRequest.resources: dict[str, OptResource] = {}`, `algorithm`에 `"gp"`, `Health.gp_available`), `backend/app/main.py`, `backend/pyproject.toml` (`gp = ["torch==<설치 시점 최신 안정판>"]` — 이 세션에서는 설치하지 않는다)
- Test: `backend/tests/test_optimize.py`

**Interfaces:**
- Produces: `optimize.gp_available() -> bool` (`importlib.util.find_spec("torch") is not None`), `make_sampler("gp", ...)` → `optuna.samplers.GPSampler(seed=seed)`. `Optimization(req, codes, evaluator, resolve_variant: Callable[[dict[str, str]], str])` — `cases()`가 고정·탐색 선택을 모아 `resolve_variant`로 variant id를 얻어 `CaseSpec(..., variant_id=...)`.
- 검증(422): 탐색 후보 < 2 `"탐색할 후보를 2개 이상 고르세요"`, CMA-ES + 탐색 `"CMA-ES는 파일 탐색(선택형 변수)을 지원하지 않습니다"`, `gp`인데 `gp_available()` False `"GP를 쓰려면 torch를 설치하세요 (pip install -e \"backend[gp]\")"`, 후보 소속 불일치.

- [ ] **Step 1: 테스트 작성**:
  - `test_search_resource_trials_record_variants` (fake sim, 탐색 후보 2개, n_trials 8, seed 고정 → 모든 run에 variant_id, 두 variant 모두 등장 — 등장하지 않으면 n_trials를 늘려 결정적으로 만든다).
  - `test_fixed_resource_uses_single_variant`.
  - `test_cmaes_with_search_resource_422`, `test_search_needs_two_candidates_422`.
  - `test_gp_unavailable_422` (`monkeypatch.setattr(optimize, "gp_available", lambda: False)`), `test_health_reports_gp_available`.
- [ ] **Step 2: 실패 확인** — `.venv\python.exe -m pytest tests/test_optimize.py` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 전체 pytest PASS.
- [ ] **Step 5: Commit** — `feat(backend): resource-aware optimization and optional GP sampler`

### Task 11: 실제 FMU 검증 + 문서

**Files:**
- Create: `backend/tests/test_resources_real.py`
- Modify: `README.md` (resource 후보·조합 누적·GP 설치 절. 기존 미커밋 `run.bat` 안내 줄은 그대로 두고 `run.bat`도 이 커밋에 포함)

**Interfaces:**
- Consumes: 전부. 실제 `run_simulation` 사용 (기본 sim_fn).

테스트 헬퍼 `make_nedc_dummy(src: Path, dst: Path, k: float)` — `scipy.io.loadmat` → `table[:,1] *= k` → `savemat(format="4")`.

- [ ] **Step 1: 테스트 작성** (sim `stopTime 90, outputInterval 0.1`, 기록 변수 `controlBus.chassisBus.longitudinalVelocity`, 파라미터는 기본값과 같은 값 1개 — 변수 목록에서 `start`가 있는 Real parameter 하나를 골라 그 start 값으로):
  - `test_nedc_dummies_accumulate_as_separate_variants` — 원본 + ×0.8 + ×1.2 배치 → variant 3개, 평균 속도 ≈ 3.817 / 3.014 / 4.511 (abs 0.05).
  - `test_reupload_renamed_dummy_reuses_variant` — ×0.8을 다른 이름으로 재업로드 → `existing`, 다시 배치 → 같은 variant의 `nRuns` 증가.
  - `test_variants_alternate_in_one_worker` — `workers=1`, 파라미터 2값 × 3조합 = 6 run (원본, ×0.8, ×1.2 반복) → 같은 조합끼리 평균이 같고 조합 사이는 다름 (Review Focus 2).
  - `test_text_resource_candidate` — 테스트 FMU zip에 `resources/dummy.tir`(텍스트) 추가한 사본을 업로드 → 목록에 `dummy.tir`, 미리보기 text, 후보 업로드 후 배치(run 1개) → `data/variants/<vid>/resources/dummy.tir` 내용 = 후보 내용. (이 모델은 .tir을 읽지 않으므로 결과 영향은 검증 대상 아님.)
  - `test_search_optimization_on_nedc` — TPE, NEDC 탐색(원본, ×0.8), n_trials 6, 목적함수 `mean(longitudinalVelocity)` maximize → 모든 run에 variant, 잡 done.
- [ ] **Step 2: 실패 확인 후 통과 확인** — Task 7–10이 끝났으므로 바로 통과할 수 있다; 각 테스트의 단언이 실제로 조합을 구분하는지 확인하려고 `make_nedc_dummy`의 k를 1.0으로 바꿔 한 번 돌려 `test_nedc_dummies...`가 FAIL하는 것을 본 뒤 되돌린다.
  Run: `.venv\python.exe -m pytest tests/test_resources_real.py -v` → PASS.
- [ ] **Step 3: 이전 DB 수동 확인** — `backend/data`를 scratchpad로 복사 → `FMUC_DATA_DIR`로 지정해 서버 기동 → `/api/fmus/<id>/variants`에 `원본` + 기존 run 수, `/api/runs?fmuId=...` 항목에 `variantId`. 원본 `backend/data`는 건드리지 않는다.
- [ ] **Step 4: 전체 확인** — `cd backend; .venv\python.exe -m pytest`, `cd frontend; npm test; npm run build` 모두 PASS.
- [ ] **Step 5: Commit** — `test: real-FMU resource variant verification; docs`
