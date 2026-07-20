from __future__ import annotations

import json
from datetime import date, timedelta

from sqlmodel import Session, select

from .config import LEGACY_JSON_PATH
from .models import Athlete, Exercise, PaceZone, PlanDay, TrainingPlan


def seed_legacy_data(session: Session) -> None:
    if session.exec(select(Athlete)).first() or not LEGACY_JSON_PATH.exists():
        return
    try:
        payload = json.loads(LEGACY_JSON_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return

    today = date.today()
    monday = today - timedelta(days=today.weekday())
    for item in payload.get("athletes", []):
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        athlete_values = {"name": name, "category": "LIBRE"}
        if item.get("id"):
            athlete_values["id"] = str(item["id"])
        athlete = Athlete(**athlete_values)
        session.add(athlete)
        session.flush()
        for zone, pair in item.get("paces", {}).items():
            if zone in {"Z1", "Z2", "Z3", "Z4", "Z5"} and isinstance(pair, list) and len(pair) == 2:
                session.add(PaceZone(athlete_id=athlete.id, zone=zone, pace_min=pair[0], pace_max=pair[1]))

        week = item.get("week") or []
        if week:
            plan = TrainingPlan(
                athlete_id=athlete.id,
                title="Plan importado",
                month_label=monday.strftime("%B %Y").upper(),
                week_number=monday.isocalendar().week,
                start_date=monday,
                end_date=monday + timedelta(days=6),
                category="LIBRE",
                weekly_km=sum(float(day.get("value", 0)) for day in week if day.get("measure") == "km"),
                goal="Importado de la versión anterior",
            )
            session.add(plan)
            session.flush()
            for index, legacy_day in enumerate(week[:7]):
                current = monday + timedelta(days=index)
                day = PlanDay(
                    plan_id=plan.id,
                    day_order=index,
                    date=current,
                    code=f"{['L','M','M','J','V','S','D'][index]}{current.day}",
                    warmup="Calentamiento" if legacy_day.get("zone") != "-" else "",
                    cooldown="Flexo - Elasticidad" if legacy_day.get("zone") != "-" else "Descanso",
                )
                session.add(day)
                session.flush()
                description = str(legacy_day.get("description", "")).strip()
                name = str(legacy_day.get("name", "Sesión"))
                if legacy_day.get("zone") != "-":
                    unit = "km" if legacy_day.get("measure") == "km" else "min"
                    prescription = f"{legacy_day.get('value', 0)} {unit}"
                    if legacy_day.get("reps") and legacy_day.get("distance"):
                        prescription += f" · {legacy_day['reps']} × {legacy_day['distance']} m"
                    session.add(Exercise(
                        plan_day_id=day.id,
                        sort_order=0,
                        title=name,
                        prescription=prescription,
                        intensity=str(legacy_day.get("zone", "")),
                        pause=str(legacy_day.get("pause", "")),
                        notes=description,
                    ))
    session.commit()
