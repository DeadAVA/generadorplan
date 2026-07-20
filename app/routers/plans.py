from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session, select

from ..database import get_session
from ..models import Athlete, TrainingPlan
from ..schemas import GeneratePlanRequest, PlanInput, PlanRead, PlanSummary
from ..services import create_generated_payload, get_plan_or_none, persist_plan, plan_to_dict


router = APIRouter(prefix="/api/plans", tags=["plans"])
SessionDep = Annotated[Session, Depends(get_session)]


def require_athlete(session: Session, athlete_id: str) -> Athlete:
    athlete = session.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta no encontrado")
    return athlete


@router.get("", response_model=list[PlanSummary])
def list_plans(
    session: SessionDep,
    athlete_id: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
):
    query = select(TrainingPlan, Athlete.name).join(Athlete).order_by(TrainingPlan.start_date.desc())
    if athlete_id:
        query = query.where(TrainingPlan.athlete_id == athlete_id)
    if status_filter:
        query = query.where(TrainingPlan.status == status_filter)
    rows = session.exec(query).all()
    return [
        {
            "id": plan.id, "athlete_id": plan.athlete_id, "athlete_name": athlete_name,
            "title": plan.title, "week_number": plan.week_number, "start_date": plan.start_date,
            "end_date": plan.end_date, "category": plan.category, "hours_per_week": plan.hours_per_week,
            "weekly_km": plan.weekly_km, "goal": plan.goal, "status": plan.status,
            "updated_at": plan.updated_at,
        }
        for plan, athlete_name in rows
    ]


@router.get("/{plan_id}", response_model=PlanRead)
def get_plan(plan_id: str, session: SessionDep):
    plan = get_plan_or_none(session, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    return plan_to_dict(plan)


@router.post("", response_model=PlanRead, status_code=status.HTTP_201_CREATED)
def create_plan(payload: PlanInput, session: SessionDep):
    require_athlete(session, payload.athlete_id)
    return plan_to_dict(persist_plan(session, payload))


@router.put("/{plan_id}", response_model=PlanRead)
def update_plan(plan_id: str, payload: PlanInput, session: SessionDep):
    plan = get_plan_or_none(session, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    require_athlete(session, payload.athlete_id)
    return plan_to_dict(persist_plan(session, payload, plan))


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: str, session: SessionDep):
    plan = session.get(TrainingPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    session.delete(plan)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/generate/automatic", response_model=PlanRead, status_code=status.HTTP_201_CREATED)
def generate_plan(payload: GeneratePlanRequest, session: SessionDep):
    athlete = require_athlete(session, payload.athlete_id)
    plan_payload = create_generated_payload(payload, athlete)
    return plan_to_dict(persist_plan(session, plan_payload))
