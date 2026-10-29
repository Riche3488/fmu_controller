// API 계약 — backend/app/schemas.py 와 동일한 형태를 유지한다.

export type FmiType = 'ModelExchange' | 'CoSimulation';

export type FmuSummary = {
  id: string;
  fileName: string;
  modelName: string;
  guid: string;
  fmiVersion: string;
  fmiTypes: FmiType[];
  generationTool: string;
  defaultExperiment: { startTime: number; stopTime: number; tolerance: number | null };
  nParameters: number;
  nOutputs: number;
  nVariables: number;
  uploadedAt: string;
  nRuns: number;
};

export type VariableType = 'Real' | 'Integer' | 'Boolean' | 'String' | 'Enumeration';

export type Variable = {
  name: string;
  valueReference: number;
  causality: string;
  variability: string;
  type: VariableType;
  start: number | boolean | string | null;
  unit: string | null;
  description: string | null;
};

export type Page<T> = { total: number; items: T[] };

export type VariableQuery = { q?: string; causality?: string; offset?: number; limit?: number };

export type SimSettings = { startTime: number; stopTime: number; tolerance: number; outputInterval: number };

export type SweepParam =
  | { name: string; mode: 'list'; values: number[] }
  | { name: string; mode: 'range'; min: number; max: number; steps: number };

export type Sampling = 'grid' | 'zip' | 'lhs' | 'random';

export type ParamValue = number | boolean;

export type BatchRequest = {
  name: string;
  fmuId: string;
  params: SweepParam[];
  sampling: Sampling;
  nSamples: number | null;
  fixedParams: Record<string, ParamValue>;
  sim: SimSettings;
  recordVariables: string[];
  workers: number;
  runTimeoutSec: number;
  /** resource path -> 후보 id 목록 (생략 = 원본) */
  resources?: Record<string, string[]>;
  /** 잡 모니터 시계열에 처음 띄울 변수 (recordVariables 중에서) */
  plotVariables?: string[];
};

export type DesignVar = { name: string; min: number; max: number; kind: 'float' | 'int' };
export type Direction = 'minimize' | 'maximize';
export type OptObjective = { objectiveId: string; direction: Direction };
export type Algorithm = 'tpe' | 'gp' | 'cmaes' | 'random' | 'nsga2';
export type OptResource = { mode: 'fixed'; candidateId: string } | { mode: 'search'; candidateIds: string[] };

export type OptimizationRequest = {
  name: string;
  fmuId: string;
  designVars: DesignVar[];
  objectives: OptObjective[];
  algorithm: Algorithm;
  nTrials: number;
  fixedParams: Record<string, ParamValue>;
  sim: SimSettings;
  recordVariables: string[];
  workers: number;
  runTimeoutSec: number;
  resources?: Record<string, OptResource>;
  /** 잡 모니터 시계열에 처음 띄울 변수 (recordVariables 중에서) */
  plotVariables?: string[];
};

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobKind = 'batch' | 'optimization';

export type ObjectiveSnapshot = Record<string, { name: string; codeHash: string }>;

export type Job = {
  id: string;
  kind: JobKind;
  name: string;
  fmuId: string;
  status: JobStatus;
  total: number;
  completed: number;
  failed: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  config: BatchRequest | OptimizationRequest;
  objectiveSnapshot: ObjectiveSnapshot | null;
};

export type Run = {
  id: string;
  jobId: string;
  fmuId: string;
  index: number;
  params: Record<string, ParamValue>;
  status: 'ok' | 'failed';
  error: string | null;
  elapsedSec: number;
  variantId: string;
};

export type JobEvent =
  | { type: 'progress'; job: Job }
  | { type: 'run'; run: Run }
  | { type: 'end'; job: Job };

export type Objective = { id: string; name: string; code: string; codeHash: string; updatedAt: string };
export type ObjectiveInput = { name: string; code: string };
export type ObjectiveValue = { value: number | null; error: string | null };
export type ObjectiveTestResult = ObjectiveValue & { stdout: string; durationMs: number };

export type SortBy = 'index' | 'elapsedSec' | `param:${string}` | `objective:${string}`;

export type RunQuery = {
  fmuId?: string;
  jobIds?: string[];
  status?: 'ok' | 'failed';
  objectiveIds?: string[];
  variantIds?: string[];
  sortBy?: SortBy;
  sortDir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
};

export type RunRow = Run & { objectives: Record<string, ObjectiveValue> };
export type RunPage = Page<RunRow> & { codeHashes: Record<string, string> };

export type Timeseries = { time: number[]; series: Record<string, number[]> };

export type Health = { status: string; parallelBackend: 'ray' | 'pool'; gpAvailable: boolean };

export type ResourceCandidate = {
  id: string; path: string; name: string; size: number; sha256: string; isOriginal: boolean; nRuns: number; createdAt: string;
};
/** candidates[0]은 원본 */
export type ResourceFile = { path: string; size: number; sha256: string; candidates: ResourceCandidate[] };
export type CandidateUpload = ResourceCandidate & { existing: boolean };
export type MatVariable = { name: string; shape: number[]; dtype: string };
export type CandidatePreview =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'mat'; variables: MatVariable[]; plot: { name: string; rows: number[][] } | null }
  | { kind: 'binary'; note: string };
/** Resource 조합: FMU + 원본이 아닌 후보로 바꾼 파일들 (assignment: path -> 후보 id) */
export type Variant = {
  id: string; fmuId: string; label: string; assignment: Record<string, string>; isOriginal: boolean; nRuns: number;
};

/** 프리셋 안의 resource 선택. 후보 id는 FMU마다 달라서 내용 sha256으로 기록한다. */
export type PresetResource = { mode: 'fixed'; sha256: string } | { mode: 'search'; sha256s: string[] };
/** 배치/최적화 공통 실행 설정 (잡 이름·FMU 제외). recordVariables null = 출력 변수 전체 */
export type PresetRunConfig = {
  fixedParams: Record<string, ParamValue>;
  sim: SimSettings;
  recordVariables: string[] | null;
  plotVariables: string[];
  workers: number;
  runTimeoutSec: number;
};
export type OptPresetConfig = PresetRunConfig & {
  designVars: DesignVar[];
  objectives: OptObjective[];
  algorithm: Algorithm;
  nTrials: number;
  resources: Record<string, PresetResource>;
};
/** 입력 중인 목록도 저장할 수 있게 list 값은 비어 있어도 된다 */
export type BatchPresetConfig = PresetRunConfig & {
  params: SweepParam[];
  sampling: Sampling;
  nSamples: number;
  /** resource path -> 후보 내용 sha256 목록 */
  resources: Record<string, string[]>;
};
export type PresetConfigs = { optimization: OptPresetConfig; batch: BatchPresetConfig };
export type PresetKind = keyof PresetConfigs;
type PresetMeta = { id: string; name: string; sourceFmuId: string | null; sourceModelName: string; createdAt: string; updatedAt: string };
export type PresetOf<K extends PresetKind> = PresetMeta & { kind: K; config: PresetConfigs[K] };
export type Preset = PresetOf<'optimization'> | PresetOf<'batch'>;
export type PresetInputOf<K extends PresetKind> = { name: string; kind: K; sourceFmuId: string | null; config: PresetConfigs[K] };
export type PresetInput = PresetInputOf<'optimization'> | PresetInputOf<'batch'>;
