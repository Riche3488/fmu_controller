"""API 스키마 — frontend/src/api/types.ts 와 동일한 형태 (JSON은 camelCase)."""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
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
    # 잡 모니터 시계열에 처음 띄울 변수 (기록 변수 중에서)
    plot_variables: list[str] = []

    @model_validator(mode="after")
    def _plot_in_record(self):
        missing = [v for v in self.plot_variables if v not in self.record_variables]
        if missing:
            raise ValueError(f"표시 변수는 기록 변수 중에서 골라야 합니다: {', '.join(missing)}")
        return self


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


class PresetResourceFixed(CamelModel):
    mode: Literal["fixed"]
    sha256: str


class PresetResourceSearch(CamelModel):
    mode: Literal["search"]
    sha256s: list[str] = Field(alias="sha256s")


PresetResource = Annotated[PresetResourceFixed | PresetResourceSearch, Field(discriminator="mode")]


class PresetRunConfig(CamelModel):
    """배치/최적화 공통 실행 설정. 미완성 설정도 저장할 수 있게 목록은 비어 있어도 된다."""
    fixed_params: dict[str, ParamValue] = {}
    sim: SimSettings
    record_variables: list[str] | None = None  # None = 출력 변수 전체
    plot_variables: list[str] = []
    workers: int = Field(default=1, ge=1)
    run_timeout_sec: float = Field(default=600, gt=0)


class OptPresetConfig(PresetRunConfig):
    design_vars: list[DesignVar] = []
    objectives: list[OptObjective] = []
    algorithm: Literal["tpe", "gp", "cmaes", "random", "nsga2"] = "tpe"
    n_trials: int = Field(default=50, ge=1)
    # resource path -> 후보 내용 sha256 (FMU마다 후보 id가 달라서)
    resources: dict[str, PresetResource] = {}


class PresetSweepList(CamelModel):
    """입력 중인 목록도 저장할 수 있게 값이 비어 있어도 된다"""
    name: str
    mode: Literal["list"]
    values: list[float] = []


PresetSweepParam = Annotated[PresetSweepList | SweepRange, Field(discriminator="mode")]


class BatchPresetConfig(PresetRunConfig):
    params: list[PresetSweepParam] = []
    sampling: Literal["grid", "zip", "lhs", "random"] = "grid"
    n_samples: int = Field(default=20, ge=1)
    # resource path -> 후보 내용 sha256 목록 (모든 조합을 실행)
    resources: dict[str, list[str]] = {}


PRESET_CONFIGS: dict[str, type[PresetRunConfig]] = {"optimization": OptPresetConfig, "batch": BatchPresetConfig}
PresetKind = Literal["optimization", "batch"]


class PresetIn(CamelModel):
    name: str = Field(min_length=1)
    kind: PresetKind = "optimization"
    source_fmu_id: str | None = None
    # kind에 맞는 설정 (OptPresetConfig/BatchPresetConfig)으로 검사한 뒤 JSON 그대로 저장한다
    config: dict

    @model_validator(mode="after")
    def _config_for_kind(self):
        try:
            cfg = PRESET_CONFIGS[self.kind].model_validate(self.config)
        except ValidationError as e:
            raise ValueError(f"{self.kind} 프리셋 설정이 올바르지 않습니다: {e}") from None
        self.config = cfg.model_dump(mode="json", by_alias=True)
        return self

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("이름을 입력하세요")
        return v


class PresetOut(CamelModel):
    id: str
    name: str
    kind: PresetKind
    source_fmu_id: str | None
    source_model_name: str
    config: dict
    created_at: datetime
    updated_at: datetime
