"""API 스키마 — frontend/src/api/types.ts 와 동일한 형태 (JSON은 camelCase)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class Health(CamelModel):
    status: str
    parallel_backend: str


class Page[T](CamelModel):
    total: int
    items: list[T]


class DefaultExperiment(CamelModel):
    start_time: float
    stop_time: float
    tolerance: float | None


class FmuSummary(CamelModel):
    id: str
    file_name: str
    model_name: str
    guid: str
    fmi_version: str
    fmi_types: list[str]
    generation_tool: str
    default_experiment: DefaultExperiment
    n_parameters: int
    n_outputs: int
    n_variables: int
    uploaded_at: datetime
    n_runs: int


class VariableOut(CamelModel):
    name: str
    value_reference: int
    causality: str
    variability: str
    type: str
    start: float | int | bool | str | None
    unit: str | None
    description: str | None


class SimSettings(CamelModel):
    start_time: float
    stop_time: float
    tolerance: float
    output_interval: float


class Timeseries(CamelModel):
    time: list[float]
    series: dict[str, list[float | None]]


class ObjectiveIn(CamelModel):
    name: str = Field(min_length=1)
    code: str

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("이름을 입력하세요")
        return v


class ObjectiveOut(CamelModel):
    id: str
    name: str
    code: str
    code_hash: str
    updated_at: datetime


class ObjectiveValue(CamelModel):
    value: float | None
    error: str | None


class ObjectiveTestIn(CamelModel):
    code: str
    run_id: str


class ObjectiveTestResult(ObjectiveValue):
    stdout: str
    duration_ms: int
