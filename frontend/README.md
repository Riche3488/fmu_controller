# FMU Controller — 프론트엔드

React + Mantine + ECharts + Monaco (Vite). 앱 전체 설명과 실행 방법은 저장소 루트의 `README.md`, 개발 규칙은 `CLAUDE.md`를 보세요.

```powershell
npm install
npm run dev     # /api 는 FMUC_API(기본 http://127.0.0.1:8000)로 프록시
npm test        # vitest (mock client로 렌더)
npx tsc -b      # 타입체크
npm run build   # dist/ → 백엔드가 정적 파일로 서빙
```

백엔드 없이 UI만 볼 때는 도메인별로 mock을 켭니다: `$env:VITE_API_FMUS='mock'` (`FMUS`, `RESOURCES`, `OBJECTIVES`, `JOBS`, `PRESETS`, `RUNS`).

- `src/api/types.ts` — API 계약. 백엔드 `backend/app/schemas.py`와 같은 형태를 유지합니다.
- `src/api/http/` 실서버 클라이언트, `src/api/mock/` 인메모리 클라이언트 (테스트·UI 개발용).
