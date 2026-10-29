# FMU Controller

FMU 파라미터와 `resources/` 파일을 병렬로 바꿔 가며 배치 해석·최적화(단일/다목적)를 수행하고, 결과 시계열을 FMU·Resource 조합별로 누적·조회·비교하는 로컬 웹 앱입니다.

- 백엔드: Python 3.12, FastAPI, FMPy(ModelExchange/CVode), Ray(불가 시 `multiprocessing.Pool`), SQLite + Parquet, Optuna
- 프론트엔드: React + Mantine + Monaco + ECharts (Vite)

## 설치

```powershell
# Python 3.12 환경 (miniconda 사용 예)
conda create -p backend\.venv -c conda-forge python=3.12 pip -y
backend\.venv\python.exe -m pip install -e "backend[ray,test]"

# 프론트엔드
cd frontend; npm install; cd ..
```

Ray 설치가 안 되는 환경이면 `pip install -e "backend[test]"`만 설치하세요. 서버가 자동으로 Pool로 대체합니다.

GP(Gaussian Process) 베이지안 최적화를 쓰려면 PyTorch가 필요합니다: `backend\.venv\python.exe -m pip install -e "backend[gp]"`. 설치하지 않으면 최적화 화면에서 GP가 비활성으로 표시됩니다 (TPE는 항상 사용 가능).

## 실행

탐색기에서 `run.bat`을 더블클릭하면 서버가 뜨고 준비되는 대로 브라우저가 열립니다. 인자는 `run.ps1`과 같습니다 (`run.bat -Parallel pool`). 인자를 주면 브라우저는 자동으로 열지 않습니다.

```powershell
.\run.ps1                  # http://127.0.0.1:8000
.\run.ps1 -Parallel pool   # Ray 없이
.\run.ps1 -Workers 6 -Build
```

서버는 `127.0.0.1`에만 바인딩되고, Host가 `127.0.0.1`/`localhost`가 아닌 요청과 다른 사이트(Origin)에서 온 쓰기 요청은 거절합니다. 목적함수 `.py`는 서버에서 그대로 실행되는 코드이므로 외부에 노출하지 마세요.

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `FMUC_DATA_DIR` | `backend/data` | DB·FMU·결과 저장 위치 (**ASCII 경로만**) |
| `FMUC_PARALLEL` | `auto` | `auto` / `ray` / `pool` |
| `FMUC_MAX_WORKERS` | CPU 수 − 1 | 시뮬레이션 병렬 슬롯 수 (모든 잡이 공유) |
| `FMUC_EVAL_WORKERS` | 2 | 목적함수 평가 전용 슬롯 수 (시뮬레이션과 분리) |
| `FMUC_STATIC_DIR` | `frontend/dist` | 빌드된 프론트엔드 |

UI만 개발할 때는 `cd frontend; $env:VITE_API_FMUS='mock'; ...; npm run dev`처럼 도메인(`FMUS`, `RESOURCES`, `OBJECTIVES`, `JOBS`, `PRESETS`, `RUNS`)별로 mock을 켤 수 있습니다. dev 서버는 `/api`를 `FMUC_API`(기본 `http://127.0.0.1:8000`)로 프록시합니다.

## Resource 파일 후보와 Resource 조합

FMU 안 `resources/` 폴더의 파일(`.mat`, `.tir`, `.csv` 등 형식 무관)을 바꿔 끼워 해석할 수 있습니다.

1. **후보 올리기**: FMU 상세 → **Resources** 탭에서 파일마다 밖에서 수정한 **후보 파일**을 올립니다. 원본과 확장자가 같아야 합니다. 미리보기: 텍스트는 내용(앞 256KB, UTF-8 → cp949 순), `.mat`(v4/v5)은 변수 목록과 그래프(1×N 벡터는 곡선 하나, 최대 2000점으로 줄여 표시).
2. **배치**: 배치 설정의 **Resource 파일** 섹션에서 파일마다 후보를 여러 개 고르면 *파라미터 케이스 × Resource 조합*을 모두 실행합니다.
3. **최적화**: 파일마다 **고정**(후보 하나) 또는 **탐색**(고른 후보 중 무엇이 좋은지 최적화가 함께 선택)을 고릅니다. 탐색은 서로 다른 후보 2개 이상이 필요하고, 탐색이 있으면 CMA-ES는 쓸 수 없습니다. 잡 모니터의 후보별 막대그래프는 탐색한 후보만 보여 줍니다.
4. **후보 삭제**: 원본, 그 후보로 해석한 run이 있는 후보, 실행 중·대기 중 잡이 쓰는 후보는 지울 수 없습니다. 지우면 그 후보를 쓰던(run 없는) 조합도 함께 지워집니다.

같은 후보를 여러 번 고르면 한 번만 셉니다.

**Resource 조합**(FMU + 원본에서 바꾼 파일들)이 다르면 다른 해석으로 보고 결과를 따로 쌓습니다. 조합은 파일 **내용**(SHA-256)으로 식별하므로, 같은 파일을 이름만 바꿔 다시 올리면 기존 후보·조합에 이어서 쌓입니다. 결과 화면에서 조합별로 거르거나(**Resource 조합** 필터) 조합끼리 비교(**Resource 조합 비교** 탭)할 수 있고, CSV에는 `variant` 열이 들어갑니다.

- 원본 FMU와 압축해제 폴더는 바꾸지 않습니다. 조합마다 `data/variants/<id>/`에 실행 폴더를 만들어(원본 파일은 하드링크) 교체 파일만 복사합니다.
- 앱은 모델이 어떤 resource를 실제로 읽는지 알 수 없습니다. 모델이 읽지 않는 파일을 바꾸면 결과는 원본과 같습니다 (예: 테스트 FMU는 `NEDC.mat`만 읽습니다).
- 이전 버전에서 만든 `data`를 그대로 열면 기존 run은 자동으로 `원본` 조합으로 옮겨집니다.

## 화면 구성

- **홈** (`/`): FMU 카드(단계별 진행 상태와 다음 할 일), 실행 중/최근 잡.
- **FMU 작업공간** (`/fmus/<id>/...`): ① 모델 → ② 변수·리소스 → ③ 목적함수 → ④ 실행 → ⑤ 결과 분석.
  - ③ 목적함수: 블록 빌더로 설계하고 미리보기·시험 실행·일괄 테스트(`POST /api/objectives/test-batch`, 저장 전 코드로 여러 run 계산)로 확인합니다. 빌더가 만든 코드는 첫 줄 `# fmuc-builder: ...`에 설계 내용을 담아 다시 빌더로 열 수 있습니다.
  - ⑤ 결과 분석: 위쪽 필터(잡·Resource 조합·상태·표시할 목적함수) 아래 **작업대**(차트 패널 격자, 기본) / **결과 표**(RunTable·CSV) / FMU 비교 / Resource 조합 비교 탭. 표의 체크와 작업대에서 클릭·브러시로 고른 run은 같은 선택으로 연동됩니다.

## 프리셋 (설정 저장·재사용)

배치 해석·최적화 설정 화면 위쪽 메뉴 바에서 지금 설정을 프리셋으로 저장하고 다시 불러옵니다. 배치 프리셋과 최적화 프리셋은 따로 관리됩니다.

결과 분석 작업대의 **레이아웃 저장** 메뉴는 대시보드 프리셋(격자 + 패널 정의, 변수·목적함수는 이름으로 참조)을 저장합니다. 다른 FMU에서 불러오면 없는 변수·목적함수를 쓰는 패널은 "찾을 수 없음"으로 표시됩니다. 프리셋 메뉴의 대시보드 **열기**는 저장한 FMU의 결과 분석으로 갑니다.

- 공통: 실행 설정(시뮬레이션·기록 변수·고정 파라미터·병렬 수·타임아웃), 잡 모니터에 표시할 변수
- 최적화: 목적함수와 방향, 알고리즘·trial 수, 설계 변수와 범위, Resource 고정/탐색 선택
- 배치: 스윕 파라미터(목록/범위), 샘플링 방식·샘플 수, Resource 후보 선택

잡 이름은 저장하지 않습니다.

- **프리셋 → 저장 (Ctrl+S)**: 불러온 프리셋이 있으면 덮어쓰고, 없으면 이름을 묻습니다. 저장한 뒤 고치면 메뉴 바에 "● 수정됨"이 표시됩니다.
- **불러오기**: 이 FMU의 프리셋, 다른 FMU의 프리셋, 최근 최적화 잡의 설정을 고릅니다. 불러온 직후 **되돌리기**로 이전 상태로 돌아갈 수 있습니다.
- 다른 FMU에 불러오면 그 FMU에 없는 변수(설계 변수·스윕 파라미터 등)와 resource 후보(내용 sha256으로 찾음), 삭제된 목적함수는 빠지고, 무엇이 빠졌는지 안내합니다. 기록 변수를 "출력 전체"로 두었으면 대상 FMU의 출력 전체가 됩니다.
- 잡 모니터의 **이 설정으로 새 배치/최적화** / **프리셋으로 저장**으로 지난 잡의 설정을 다시 씁니다. 왼쪽 **프리셋** 메뉴(최적화/배치 해석/대시보드 탭)에서 이름 바꾸기·삭제·다른 FMU로 열기를 합니다.

## 목적함수 작성 규칙

- **파일 하나 = 값 하나.** 다목적 최적화는 목적함수를 여러 개 만들어 함께 선택합니다.
- 시그니처:

  ```python
  import pandas as pd

  def evaluate(result: pd.DataFrame, params: dict) -> float:
      # result: 'time' 컬럼 + 배치/최적화에서 기록한 변수 컬럼
      # params: 그 run에 적용된 파라미터 값
      return float(result["controlBus.chassisBus.longitudinalVelocity"].mean())
  ```

- 실수 하나를 반환해야 합니다 (dict, 문자열, bool, None은 오류). NaN/무한대는 값 없음으로 표시됩니다.
- run 하나당 10초 안에 끝나야 합니다.
- 목적함수가 참조하는 변수는 배치/최적화 설정의 **기록 변수**에 포함되어 있어야 합니다 (기본값: FMU의 출력 변수 전체).

## 목적함수 값은 저장하지 않습니다

DB에는 파라미터와 시계열(Parquet 경로)만 저장됩니다. 결과 화면의 목적함수 값은 **조회할 때마다 현재 코드로 다시 계산**하며, 값 옆에 계산에 쓴 코드 해시가 표시됩니다. 같은 이름의 목적함수인데 예전 코드로 계산된 값이 남아서 오해하는 일이 없도록 하기 위해서입니다 (같은 코드로 다시 계산하는 비용은 메모리 캐시로 줄입니다).

최적화는 시작한 시점의 코드로 끝까지 진행합니다. 이후 코드를 수정하면 잡 화면에 "최적화 실행 당시와 목적함수 코드가 다릅니다" 경고가 표시됩니다.

## 알려진 FMU 관련 처리

- Dymola가 만든 `modelDescription.xml`은 FMPy의 엄격 검증에 실패할 수 있어 검증을 끄고 읽습니다.
- 일부 모델은 초기화할 때 현재 작업 디렉터리에 파일을 만들기 때문에, run마다 `data/work/<run_id>/`를 작업 디렉터리로 씁니다.
- FMU는 내용 해시(SHA-256 앞 16자)로 식별합니다. 같은 파일을 다시 올리면 기존 FMU에 결과가 이어서 쌓입니다.
- Dymola FMU는 `resources/` 파일을 FMU resource 위치로 읽으므로, 조합 폴더의 파일을 바꾸면 해석에 반영됩니다.

## 테스트

```powershell
cd backend; .venv\python.exe -m pytest    # 실제 FMU 테스트는 ..\my_0test_DriveCycleAT.fmu (FMUC_TEST_FMU로 변경)
cd frontend; npm test
```
