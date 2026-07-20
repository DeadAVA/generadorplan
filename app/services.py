from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from .models import Athlete, Exercise, PlanDay, TrainingPlan, utcnow
from .schemas import PlanInput


def plan_query():
    return select(TrainingPlan).options(
        selectinload(TrainingPlan.athlete),
        selectinload(TrainingPlan.days).selectinload(PlanDay.exercises),
    )


def get_plan_or_none(session: Session, plan_id: str) -> TrainingPlan | None:
    return session.exec(plan_query().where(TrainingPlan.id == plan_id)).first()


def persist_plan(session: Session, payload: PlanInput, plan: TrainingPlan | None = None) -> TrainingPlan:
    values = payload.model_dump(exclude={"days"})
    if plan is None:
        plan = TrainingPlan(**values)
        session.add(plan)
    else:
        for key, value in values.items():
            setattr(plan, key, value)
        plan.updated_at = utcnow()
        for day in list(plan.days):
            session.delete(day)
    session.flush()

    for day_payload in sorted(payload.days, key=lambda item: item.day_order):
        day_values = day_payload.model_dump(exclude={"exercises"})
        day = PlanDay(plan_id=plan.id, **day_values)
        session.add(day)
        session.flush()
        for order, exercise_payload in enumerate(day_payload.exercises):
            exercise_values = exercise_payload.model_dump()
            exercise_values["sort_order"] = exercise_values.get("sort_order", order)
            session.add(Exercise(plan_day_id=day.id, **exercise_values))
    session.commit()
    return get_plan_or_none(session, plan.id)


def plan_to_dict(plan: TrainingPlan) -> dict:
    return {
        "id": plan.id,
        "athlete_id": plan.athlete_id,
        "athlete_name": plan.athlete.name if plan.athlete else "",
        "title": plan.title,
        "month_label": plan.month_label,
        "week_number": plan.week_number,
        "start_date": plan.start_date,
        "end_date": plan.end_date,
        "category": plan.category,
        "hours_per_week": plan.hours_per_week,
        "weekly_km": plan.weekly_km,
        "goal": plan.goal,
        "status": plan.status,
        "notes": plan.notes,
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
        "days": [
            {
                "id": day.id,
                "day_order": day.day_order,
                "date": day.date,
                "code": day.code,
                "warmup": day.warmup,
                "cooldown": day.cooldown,
                "notes": day.notes,
                "exercises": [
                    {
                        "id": exercise.id,
                        "sort_order": exercise.sort_order,
                        "block_type": exercise.block_type,
                        "title": exercise.title,
                        "prescription": exercise.prescription,
                        "intensity": exercise.intensity,
                        "pause": exercise.pause,
                        "pace": exercise.pace,
                        "notes": exercise.notes,
                    }
                    for exercise in sorted(day.exercises, key=lambda item: item.sort_order)
                ],
            }
            for day in sorted(plan.days, key=lambda item: item.day_order)
        ],
    }


SPANISH_MONTHS = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]


def day_code(day_date: date) -> str:
    letters = ["L", "M", "M", "J", "V", "S", "D"]
    return f"{letters[day_date.weekday()]}{day_date.day}"


def create_generated_payload(request, athlete: Athlete) -> PlanInput:
    if request.goal == "400-800":
        return _create_middle_distance_payload(request, athlete)
    return _create_endurance_payload(request, athlete)


def _create_middle_distance_payload(request, athlete: Athlete) -> PlanInput:
    templates = [
        [
            ("Técnica", "5 × 15 drop isométrico con liga en escalones", "", "2 min"),
            ("Multisaltos", "5 × 10 saltos: alto indio, rana, cogitos y gacela", "", "2 min"),
            ("Velocidad", "3 × 120 m (100-80 m)", "80-85% del 300", ""),
            ("Recuperación", "Trote recuperatorio 3 vueltas", "", ""),
        ],
        [
            ("Resistencia específica", "3 × 400 m + 300 m + 200 m + 100 m", "85-95% del 1000", "1:30 min"),
            ("Fuerza", "Pesas: pierna y glúteo, método clúster", "80-90%", ""),
            ("Recuperación", "Trote recuperatorio 3 vueltas", "", ""),
        ],
        [
            ("Coordinación", "5 × 5 vallas con tertulias", "", ""),
            ("Potencia", "1 circuito de U yogui/cruces a medio campo y trote de regreso", "", "3 min"),
            ("Velocidad", "3 × 5 × 20 m con énfasis en el empuje", "Máxima técnica", ""),
            ("Recuperación", "15 min de trote recuperatorio", "", ""),
        ],
        [
            ("Arrastre", "5 × 20 m desplante con trineo (20 lb)", "", ""),
            ("Aceleración", "3 × 5 × 40 m con énfasis en el empuje", "", ""),
            ("Movilidad", "3 × 10 flexibilidad con vallas", "", ""),
            ("Fuerza", "Pesas: pecho y espalda", "", ""),
        ],
        [
            ("Técnica", "5 × 15 drop isométrico con liga", "", "2 min"),
            ("Multisaltos", "5 × 10 saltos variados", "", "2 min"),
            ("Velocidad", "3 × 120 m (100-80 m)", "80-85% del 300", ""),
            ("Recuperación", "Trote recuperatorio 3 vueltas", "", ""),
        ],
        [
            ("Resistencia", "2 × 5 × 200 m", "95% del 1000", "100 m caminando"),
            ("Fuerza", "Pesas: pierna y glúteo, método clúster", "75-80%", ""),
            ("Recuperación", "Trote recuperatorio 3 vueltas", "", ""),
        ],
        [],
    ]
    active_indexes = set(range(min(request.days_per_week, 6)))
    days = []
    for index in range(7):
        current = request.start_date + timedelta(days=index)
        exercises = []
        if index in active_indexes:
            for order, (title, prescription, intensity, pause) in enumerate(templates[index]):
                exercises.append({
                    "sort_order": order,
                    "block_type": title.lower(),
                    "title": title,
                    "prescription": prescription,
                    "intensity": intensity,
                    "pause": pause,
                })
        days.append({
            "day_order": index,
            "date": current,
            "code": day_code(current),
            "warmup": "Calentamiento" if exercises else "",
            "cooldown": "Flexo - Elasticidad" if exercises else "Descanso / recuperación",
            "exercises": exercises,
        })
    return _base_plan_payload(request, athlete, days, "Plan semanal para 400 - 800 m.")


def _create_endurance_payload(request, athlete: Athlete) -> PlanInput:
    active_map = {3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: list(range(7))}
    active = set(active_map[request.days_per_week])
    labels = {"base": "Base aeróbica", "5k": "5 km", "10k": "10 km", "21k": "Medio maratón", "42k": "Maratón"}
    long_share = {"base": .28, "5k": .24, "10k": .27, "21k": .32, "42k": .36}[request.goal]
    definitions = [
        ("Rodaje aeróbico", "Trote continuo cómodo, técnica y movilidad", "Z2", .13),
        ("Intervalos", "Trabajo fraccionado específico en pista", "Z5", .15),
        ("Recuperación activa", "Rodaje muy suave para asimilar la carga", "Z1", .10),
        ("Umbral controlado", "Bloque sostenido sin llegar al esfuerzo máximo", "Z4", .16),
        ("Rodaje suave", "Volumen fácil y movilidad", "Z2", .10),
        ("Distancia media", "Rodaje estable con final progresivo", "Z2", .14),
        (f"Fondo para {labels[request.goal]}", "Fondo continuo, hidratación y técnica", "Z2", long_share),
    ]
    active_weight = sum(definitions[index][3] for index in active)
    reps_setup = {"base": (8, 400), "5k": (10, 400), "10k": (6, 800), "21k": (5, 1000), "42k": (4, 1600)}
    reps, distance = reps_setup[request.goal]
    level_factor = {"initial": .85, "intermediate": 1, "advanced": 1.15}[request.level]
    reps = max(3, round(reps * level_factor))
    days = []
    for index, (title, description, zone, weight) in enumerate(definitions):
        current = request.start_date + timedelta(days=index)
        exercises = []
        if index in active:
            km = round(request.weekly_km * weight / active_weight * 2) / 2
            prescription = f"{km:g} km continuos"
            pause = ""
            if index == 1:
                prescription = f"{reps} × {distance} m"
                pause = "Recuperación al trote"
            exercises = [{
                "sort_order": 0,
                "block_type": "principal",
                "title": title,
                "prescription": prescription,
                "intensity": zone,
                "pause": pause,
                "notes": description,
            }]
        days.append({
            "day_order": index,
            "date": current,
            "code": day_code(current),
            "warmup": "Calentamiento + movilidad dinámica" if exercises else "",
            "cooldown": "Trote suave + flexo-elasticidad" if exercises else "Descanso / recuperación",
            "exercises": exercises,
        })
    return _base_plan_payload(request, athlete, days, f"Plan semanal · {labels[request.goal]}")


def _base_plan_payload(request, athlete: Athlete, days: list[dict], title: str) -> PlanInput:
    end_date = request.start_date + timedelta(days=6)
    return PlanInput(
        athlete_id=athlete.id,
        title=title,
        month_label=f"{SPANISH_MONTHS[request.start_date.month - 1]} {request.start_date.year}",
        week_number=request.start_date.isocalendar().week,
        start_date=request.start_date,
        end_date=end_date,
        category=request.category or athlete.category,
        hours_per_week=request.hours_per_week,
        weekly_km=request.weekly_km,
        goal=request.goal,
        status="draft",
        days=days,
    )
