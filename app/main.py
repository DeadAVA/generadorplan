from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlmodel import Session, select

from .config import ALLOWED_HOSTS, APP_NAME, APP_VERSION, BASE_DIR, DATABASE_PATH
from .database import create_db_and_tables, engine
from .models import Athlete, Exercise, FieldTest, PaceZone, PlanDay, TrainingPlan
from .routers import athletes, backups, field_tests, plans
from .seed import seed_legacy_data


WEB_DIR = BASE_DIR / "web"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_db_and_tables()
    with Session(engine) as session:
        seed_legacy_data(session)
    yield


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Gestión de atletas y planificación semanal de atletismo.",
    lifespan=lifespan,
)
class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        return response

app.add_middleware(NoCacheStaticMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
app.include_router(athletes.router)
app.include_router(plans.router)
app.include_router(field_tests.router)
app.include_router(backups.router)


@app.get("/api/health", tags=["system"])
def health():
    with Session(engine) as session:
        counts = {
            "athletes": len(session.exec(select(Athlete)).all()),
            "plans": len(session.exec(select(TrainingPlan)).all()),
            "days": len(session.exec(select(PlanDay)).all()),
            "exercises": len(session.exec(select(Exercise)).all()),
            "field_tests": len(session.exec(select(FieldTest)).all()),
        }
    return {"status": "ok", "version": APP_VERSION, "database": DATABASE_PATH.name, **counts}


_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(WEB_DIR / "index.html", headers=_NO_STORE)


@app.get("/print", include_in_schema=False)
def print_plan():
    return FileResponse(WEB_DIR / "print.html", headers=_NO_STORE)


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return FileResponse(WEB_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/service-worker.js", include_in_schema=False)
def service_worker():
    return FileResponse(WEB_DIR / "service-worker.js", media_type="application/javascript", headers=_NO_STORE)


app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")
