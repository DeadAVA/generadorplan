from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PACE_PATTERN = r"^\d{1,2}:[0-5]\d$"


class PaceZoneInput(BaseModel):
    zone: str = Field(pattern=r"^Z[1-5]$")
    pace_min: str = Field(pattern=PACE_PATTERN)
    pace_max: str = Field(pattern=PACE_PATTERN)

    @model_validator(mode="after")
    def validate_range(self):
        def seconds(value: str) -> int:
            minutes, secs = value.split(":")
            return int(minutes) * 60 + int(secs)

        if seconds(self.pace_min) > seconds(self.pace_max):
            raise ValueError("pace_min debe ser más rápido que pace_max")
        return self


class AthleteInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    category: str = Field(default="LIBRE", max_length=50)
    birth_date: date | None = None
    gender: str = Field(default="", max_length=30)
    contact: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=2000)
    active: bool = True
    pace_zones: list[PaceZoneInput] = Field(default_factory=list)

    @field_validator("name", "category")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.strip().split())


class PaceZoneRead(PaceZoneInput):
    model_config = ConfigDict(from_attributes=True)
    id: int


class AthleteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    category: str
    birth_date: date | None
    gender: str
    contact: str
    notes: str
    active: bool
    created_at: datetime
    updated_at: datetime
    pace_zones: list[PaceZoneRead] = Field(default_factory=list)


class ExerciseInput(BaseModel):
    sort_order: int = Field(default=0, ge=0)
    block_type: str = Field(default="principal", max_length=30)
    title: str = Field(min_length=1, max_length=240)
    prescription: str = Field(default="", max_length=2000)
    intensity: str = Field(default="", max_length=120)
    pause: str = Field(default="", max_length=120)
    pace: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=2000)


class ExerciseRead(ExerciseInput):
    model_config = ConfigDict(from_attributes=True)
    id: int


class PlanDayInput(BaseModel):
    day_order: int = Field(ge=0, le=6)
    date: date
    code: str = Field(default="", max_length=12)
    warmup: str = Field(default="Calentamiento", max_length=2000)
    cooldown: str = Field(default="Flexo - Elasticidad", max_length=2000)
    notes: str = Field(default="", max_length=2000)
    exercises: list[ExerciseInput] = Field(default_factory=list)


class PlanDayRead(PlanDayInput):
    model_config = ConfigDict(from_attributes=True)
    id: int
    exercises: list[ExerciseRead]


class PlanInput(BaseModel):
    athlete_id: str
    title: str = Field(default="Plan semanal", min_length=2, max_length=140)
    month_label: str = Field(default="", max_length=40)
    week_number: int = Field(default=1, ge=1, le=53)
    start_date: date
    end_date: date
    category: str = Field(default="LIBRE", max_length=50)
    hours_per_week: float = Field(default=0, ge=0, le=168)
    weekly_km: float = Field(default=0, ge=0, le=1000)
    goal: str = Field(default="Base aeróbica", max_length=100)
    status: str = Field(default="draft", pattern=r"^(draft|published|archived)$")
    notes: str = Field(default="", max_length=4000)
    days: list[PlanDayInput] = Field(default_factory=list, max_length=7)

    @model_validator(mode="after")
    def validate_dates_and_days(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date no puede ser anterior a start_date")
        orders = [day.day_order for day in self.days]
        if len(orders) != len(set(orders)):
            raise ValueError("No puede repetirse un día en el mismo plan")
        return self


class PlanSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    athlete_id: str
    athlete_name: str
    title: str
    week_number: int
    start_date: date
    end_date: date
    category: str
    hours_per_week: float
    weekly_km: float
    goal: str
    status: str
    updated_at: datetime


class PlanRead(PlanInput):
    model_config = ConfigDict(from_attributes=True)
    id: str
    athlete_name: str
    created_at: datetime
    updated_at: datetime
    days: list[PlanDayRead]


class FieldTestInput(BaseModel):
    athlete_name: str = Field(min_length=1, max_length=80)
    athlete_age: int = Field(ge=1, le=120)
    protocol: str = Field(min_length=1, max_length=40)
    test_date: date
    recordings_json: str = Field(default="[]")
    vo2max: float | None = None
    fc_max: int | None = None
    fc_min: int | None = None
    notes: str = Field(default="", max_length=2000)


class FieldTestRead(FieldTestInput):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime


class GeneratePlanRequest(BaseModel):
    athlete_id: str
    start_date: date
    goal: str = Field(default="10k", pattern=r"^(base|5k|10k|21k|42k|400-800)$")
    level: str = Field(default="intermediate", pattern=r"^(initial|intermediate|advanced)$")
    days_per_week: int = Field(default=5, ge=3, le=7)
    weekly_km: float = Field(default=45, ge=10, le=300)
    category: str = Field(default="LIBRE", max_length=50)
    hours_per_week: float = Field(default=6, ge=0, le=168)
