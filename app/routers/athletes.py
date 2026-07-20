from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from ..database import get_session
from ..models import Athlete, PaceZone, utcnow
from ..schemas import AthleteInput, AthleteRead


router = APIRouter(prefix="/api/athletes", tags=["athletes"])
SessionDep = Annotated[Session, Depends(get_session)]
DEFAULT_PACES = {
    "Z5": ("04:30", "04:40"), "Z4": ("04:55", "05:00"),
    "Z3": ("05:10", "05:30"), "Z2": ("05:40", "06:00"),
    "Z1": ("06:00", "06:30"),
}


def athlete_query():
    return select(Athlete).options(selectinload(Athlete.pace_zones))


def ensure_unique_name(session: Session, name: str, exclude_id: str | None = None) -> None:
    query = select(Athlete).where(func.lower(Athlete.name) == name.lower())
    if exclude_id:
        query = query.where(Athlete.id != exclude_id)
    if session.exec(query).first():
        raise HTTPException(status_code=409, detail="Ya existe un atleta con ese nombre")


@router.get("", response_model=list[AthleteRead])
def list_athletes(session: SessionDep, include_inactive: bool = False):
    query = athlete_query().order_by(Athlete.name)
    if not include_inactive:
        query = query.where(Athlete.active == True)  # noqa: E712
    return session.exec(query).all()


@router.get("/{athlete_id}", response_model=AthleteRead)
def get_athlete(athlete_id: str, session: SessionDep):
    athlete = session.exec(athlete_query().where(Athlete.id == athlete_id)).first()
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta no encontrado")
    return athlete


@router.post("", response_model=AthleteRead, status_code=status.HTTP_201_CREATED)
def create_athlete(payload: AthleteInput, session: SessionDep):
    ensure_unique_name(session, payload.name)
    athlete = Athlete(**payload.model_dump(exclude={"pace_zones"}))
    session.add(athlete)
    session.flush()
    zones = payload.pace_zones or [
        {"zone": zone, "pace_min": pair[0], "pace_max": pair[1]}
        for zone, pair in DEFAULT_PACES.items()
    ]
    for zone in zones:
        values = zone.model_dump() if hasattr(zone, "model_dump") else zone
        session.add(PaceZone(athlete_id=athlete.id, **values))
    session.commit()
    return session.exec(athlete_query().where(Athlete.id == athlete.id)).first()


@router.put("/{athlete_id}", response_model=AthleteRead)
def update_athlete(athlete_id: str, payload: AthleteInput, session: SessionDep):
    athlete = session.exec(athlete_query().where(Athlete.id == athlete_id)).first()
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta no encontrado")
    ensure_unique_name(session, payload.name, athlete_id)
    for key, value in payload.model_dump(exclude={"pace_zones"}).items():
        setattr(athlete, key, value)
    athlete.updated_at = utcnow()
    for zone in list(athlete.pace_zones):
        session.delete(zone)
    session.flush()
    for zone in payload.pace_zones:
        session.add(PaceZone(athlete_id=athlete.id, **zone.model_dump()))
    session.commit()
    return session.exec(athlete_query().where(Athlete.id == athlete.id)).first()


@router.delete("/{athlete_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_athlete(athlete_id: str, session: SessionDep):
    athlete = session.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta no encontrado")
    session.delete(athlete)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
