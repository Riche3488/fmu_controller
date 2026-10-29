# CLAUDE.md

FMU 파라미터·`resources/` 파일을 바꿔 가며 배치 해석·최적화를 돌리고 결과를 쌓아 보는 **로컬 전용** 웹 앱.
사용법·설치는 `README.md`, 설계 배경은 `docs/superpowers/specs/`를 본다.

## 명령

```powershell
# 백엔드 (Python 3.12, backend\.venv)
cd backend; .venv\python.exe -m pytest                 # 전체 (실제 FMU 테스트는 ..\my_0test_DriveCycleAT.fmu, FMUC_TEST_FMU로 변경)
cd backend; .venv\python.exe -m pytest tests/test_x.py  # 파일 하나

# 프론트엔드
cd frontend; npm test          # vitest
cd frontend; npx tsc -b        # 타입체크
cd frontend; npm run lint      # 경고(react-refresh 등)는 기존부터 있음, 오류 0이어야 함

.\run.ps1 [-Parallel pool] [-Build]   # 프론트 빌드 + 서버 실행 (127.0.0.1:8000)
```

## 구조

- `backend/app/`
  - `main.py` — `create_app()` 팩토리. lifespan에서 DB·마이그레이션·executor·`JobManager` 생성, Host/Origin 가드.
  - `config.py` `Settings` (환경변수 `FMUC_*`), `paths.py` data 폴더 안 경로(FMU 파일, 압축해제 폴더, variant 폴더).
  - `fmu/` 등록(`registry.py`, 내용 해시 id)·시뮬레이션(`simulate.py`, 워커에서 실행).
  - `resources/` 후보 파일(`catalog.py`), Resource 조합=variant(`variants.py`, 실행 폴더 생성), 미리보기(`preview.py`), 구 DB 보정(`migrate.py`).
  - `jobs/runner.py` `JobManager`: 잡마다 스레드 하나, 모든 잡이 시뮬레이션 슬롯(`_slots`)을 공유. `optimize.py`(Optuna), `sampling.py`(grid/zip/lhs/random).
  - `routers/presets.py` 프리셋 CRUD — `kind` = `batch`/`optimization`/`dashboard`(작업대 레이아웃). kind별 설정 스키마로 검사한 JSON만, resource는 후보 sha256으로 기록.
  - `objectives/` 목적함수 코드 저장·평가(별도 executor). `POST /api/objectives/test-batch`는 저장 전 코드로 run 여러 개를 계산(run별 오류). `parallel/` Ray 또는 `multiprocessing.Pool`. `results/` Parquet 저장·조회.
  - `schemas.py` — API 스키마. **`frontend/src/api/types.ts`와 같은 형태(JSON camelCase)를 유지**한다.
- `frontend/src/`
  - `api/client.ts` `ApiClient` 인터페이스 + `http/`(실서버)와 `mock/`(인메모리) 구현. 도메인별 `VITE_API_<DOMAIN>=mock`.
  - `pages/`, `components/` (Mantine + ECharts + Monaco), `lib/` 순수 함수. 프리셋 ↔ 폼 변환은 `lib/presets.ts`, 메뉴 바와 공통 동작은 `components/PresetMenuBar.tsx`·`usePresetEditor.tsx`(Ctrl+S는 문서 전역이라 한 화면에 하나만).
  - `pages/workspace/` FMU 작업공간 단계(①모델 ~ ⑤결과 분석)와 단계 바. ⑤ `ResultsStep`은 상단 필터(`components/ResultsFilters.tsx`) 아래 작업대/결과 표/비교 탭, run 선택은 `SelectionProvider` 하나로 공유.
  - `components/objective/` + `lib/builder/` 목적함수 설계 도구: 블록 스펙 → TS 미리보기 평가(`evaluate.ts`)와 Python 코드 생성(`codegen.ts`, 둘의 의미·오류 문구는 같아야 함). 생성 코드 첫 줄 `# fmuc-builder: <스펙 JSON>`으로 빌더에 다시 연다.
  - `components/workbench/` + `lib/charts/` 시각화 작업대: 차트 빌더 `(spec, data, selected, ts?) => EChartsOption | { empty }`(`lib/charts/index.ts` `CHART_BUILDERS`), 대시보드 프리셋은 `?dashboard=<id>`로 열린다.
  - React Query 키: `['resources', fmuId]`, `['variants', fmuId]`, `['runs', ...]`, `['job', id]`, `['presets', kind]` 등. 공용 훅은 `components/ResourceGroupSection.tsx`의 `useResources`/`useVariants`.

## 지켜야 할 규칙

- **목적함수 값은 DB에 저장하지 않는다.** 조회 시 현재 코드로 다시 계산하고 코드 해시를 함께 보여 준다. 최적화만 제출 시점 코드로 진행한다.
- FMU·후보·variant id는 모두 **내용 해시**로 정한다 (이름·업로드 순서 무관). variant id = FMU id + (path, 후보 sha256) 목록.
- 원본 FMU와 압축해제 폴더는 바꾸지 않는다. variant 폴더(`data/variants/<id>/`)는 하드링크 복제 후 교체 파일만 링크를 끊고 복사한다.
- 데이터 경로는 ASCII만 (FMU DLL 로딩 문제). run마다 `data/work/<run_id>/`를 작업 디렉터리로 쓴다.
- 세션을 받은 함수 안에서 `session.rollback()`으로 충돌을 처리하지 말 것 — 호출자의 미커밋 작업까지 사라진다. 경쟁 INSERT는 `on_conflict_do_nothing()`을 쓴다 (`variants.ensure_variant` 참고).
- 후보 삭제와 잡 제출(후보 검증 ~ 잡 commit)은 `catalog.candidates_lock`으로 직렬화한다. 잡 설정이 참조하는 후보는 `catalog.config_candidate_ids()`로 구한다.
- 순환 import를 피하려고 data 경로 함수는 `app/paths.py`에 둔다 (`catalog` ↔ `variants`만 함수 안 import 하나가 남아 있다).
- 서버는 `127.0.0.1`에만 바인딩한다. 목적함수 `.py`는 서버에서 그대로 실행되는 코드다.

## 코드 스타일

- 주석·docstring·사용자에게 보이는 오류 메시지는 **한국어**, 식별자는 영어. 기존처럼 주석은 "왜"만 짧게.
- 백엔드 소스는 CRLF 줄바꿈인 파일이 많다. 편집 시 기존 줄바꿈을 유지한다.
- 버그 수정은 재현 테스트를 함께 추가한다 (예: `tests/test_review_fixes*.py`). 프론트 테스트는 mock client로 렌더한다 (`src/test/render.tsx`).
- 실제 FMU 테스트(`test_fmus.py`, `test_resources_real.py` 등)는 저장소 루트의 `my_0test_DriveCycleAT.fmu`가 필요하다.
