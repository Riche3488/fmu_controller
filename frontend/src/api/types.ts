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
};

export type DesignVar = { name: string; min: number; max: number; kind: 'float' | 'int' };
export type Direction = 'minimize' | 'maximize';
export type OptObjective = { objectiveId: string; direction: Direction };
export type Algorithm = 'tpe' | 'cmaes' | 'random' | 'nsga2';

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
  sortBy?: SortBy;
  sortDir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
};

export type RunRow = Run & { objectives: Record<string, ObjectiveValue> };
export type RunPage = Page<RunRow> & { codeHashes: Record<string, string> };

export type Timeseries = { time: number[]; series: Record<string, number[]> };

export type Health = { status: string; parallelBackend: 'ray' | 'pool' };
