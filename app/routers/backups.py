from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import selectinload
from sqlmodel import Session, delete, select

from ..database import get_session
from ..models import Athlete, PaceZone, PlanDay, TrainingPlan
from ..schemas import AthleteInput, PlanInput
from ..services import persist_plan, plan_query, plan_to_dict


router = APIRouter(prefix="/api/backups", tags=["backups"])
SessionDep = Annotated[Session, Depends(get_session)]


def build_backup(session: Session) -> dict:
    athletes = session.exec(select(Athlete).options(selectinload(Athlete.pace_zones)).order_by(Athlete.name)).all()
    plans = session.exec(plan_query().order_by(TrainingPlan.start_date)).all()
    return {
        "format": "master-endurance-backup",
        "version": 2,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "athletes": [
            {
                "id": athlete.id, "name": athlete.name, "category": athlete.category,
                "birth_date": athlete.birth_date.isoformat() if athlete.birth_date else None,
                "gender": athlete.gender, "contact": athlete.contact, "notes": athlete.notes,
                "active": athlete.active,
                "pace_zones": [
                    {"zone": zone.zone, "pace_min": zone.pace_min, "pace_max": zone.pace_max}
                    for zone in athlete.pace_zones
                ],
            }
            for athlete in athletes
        ],
        "plans": [plan_to_dict(plan) for plan in plans],
    }


@router.get("/json")
def download_backup(session: SessionDep):
    payload = build_backup(session)
    filename = f"master-endurance-{datetime.now().date().isoformat()}.json"
    return JSONResponse(jsonable_encoder(payload), headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/json")
async def restore_backup(session: SessionDep, file: UploadFile = File(...)):
    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="El respaldo supera 10 MB")
    try:
        payload = json.loads((await file.read()).decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=400, detail=f"JSON inválido: {error}") from error
    if payload.get("format") != "master-endurance-backup" or not payload.get("athletes"):
        raise HTTPException(status_code=400, detail="El archivo no es un respaldo de Master Endurance")

    session.exec(delete(Athlete))
    session.commit()
    id_map: dict[str, str] = {}
    try:
        for item in payload["athletes"]:
            old_id = str(item.get("id", ""))
            athlete_input = AthleteInput.model_validate(item)
            athlete = Athlete(**athlete_input.model_dump(exclude={"pace_zones"}))
            session.add(athlete)
            session.flush()
            id_map[old_id] = athlete.id
            for zone in athlete_input.pace_zones:
                session.add(PaceZone(athlete_id=athlete.id, **zone.model_dump()))
        session.commit()
        for item in payload.get("plans", []):
            old_athlete_id = str(item.get("athlete_id", ""))
            if old_athlete_id not in id_map:
                continue
            item["athlete_id"] = id_map[old_athlete_id]
            persist_plan(session, PlanInput.model_validate(item))
    except Exception as error:
        session.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo restaurar: {error}") from error
    return {"ok": True, "athletes": len(payload["athletes"]), "plans": len(payload.get("plans", []))}
