# FMU Controller — 요구사항 (원문)

fmu의 파라미터를 최적화하거나 파라미터 변경에 따른 batch run수행 및 database를 저장하는 앱 구현

1. 유저
- 해당 fmu의 파라미터 변경에 따른 목적함수 최적화를 하고자 하는 엔지니어
- 복수의 fmu와 fmu내부의 parameter 변경에 따른 성능 변화를 비교하고자 하는 엔지니어
- fmu의 해석 결과에 대한 시계열 데이터를 scalar형식으로 압축하는 목적함수를 설계하고자 하는 엔지니어

2. 주요 기능
- 병렬로 fmu의 파라미터를 변경해가면서 해석 하는 기능
- fmu해석 결과에 해당하는 시계열 데이터를 scalar형식으로 압축하는 목적함수를 py파일 형태로 gui상에서 편집하고 반영하는 기능
- 동일 fmu 기준으로 해석, 최적화 결과를 db로 누적하고 조회하는 기능

3. 결과물 형태
- frontend : web형식, backend : python기반 서버 동작

4. 진행 방식 (사용자 지시)
- UI 먼저 구현, 백엔드는 기능별로 순차 구현

6. 목적함수·DB 정책 (사용자 지시, 계획 1차 검토 후 추가)
- 목적함수 파일 하나는 하나의 지표만 계산하도록 할 것. 다목적 최적화를 수행 시, 목적함수.py 파일은 그 개수만큼 생성됨.
- DB에는 파라미터에 대한 시계열 데이터만 저장하고 목적함수값은 계산하지 않도록 함.
- DB에 대한 목적함수 값은 최신화된 목적함수 기준으로 새로 계산하는 방식을 택해야 같은 이름의 목적함수인데, 내부 코드가 미묘하게 달라서 오해하는 일이 발생하지 않음.

7. 라이브러리 (사용자 지시)
- fmu 제어는 python fmpy library활용하고, 병렬 처리는 ray library활용할 것(ray사용이 불가능하면 multiprocessing.pool으로 풀백)

5. 대상 FMU 조사 결과 (my_0test_DriveCycleAT.fmu)
- FMI 2.0, Dymola 2023 생성, ModelExchange만 제공 (CoSimulation 없음), win64/win32 바이너리
- ScalarVariable 54,616개 / parameter 2,867개 / output 140개 / input 0개
- DefaultExperiment: startTime=0, stopTime=1400, tolerance=1e-4
