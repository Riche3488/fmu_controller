"""uvicorn 실행: uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8000"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

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

    return app

