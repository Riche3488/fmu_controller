# FMU Controller

FMU 파라미터를 병렬로 바꿔 가며 배치 해석·최적화(단일/다목적)를 수행하고, 결과 시계열을 FMU별로 누적·조회·비교하는 로컬 웹 앱입니다.

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

## 실행

```powershell
.\run.ps1                  # http://127.0.0.1:8000
.\run.ps1 -Parallel pool   # Ray 없이
.\run.ps1 -Workers 6 -Build
```

서버는 `127.0.0.1`에만 바인딩됩니다. 목적함수 `.py`는 서버에서 그대로 실행되는 코드이므로 외부에 노출하지 마세요.

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `FMUC_DATA_DIR` | `backend/data` | DB·FMU·결과 저장 위치 (**ASCII 경로만**) |
| `FMUC_PARALLEL` | `auto` | `auto` / `ray` / `pool` |
| `FMUC_MAX_WORKERS` | CPU 수 − 1 | 병렬 작업 수 상한 |
| `FMUC_STATIC_DIR` | `frontend/dist` | 빌드된 프론트엔드 |

UI만 개발할 때는 `cd frontend; $env:VITE_API_FMUS='mock'; ...; npm run dev`처럼 도메인(`FMUS`, `OBJECTIVES`, `JOBS`, `RUNS`)별로 mock을 켤 수 있습니다. dev 서버는 `/api`를 `FMUC_API`(기본 `http://127.0.0.1:8000`)로 프록시합니다.

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

## 테스트

```powershell
cd backend; .venv\python.exe -m pytest    # 실제 FMU 테스트는 ..\my_0test_DriveCycleAT.fmu (FMUC_TEST_FMU로 변경)
cd frontend; npm test
```
