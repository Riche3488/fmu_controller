# Resource 후보 파일 · Resource 조합별 누적 · 최적화 보강 — 설계

기존 설계: `2026-10-29-fmu-controller-requirements.md`. 이 문서는 그 위에 얹는 추가 기능이다. 기존 원칙(목적함수 값은 저장하지 않고 조회 시 최신 코드로 계산, DB에는 시계열만, Ray/Pool 병렬)은 그대로 유지한다.

## 왜

FMU는 `resources/` 아래 외부 파일(주행 사이클 `.mat`, 타이어 `.tir`, 표 `.csv` 등)을 읽는다. 사용자는 이 파일을 밖에서 직접 고친 dummy 파일을 여러 개 만들어 두고, 그 후보들 중 일부를 골라 배치 해석·최적화를 돌리고 싶다. 파일 내용이 다르면 물리적으로 다른 해석이므로 결과도 따로 누적되어야 한다.

특정 예제 FMU가 아니라 **임의의 FMU, 임의의 파일 형식**에서 동작해야 한다.

## 사전 확인 (이 세션의 spike)

테스트 FMU(`my_0test_DriveCycleAT.fmu`, resources: `NEDC.mat`, `RoadWithStops.mat`, `StraightRoad.mat`)로 확인:

- FMU를 푼 폴더의 `resources/` 파일을 바꿔치기하면 FMPy가 넘기는 resource 위치를 통해 모델이 바뀐 파일을 읽는다.
  - `NEDC.mat`의 속도 열 ×0.8 / ×1.2 → 평균 종방향 속도 3.817 → 3.014 / 4.511.
- `NEDC.mat`을 지우면 초기화 실패, `RoadWithStops.mat`·`StraightRoad.mat`은 지워도 결과 동일 → 이 모델은 실제로 `NEDC.mat`만 읽는다. **어떤 파일을 모델이 읽는지는 앱이 알 수 없다** (모든 resource 파일을 똑같이 교체 가능하게 다룬다).
- `scipy.io.savemat(format="4")`로 변경 없이 다시 저장한 파일은 결과가 원본과 동일하다 (dummy 생성 방법으로 사용 가능).

## 목표

1. FMU의 resource 파일 목록과 내용을 화면에서 본다 (종류별 미리보기).
2. resource 파일 하나마다 사용자가 밖에서 만든 **후보 파일**을 여러 개 업로드해 둔다.
3. 배치 설정에서 FMU 파라미터 그룹과 **분리된 Resource 그룹**에서 파일별로 후보를 여러 개 체크 → 파라미터 케이스 × resource 조합 전부 실행.
4. 최적화 설정에서도 Resource 그룹: 파일별로 **고정**(후보 1개) 또는 **탐색**(후보 여러 개 중 최적화가 선택).
5. "FMU + resource 조합"(= **Resource 조합**, 이하 variant)이 다르면 다른 해석 → run이 variant에 묶여 따로 누적·조회·비교된다.
6. 최적화 방법에 GP 베이지안 추가(선택 설치), 모니터링에 resource 정보 추가.

## 비목표 / 안티목표

- 비목표: 앱 안에서 resource 파일을 편집하거나 배율·오프셋으로 자동 생성하는 기능 (사용자가 밖에서 만들어 업로드).
- 비목표: FMU에 원래 없던 경로의 파일을 새로 추가하는 것 (기존 resource 파일의 교체만).
- 비목표: 모델이 어떤 resource를 실제로 읽는지 자동 판별.
- 안티목표: 원본 FMU 파일이나 원본 압축해제 폴더가 바뀌는 것.
- 안티목표: 내용이 다른 파일인데 같은 variant로 섞여 쌓이는 것, 또는 같은 내용인데 이름이 달라서 다른 variant로 갈라지는 것.
- 안티목표: 특정 확장자(`.mat`)나 특정 FMU를 전제로 한 코드.

## 개념과 식별

| 개념 | 정의 | 식별 |
|---|---|---|
| Resource 파일 | FMU 안 `resources/` 아래의 파일 하나 (하위 폴더 포함, 경로는 `resources/` 기준 상대경로, `/` 구분) | `(fmu_id, path)` |
| 후보(candidate) | 어떤 resource 파일 자리에 넣을 수 있는 파일 내용. 원본 파일도 후보 하나로 취급(`is_original`) | `(fmu_id, path, sha256)` — 내용 해시. id는 16자 hex |
| Variant (Resource 조합) | FMU + "원본이 아닌 후보로 바꾼 파일들"의 집합 | `sha256(fmu_id + 정렬된 (path, 후보 sha256) 목록 — 원본 후보는 제외)[:16]`. 아무것도 안 바꾼 조합 = 원본 variant |

- 같은 내용을 다른 이름으로 다시 올리면 기존 후보를 돌려준다(이름은 기존 것 유지, 응답에 `existing: true`). 원본과 내용이 같은 파일을 올리면 원본 후보를 돌려준다.
- variant id가 내용 해시로만 결정되므로 같은 조합은 어느 잡에서 만들어져도 같은 variant에 쌓인다.
- variant 표시 이름: 원본이면 `원본`, 아니면 `NEDC.mat=nedc_x0.8.mat, tire.tir=tireB.tir` (파일 basename=후보 이름, path 순).

## 데이터 모델 (SQLite)

- `resource_files`: `fmu_id`, `path`, `size`, `sha256` — FMU 등록 시 압축해제 폴더에서 수집.
- `resource_candidates`: `id`, `fmu_id`, `path`, `name`(업로드 파일명), `sha256`, `size`, `is_original`, `created_at`. 업로드 파일 저장 위치 `data/resources/<fmu_id>/<sha256>` (원본 후보는 압축해제 폴더의 파일을 가리킨다).
- `variants`: `id`, `fmu_id`, `assignment`(JSON `{path: candidate_id}` — 원본이 아닌 것만), `created_at`.
- `runs.variant_id` 추가 (NOT NULL 의미, 인덱스).
- **기존 데이터 마이그레이션**: 시작 시 `runs.variant_id` 컬럼이 없으면 `ALTER TABLE`로 추가하고, 기존 FMU마다 `resource_files`·원본 후보·원본 variant를 만들고 기존 run을 원본 variant로 채운다. 기존 `backend/data`가 그대로 열려야 한다.

## 실행 방식

- variant 폴더: `data/variants/<variant_id>/` = 원본 압축해제 폴더의 복제 + 교체 파일 덮어쓰기. 원본 variant는 원본 압축해제 폴더를 그대로 쓴다.
- 잡 스레드가 run을 제출하기 전에 필요한 variant 폴더를 만든다 (워커는 경로만 받는다 → Ray/Pool 모두 그대로). 생성은 임시 폴더 → rename으로 원자적, variant별 락으로 중복 생성 방지, 이미 있으면 재사용. (구현: 배치는 실행 전에 모든 조합 폴더를 미리 만들고, 준비에 실패한 조합은 잡 안에서 기억해 다시 복사하지 않는다.)
- `SimTask.extract_dir`에 variant 폴더를 넘긴다. 나머지 시뮬레이션 로직(작업 디렉터리 분리, 검증 등)은 동일.
- 복제 방식은 빌더 재량: 하드링크(같은 볼륨)로 공간을 아끼되, **같은 워커 프로세스가 서로 다른 variant의 DLL을 연달아 로드해도 결과가 섞이지 않는지** 실제 FMU 테스트로 확인하고, 문제가 있으면 `binaries/`는 실제 복사.
- FMU 삭제(기존 규칙: 잡이 있으면 409) 시 후보 파일·variant 폴더도 지운다.

## API (추가/변경)

- `GET /api/fmus/{id}/resources` → resource 파일 목록, 각 파일의 후보 목록(id, name, size, sha256, isOriginal, nRuns = 그 후보를 쓰는 variant의 run 수).
- `POST /api/fmus/{id}/resources/candidates` (multipart: `path`, `file`) → 후보 생성 또는 기존 후보 반환. 원본과 확장자가 다르면(대소문자 무시) 400. 없는 path면 404.
- `DELETE /api/fmus/{id}/resources/candidates/{cid}` → 원본은 400, run이 있는 variant에서 쓰이면 409.
- `GET /api/fmus/{id}/resources/candidates/{cid}/preview[?var=<name>]`
  - 텍스트(앞 8KB에 NUL 없음, UTF-8 → 실패 시 cp949 → latin-1 디코드): `{kind:'text', text, truncated}` — 최대 256KB. 잘린 경우 인코딩마다 끝 1~3바이트를 버려 가며 디코드한다. `.mat` 1×N 행 벡터는 N×1 열로 바꿔 그린다.
  - `.mat`(scipy로 읽히는 v4/v5): `{kind:'mat', variables:[{name, shape, dtype}]}`; `var`를 주면 해당 숫자 2D 배열을 최대 2000행으로 줄여 `{kind:'mat', variables, plot:{name, rows}}` (첫 열 x, 나머지 열 y).
  - 그 외(v7.3 mat 포함): `{kind:'binary', note}`.
- `GET /api/fmus/{id}/variants` → variant 목록(id, label, assignment, nRuns).
- `GET /api/runs`: `variantIds` 필터 추가, 응답 행에 `variantId`.
- `BatchRequest.resources?: {path: candidateId[]}` — 각 목록 1개 이상. 생략/빈 객체 = 원본.
- `OptimizationRequest.resources?: {path: {mode:'fixed', candidateId} | {mode:'search', candidateIds: string[≥2]}}`.
- `algorithm`에 `'gp'` 추가. `Health`에 `gpAvailable: boolean` (서버가 `torch`를 import할 수 있는지). 불가할 때 `gp` 요청은 422.
- 검증(422): 다른 FMU의 후보 id, path 불일치, 탐색 모드에서 후보 2개 미만, CMA-ES + 탐색 모드 resource.

## 배치

- 케이스 = (파라미터 샘플링 결과) × (resource 조합의 직곱). resource는 샘플링 방식(grid/zip/lhs/random)과 무관하게 항상 직곱. run index는 파라미터 케이스 바깥, resource 조합 안쪽 순서로 0부터.
- run마다 `variant_id` 저장. `run.params`에는 FMU 파라미터만 (resource 선택은 variant로 표현).

## 최적화

- 탐색 모드 resource는 `trial.suggest_categorical("resource:<path>", candidateIds)`; 고정 모드는 그 후보로 고정. trial이 만든 run은 선택된 조합의 variant에 저장 → 한 잡 안에 여러 variant가 섞여도 각 run은 자기 variant에 누적된다.
- 방법: 기존 TPE / CMA-ES / Random / NSGA-II 유지 + GP(`optuna.samplers.GPSampler`, torch 필요, `pip install -e "backend[gp]"` 선택 설치). GP가 다목적·범주형을 지원하는 범위는 설치된 Optuna 버전 기준으로 빌더가 확인해 UI 선택지를 맞춘다.
- CMA-ES는 탐색 모드 resource가 있으면 선택 불가(UI 비활성 + 이유 안내, 서버도 422).

## 화면

- **FMU 상세 → Resources 탭**: resource 파일 표(경로, 크기, 후보 수). 행을 펼치면 후보 목록(이름, 크기, 해시 앞 8자, 원본 표시, run 수, 미리보기, 삭제), 후보 업로드 버튼(같은 확장자만). 미리보기: 텍스트는 고정폭 텍스트, `.mat`은 변수 표 + 변수 선택 시 선 그래프, 그 외는 크기·해시.
- **배치 설정**: 기존 파라미터 섹션 아래 별도 "Resource 파일" 섹션. 파일마다 한 줄, 후보 멀티 체크(기본: 원본만 체크). 총 run 수 = 파라미터 케이스 수 × 조합 수를 즉시 표시.
- **최적화 설정**: "Resource 파일" 섹션, 파일마다 고정/탐색 전환 + 후보 선택. 방법 선택에 GP 추가(`gpAvailable`이 false면 비활성 + "torch 설치 필요").
- **잡 모니터링**: trial/run 표에 Resource 조합 열. 단일 목적: 현재 최적 trial 요약 카드(목적값, 파라미터, resource 조합). 탐색 모드 resource가 있으면 resource 파일별로 후보마다 성공 trial의 평균·최적 목적값 막대그래프(다목적이면 목적 선택). 기존 수렴 곡선·Pareto는 유지.
- **결과 화면**: "Resource 조합" 멀티 선택 필터, 표에 조합 열, CSV에 `variant` 열. 비교 탭에 "Resource 조합 비교"(같은 FMU의 variant별 박스플롯) 추가, 기존 FMU 비교 유지.
- UI 우선 정책 유지: mock 클라이언트(`frontend/src/api/mock`)도 새 API를 구현한다.

## 검증 (구현 세션에서 수행)

- dummy 생성: 원본 `NEDC.mat`의 2번째 열(속도) ×0.8, ×1.2를 `savemat(format="4")`로 저장한 두 파일 (테스트에서 생성, 저장소에 바이너리 커밋하지 않음).
- 실제 FMU 테스트: 원본 + dummy 2개를 체크한 배치 → variant 3개, 각 run이 맞는 variant에 쌓이고 평균 속도가 서로 다름(spike 값 근처). 같은 dummy를 이름만 바꿔 재업로드 → 기존 후보 반환, 다시 돌린 run이 기존 variant에 이어 쌓임.
- 텍스트 resource: 테스트 FMU를 다시 묶어 `resources/dummy.tir`(텍스트)를 추가한 FMU로 목록·미리보기·후보 교체를 확인한다. 이 모델은 `.tir`을 읽지 않으므로 **결과 영향은 확인할 수 없고**, variant 폴더에 교체된 내용이 들어가는 것까지 확인한다.
- 최적화: NEDC 탐색 모드 + 파라미터 1개로 TPE 실행, trial마다 variant가 기록되고 모니터링 막대그래프가 후보별로 나오는지.
- 기존 `backend/data`(이전 버전 DB)로 서버가 뜨고 기존 run이 원본 variant로 보이는지.

## 빌더 재량으로 남긴 것

- 복제 방식(하드링크/복사)의 세부, 미리보기 텍스트 인코딩 판별의 세부, 컴포넌트 구조와 화면 배치 세부, 후보 업로드 크기 제한(기존 FMU 업로드와 같은 처리 방식).
- 내가 정한 것(사용자 확인 전): 원본과 같은 확장자만 허용, resource는 항상 직곱, 탐색 모드 최소 2개, GP 선택 설치, variant 표시 이름 형식.
