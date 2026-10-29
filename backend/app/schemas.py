"""API 스키마 — frontend/src/api/types.ts 와 동일한 형태 (JSON은 camelCase)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict
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
