"""uvicorn 실행: uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8000"""
from contextlib import asynccontextmanager
from pathlib import Path

from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .db import init_db, make_engine, make_session_factory
from .parallel.base import create_executors
from .jobs.runner import JobManager, mark_interrupted_jobs
from .objectives.evaluator import Evaluator
from .resources.migrate import migrate
from .routers import fmus, jobs, objectives, resources, runs
from .schemas import Health


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.ensure_dirs()
        engine = make_engine(settings)
        init_db(engine)
        app.state.settings = settings
        app.state.engine = engine
        app.state.session_factory = make_session_factory(engine)
        migrate(engine, app.state.session_factory, settings)
        with app.state.session_factory() as s:
            mark_interrupted_jobs(s)
        executor, eval_executor = create_executors(settings.parallel, settings.max_workers, settings.eval_workers)
        app.state.executor = executor
        app.state.eval_executor = eval_executor
        app.state.evaluator = Evaluator(eval_executor)
        app.state.jobs = JobManager(settings, app.state.session_factory, executor, app.state.evaluator)
        try:
            yield
        finally:
            app.state.jobs.shutdown()
            executor.shutdown()
            eval_executor.shutdown()
            engine.dispose()

    app = FastAPI(title="FMU Controller", lifespan=lifespan)
    add_local_only_guards(app, settings.allowed_hosts)
    app.include_router(fmus.router)
    app.include_router(resources.router)
    app.include_router(runs.router)
    app.include_router(objectives.router)
    app.include_router(jobs.router)

    @app.get("/api/health", response_model=Health)
    def health():
        return Health(status="ok", parallel_backend=app.state.executor.name)

    mount_frontend(app, settings.static_dir)
    return app


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def add_local_only_guards(app: FastAPI, allowed_hosts: tuple[str, ...]) -> None:
    """목적함수는 임의 코드 실행이므로 로컬 전용으로 잠근다.
    - Host 검사: DNS rebinding으로 외부 사이트가 같은 origin이 되는 것을 막는다.
    - Origin 검사: 다른 사이트에서 보낸 쓰기 요청(CSRF)을 막는다."""

    @app.middleware("http")
    async def same_origin_writes(request: Request, call_next):
        origin = request.headers.get("origin")
        if request.method in UNSAFE_METHODS and origin and urlsplit(origin).hostname not in allowed_hosts:
            return JSONResponse({"detail": "허용되지 않은 Origin입니다"}, status_code=403)
        return await call_next(request)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(allowed_hosts))


def _safe_static_file(static_dir: Path, path: str) -> Path | None:
    """요청 경로가 static_dir 안의 상대 경로일 때만 파일 경로를 돌려준다.
    UNC(백슬래시 공유 경로)·드라이브·절대 경로·..는 파일시스템을 건드리기 전에 거절한다 (NTLM 유출 방지)."""
    if not path or "\\" in path or ":" in path or path.startswith("/"):
        return None
    parts = path.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return None
    return static_dir.joinpath(*parts)


def mount_frontend(app: FastAPI, static_dir: Path) -> None:
    """빌드된 SPA 서빙: /assets 정적 파일 + 그 외 비 /api 경로는 index.html (클라이언트 라우팅)."""
    index = static_dir / "index.html"
    if not index.exists():
        return
    if (static_dir / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        f = _safe_static_file(static_dir, path)
        if f is not None and f.is_file():
            return FileResponse(f)
        return FileResponse(index)

