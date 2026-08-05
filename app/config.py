from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "storage")).resolve()
DATABASE_PATH = DATA_DIR / "master_endurance.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"
LEGACY_JSON_PATH = BASE_DIR / "data" / "atletas.json"

APP_NAME = "Master Endurance"
APP_VERSION = "2.0.0"
PUBLIC_HOST = os.getenv("PUBLIC_HOST", "andrestrainer.qzz.io")
ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv(
        "ALLOWED_HOSTS",
        "*",
    ).split(",")
    if host.strip()
]
