# Dummy resource 파일

`my_0test_DriveCycleAT.fmu`의 `resources/NEDC.mat`을 일부 바꾼 테스트용 후보 파일입니다. FMU 상세 → **Resources** 탭에서 `NEDC.mat` 자리에 후보로 올려 사용합니다.

| 파일 | 변경 내용 | 최고 속도 | 평균 종방향 속도* |
|---|---|---|---|
| (원본) `NEDC.mat` | — | 120 | 3.817 m/s |
| `NEDC_x0.8.mat` | `table` 2번째 열(속도) × 0.8 | 96 | 3.014 m/s |
| `NEDC_x1.2.mat` | `table` 2번째 열(속도) × 1.2 | 144 | 4.511 m/s |

\* `controlBus.chassisBus.longitudinalVelocity`, 0–90 s, 출력 간격 0.1 s 기준.

- 형식: MATLAB v4 `.mat`(원본과 동일), 변수 `table` (119 × 3). 1번째 열(시간)과 3번째 열은 원본 그대로입니다.
- 만드는 방법: `scipy.io.loadmat`으로 읽어 속도 열에 배율을 곱한 뒤 `scipy.io.savemat(..., format="4")`로 저장.
