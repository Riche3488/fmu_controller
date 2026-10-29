"""API 스키마 — frontend/src/api/types.ts 와 동일한 형태 (JSON은 camelCase)."""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class Health(CamelModel):
    status: str
    parallel_backend: str
    gp_available: bool


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


class SweepList(CamelModel):
    name: str
    mode: Literal["list"]
    values: list[float] = Field(min_length=1)


class SweepRange(CamelModel):
    name: str
    mode: Literal["range"]
    min: float
    max: float
    steps: int = Field(ge=1)


SweepParam = Annotated[SweepList | SweepRange, Field(discriminator="mode")]
ParamValue = float | bool


class RunSettingsBase(CamelModel):
    name: str
    fmu_id: str
    fixed_params: dict[str, ParamValue] = {}
    sim: SimSettings
    record_variables: list[str]
    workers: int = Field(ge=1)
    run_timeout_sec: float = Field(gt=0)


class BatchRequest(RunSettingsBase):
    params: list[SweepParam] = Field(min_length=1)
    sampling: Literal["grid", "zip", "lhs", "random"]
    n_samples: int | None = Field(default=None, ge=1)
    # resource path -> 후보 id 목록 (파라미터 케이스와 직곱)
    resources: dict[str, list[str]] = {}

    @field_validator("resources")
    @classmethod
    def _dedupe_candidates(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        return {p: list(dict.fromkeys(ids)) for p, ids in v.items()}


class JobOut(CamelModel):
    id: str
    kind: Literal["batch", "optimization"]
    name: str
    fmu_id: str
    status: Literal["queued", "running", "done", "failed", "cancelled"]
    total: int
    completed: int
    failed: int
    created_at: datetime
    finished_at: datetime | None
    error: str | None
    config: dict
    objective_snapshot: dict | None


class RunOut(CamelModel):
    id: str
    job_id: str
    fmu_id: str
    index: int
    params: dict[str, ParamValue]
    status: Literal["ok", "failed"]
    error: str | None
    elapsed_sec: float
    variant_id: str


class RunRow(RunOut):
    objectives: dict[str, ObjectiveValue]


class RunPage(CamelModel):
    total: int
    items: list[RunRow]
    code_hashes: dict[str, str]


class DesignVar(CamelModel):
    name: str
    min: float
    max: float
    kind: Literal["float", "int"] = "float"


class OptObjective(CamelModel):
    objective_id: str
    direction: Literal["minimize", "maximize"]


class OptResourceFixed(CamelModel):
    mode: Literal["fixed"]
    candidate_id: str


class OptResourceSearch(CamelModel):
    mode: Literal["search"]
    candidate_ids: list[str]

    @field_validator("candidate_ids")
    @classmethod
    def _dedupe(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


OptResource = Annotated[OptResourceFixed | OptResourceSearch, Field(discriminator="mode")]


class OptimizationRequest(RunSettingsBase):
    design_vars: list[DesignVar] = Field(min_length=1)
    objectives: list[OptObjective] = Field(min_length=1)
    algorithm: Literal["tpe", "gp", "cmaes", "random", "nsga2"]
    n_trials: int = Field(ge=1)
    # resource path -> 고정(후보 1개) 또는 탐색(최적화가 후보 중 선택)
    resources: dict[str, OptResource] = {}


class ResourceCandidateOut(CamelModel):
    id: str
    path: str
    name: str
    size: int
    sha256: str
    is_original: bool
    n_runs: int
    created_at: datetime


class ResourceFileOut(CamelModel):
    path: str
    size: int
    sha256: str
    candidates: list[ResourceCandidateOut]  # [0]은 원본


class CandidateUploadOut(ResourceCandidateOut):
    existing: bool


class MatVariable(CamelModel):
    name: str
    shape: list[int]
    dtype: str


class MatPlot(CamelModel):
    name: str
    rows: list[list[float | None]]


class CandidatePreviewOut(CamelModel):
    """kind별로 필요한 필드만 채운다 (응답에서 None 필드는 뺀다)"""
    kind: Literal["text", "mat", "binary"]
    text: str | None = None
    truncated: bool | None = None
    variables: list[MatVariable] | None = None
    plot: MatPlot | None = None
    note: str | None = None


class VariantOut(CamelModel):
    id: str
    fmu_id: str
    label: str
    assignment: dict[str, str]
    is_original: bool
    n_runs: int
