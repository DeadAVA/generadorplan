from datetime import date, datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, UniqueConstraint
from sqlalchemy.types import Text
from sqlmodel import Field, Relationship, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Athlete(SQLModel, table=True):
    __tablename__ = "athletes"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    name: str = Field(index=True, max_length=80)
    category: str = Field(default="LIBRE", max_length=50)
    birth_date: date | None = None
    gender: str = Field(default="", max_length=30)
    contact: str = Field(default="", max_length=120)
    notes: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    active: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    pace_zones: list["PaceZone"] = Relationship(
        back_populates="athlete",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    plans: list["TrainingPlan"] = Relationship(
        back_populates="athlete",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class PaceZone(SQLModel, table=True):
    __tablename__ = "pace_zones"
    __table_args__ = (UniqueConstraint("athlete_id", "zone", name="uq_athlete_zone"),)

    id: int | None = Field(default=None, primary_key=True)
    athlete_id: str = Field(foreign_key="athletes.id", index=True, ondelete="CASCADE")
    zone: str = Field(max_length=3)
    pace_min: str = Field(max_length=8)
    pace_max: str = Field(max_length=8)

    athlete: Athlete | None = Relationship(back_populates="pace_zones")


class TrainingPlan(SQLModel, table=True):
    __tablename__ = "training_plans"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    athlete_id: str = Field(foreign_key="athletes.id", index=True, ondelete="CASCADE")
    title: str = Field(default="Plan semanal", max_length=140)
    month_label: str = Field(default="", max_length=40)
    week_number: int = Field(default=1, ge=1, le=53)
    start_date: date
    end_date: date
    category: str = Field(default="LIBRE", max_length=50)
    hours_per_week: float = Field(default=0, ge=0)
    weekly_km: float = Field(default=0, ge=0)
    goal: str = Field(default="Base aeróbica", max_length=100)
    status: str = Field(default="draft", max_length=20, index=True)
    notes: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    athlete: Athlete | None = Relationship(back_populates="plans")
    days: list["PlanDay"] = Relationship(
        back_populates="plan",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "order_by": "PlanDay.day_order"},
    )


class PlanDay(SQLModel, table=True):
    __tablename__ = "plan_days"
    __table_args__ = (UniqueConstraint("plan_id", "day_order", name="uq_plan_day_order"),)

    id: int | None = Field(default=None, primary_key=True)
    plan_id: str = Field(foreign_key="training_plans.id", index=True, ondelete="CASCADE")
    day_order: int = Field(ge=0, le=6)
    date: date
    code: str = Field(default="", max_length=12)
    warmup: str = Field(default="Calentamiento", sa_column=Column(Text, nullable=False, default="Calentamiento"))
    cooldown: str = Field(default="Flexo - Elasticidad", sa_column=Column(Text, nullable=False, default="Flexo - Elasticidad"))
    notes: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))

    plan: TrainingPlan | None = Relationship(back_populates="days")
    exercises: list["Exercise"] = Relationship(
        back_populates="day",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "order_by": "Exercise.sort_order"},
    )


class Exercise(SQLModel, table=True):
    __tablename__ = "exercises"

    id: int | None = Field(default=None, primary_key=True)
    plan_day_id: int = Field(foreign_key="plan_days.id", index=True, ondelete="CASCADE")
    sort_order: int = Field(default=0, ge=0)
    block_type: str = Field(default="principal", max_length=30)
    title: str = Field(max_length=240)
    prescription: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    intensity: str = Field(default="", max_length=120)
    pause: str = Field(default="", max_length=120)
    pace: str = Field(default="", max_length=80)
    notes: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))

    day: PlanDay | None = Relationship(back_populates="exercises")


class FieldTest(SQLModel, table=True):
    __tablename__ = "field_tests"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    athlete_name: str = Field(index=True, max_length=80)
    athlete_age: int = Field(ge=1, le=120)
    protocol: str = Field(max_length=40, index=True)
    test_date: date
    recordings_json: str = Field(default="[]", sa_column=Column(Text, nullable=False, default="[]"))
    vo2max: float | None = None
    fc_max: int | None = None
    fc_min: int | None = None
    notes: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    created_at: datetime = Field(default_factory=utcnow)
