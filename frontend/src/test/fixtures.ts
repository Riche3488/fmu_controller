import { waitFor } from '@testing-library/react';
import type { ApiClient } from '../api/client';
import { MOCK_FMU_ID } from '../api/mock/mockClient';
import type { BatchRequest, Job } from '../api/types';

export const SIM = { startTime: 0, stopTime: 10, tolerance: 1e-4, outputInterval: 1 };

export function batchReq(over: Partial<BatchRequest> = {}): BatchRequest {
  return {
    name: 'b', fmuId: MOCK_FMU_ID, params: [{ name: 'p', mode: 'list', values: [1, 2, 3] }],
    sampling: 'grid', nSamples: null, fixedParams: {}, sim: SIM,
    recordVariables: ['controlBus.chassisBus.longitudinalVelocity'], workers: 2, runTimeoutSec: 600, ...over,
  };
}

/** 배치 잡을 만들고 끝날 때까지 기다린다 (mock tickMs가 작아야 함). */
export async function finishedBatch(client: ApiClient, over: Partial<BatchRequest> = {}): Promise<Job> {
  const job = await client.createBatch(batchReq(over));
  await waitFor(async () => expect((await client.getJob(job.id)).status).toBe('done'), { timeout: 3000 });
  return client.getJob(job.id);
}
