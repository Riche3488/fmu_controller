"""uvicorn 실행: uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8000"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import Settings
from .db import init_db, make_engine, make_session_factory
from .parallel.base import create_executor
from .objectives.evaluator import Evaluator
from .routers import fmus, objectives, runs
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
        executor = create_executor(settings.parallel, settings.max_workers)
        app.state.executor = executor
        app.state.evaluator = Evaluator(executor)
        try:
            yield
        finally:
            executor.shutdown()
            engine.dispose()

    app = FastAPI(title="FMU Controller", lifespan=lifespan)
    app.include_router(fmus.router)
    app.include_router(runs.router)
    app.include_router(objectives.router)

    @app.get("/api/health", response_model=Health)
    def health():
        return Health(status="ok", parallel_backend=app.state.executor.name)

    return app

