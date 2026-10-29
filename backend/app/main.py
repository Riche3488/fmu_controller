"""uvicorn 실행: uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8000"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .db import init_db, make_engine, make_session_factory
from .parallel.base import create_executor
from .jobs.runner import JobManager, mark_interrupted_jobs
from .objectives.evaluator import Evaluator
from .routers import fmus, jobs, objectives, runs
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
        with app.state.session_factory() as s:
            mark_interrupted_jobs(s)
        executor = create_executor(settings.parallel, settings.max_workers)
        app.state.executor = executor
        app.state.evaluator = Evaluator(executor)
        app.state.jobs = JobManager(settings, app.state.session_factory, executor, app.state.evaluator)
        try:
            yield
        finally:
            app.state.jobs.shutdown()
            executor.shutdown()
            engine.dispose()

    app = FastAPI(title="FMU Controller", lifespan=lifespan)
    app.include_router(fmus.router)
    app.include_router(runs.router)
    app.include_router(objectives.router)
    app.include_router(jobs.router)

    @app.get("/api/health", response_model=Health)
    def health():
        return Health(status="ok", parallel_backend=app.state.executor.name)

    mount_frontend(app, settings.static_dir)
    return app


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
        f = static_dir / path
        if path and f.is_file() and f.resolve().is_relative_to(static_dir.resolve()):
            return FileResponse(f)
        return FileResponse(index)

