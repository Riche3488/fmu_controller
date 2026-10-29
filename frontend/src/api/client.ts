import { createContext, createElement, useContext, type ReactNode } from 'react';
import type {
  BatchRequest,
  CandidatePreview,
  CandidateUpload,
  FmuSummary,
  Health,
  Job,
  JobEvent,
  Objective,
  ObjectiveInput,
  ObjectiveTestResult,
  OptimizationRequest,
  Page,
  RunPage,
  ResourceFile,
  RunQuery,
  Timeseries,
  Variable,
  VariableQuery,
  Variant,
} from './types';

export interface ApiClient {
  health(): Promise<Health>;

  listFmus(): Promise<FmuSummary[]>;
  uploadFmu(file: File): Promise<FmuSummary>;
  getFmu(id: string): Promise<FmuSummary>;
  deleteFmu(id: string): Promise<void>;
  listVariables(fmuId: string, q: VariableQuery): Promise<Page<Variable>>;

  listResources(fmuId: string): Promise<ResourceFile[]>;
  uploadCandidate(fmuId: string, path: string, file: File): Promise<CandidateUpload>;
  deleteCandidate(fmuId: string, candidateId: string): Promise<void>;
  previewCandidate(fmuId: string, candidateId: string, varName?: string): Promise<CandidatePreview>;
  listVariants(fmuId: string): Promise<Variant[]>;

  listObjectives(): Promise<Objective[]>;
  getObjective(id: string): Promise<Objective>;
  createObjective(input: ObjectiveInput): Promise<Objective>;
  updateObjective(id: string, input: ObjectiveInput): Promise<Objective>;
  deleteObjective(id: string): Promise<void>;
  testObjective(req: { code: string; runId: string }): Promise<ObjectiveTestResult>;

  createBatch(req: BatchRequest): Promise<Job>;
  createOptimization(req: OptimizationRequest): Promise<Job>;
  listJobs(q?: { fmuId?: string }): Promise<Job[]>;
  getJob(id: string): Promise<Job>;
  cancelJob(id: string): Promise<Job>;
  /** 이벤트 구독. 반환 함수를 호출하면 구독 해제. */
  subscribeJob(id: string, onEvent: (e: JobEvent) => void): () => void;

  listRuns(q: RunQuery): Promise<RunPage>;
  getTimeseries(runId: string, vars: string[], maxPoints?: number): Promise<Timeseries>;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return createElement(ApiContext.Provider, { value: client }, children);
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}
