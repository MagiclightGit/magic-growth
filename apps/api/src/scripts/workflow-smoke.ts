import { waitForScoring } from './wait-for-scoring.js';
import assert from 'node:assert/strict';
import { signInWithRetry } from './sign-in-retry.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { eq, inArray, or } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { auth, createDatabase, growth } from '@guangmo/database';
import {
  COLLECTION_WORKFLOW_VERSION,
  RESEARCH_QUEUE,
  redisConnection,
  type Candidate,
  type CandidateInput,
  type CandidateBatch,
  type WorkflowTask,
} from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { env } from '../config/env.js';
assert.notEqual(process.env.NODE_ENV, 'production');
const { db, pool } = createDatabase(env.DATABASE_URL);
const redis = new Redis({
  ...redisConnection(env.REDIS_URL),
  maxRetriesPerRequest: 1,
});
const queue = new Queue(RESEARCH_QUEUE, { connection: redis });
const prefix = `workflow-${randomUUID()}`;
const password = randomUUID() + 'aA1!';
const users: string[] = [];
const runs: string[] = [];
const items: string[] = [];
const manualCandidates: string[] = [];
const jobs: string[] = [];
const base = `http://127.0.0.1:${env.API_PORT}/api`;
async function request(
  path: string,
  cookie = '',
  method = 'GET',
  body?: unknown,
) {
  return fetch(base + path, {
    method,
    headers: {
      cookie,
      origin: env.WEB_ORIGIN,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json<T>(
  path: string,
  cookie: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await request(path, cookie, method, body);
  assert.ok(
    response.ok,
    `${method} ${path}: ${response.status} ${await response.clone().text()}`,
  );
  return (await response.json()) as T;
}
async function createRun(owner: string) {
  const [run] = await db
    .insert(growth.researchRuns)
    .values({
      product: 'MagicTattoo',
      goal: `${prefix} isolated workflow fixture`,
      createdBy: owner,
      status: 'succeeded',
      result:
        'AI SDK is a TypeScript toolkit for AI apps. Official reference: https://ai-sdk.dev/docs/introduction',
      completedAt: new Date(),
    })
    .returning();
  assert.ok(run);
  runs.push(run.id);
  return run;
}
try {
  assert.equal((await request('/candidates')).status, 401);
  const cookies: Record<string, string> = {};
  for (const role of ['operator', 'viewer'] as const) {
    const member = await provisionMember(db, {
      name: `${prefix}-${role}`,
      email: `${prefix}-${role}@example.com`,
      password,
      productIds: ['MagicTattoo', 'MagicLight'],
      role,
    });
    assert.ok(member);
    users.push(member.id);
    const response = await signInWithRetry(() =>
      request('/auth/sign-in/email', '', 'POST', {
        email: member.email,
        password,
        productIds: ['MagicTattoo', 'MagicLight'],
      }),
    );
    assert.equal(response.status, 200);
    cookies[role] = response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
  }
  const operator = cookies.operator!;
  const viewer = cookies.viewer!;
  const run = await createRun(users[0]!);
  const [stage] = await db
    .insert(growth.researchExtractions)
    .values({
      runId: run.id,
      createdBy: users[0]!,
      workflowVersion: COLLECTION_WORKFLOW_VERSION,
      status: 'succeeded',
      completedAt: new Date(),
    })
    .returning();
  assert.ok(stage);
  const payload: CandidateInput = {
    title: `${prefix} source finding`,
    summary: 'Isolated workflow fixture for transactional review tests.',
    product: 'MagicTattoo',
    market: 'US',
    category: 'industry',
    claimType: 'analysis',
    publishedAt: null,
    language: null,
    tags: ['test'],
    suggestedAction: 'Review the linked evidence.',
    sources: [
      {
        url: `https://example.com/${prefix}/primary?utm_source=test`,
        title: 'Primary fixture source',
        evidence: 'Fixture evidence summary',
      },
      {
        url: `https://example.com/${prefix}/secondary`,
        title: 'Second source',
        evidence: 'Another evidence summary',
      },
    ],
  };
  const manualInput = {
    ...payload,
    vertical: 'tattoo',
    publishedAt: new Date().toISOString(),
    sourceUrl: `https://example.com/${prefix}/manual`,
    evidence: '',
  };
  assert.equal(
    (await request('/candidates', viewer, 'POST', manualInput)).status,
    403,
  );
  const lead = await json<Candidate>(
    '/candidates',
    operator,
    'POST',
    manualInput,
  );
  manualCandidates.push(lead.id);
  assert.equal(lead.status, 'needs_evidence');
  assert.equal(lead.runId, null);
  assert.equal(
    (
      await request('/candidates', operator, 'POST', {
        ...manualInput,
        sourceUrl: manualInput.sourceUrl + '?utm_source=duplicate',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/candidates/${lead.id}/review`, operator, 'POST', {
        revision: 0,
        action: 'approve',
      })
    ).status,
    409,
  );
  const search = new URLSearchParams({
    view: 'today',
    vertical: 'tattoo',
    search: prefix,
  });
  const inbox = () => json<{ id: string }[]>(`/intelligence?${search}`, viewer);
  assert.deepEqual(await inbox(), []);
  const editLead = await json<Candidate>(
    `/candidates/${lead.id}`,
    operator,
    'PATCH',
    {
      revision: 0,
      candidate: {
        ...payload,
        vertical: 'tattoo',
        publishedAt: manualInput.publishedAt,
        sources: [
          {
            url: manualInput.sourceUrl,
            title: '',
            evidence: 'Fixture source excerpt',
          },
        ],
      },
    },
  );
  assert.equal(editLead.status, 'pending');
  const parked = await json<Candidate>(
    `/candidates/${lead.id}/review`,
    operator,
    'POST',
    {
      action: 'request_evidence',
      revision: editLead.revision,
      reason: '核对原文日期',
    },
  );
  assert.equal(parked.status, 'needs_evidence');
  assert.equal(parked.reviewReason, '核对原文日期');
  const ready = await json<Candidate>(
    `/candidates/${lead.id}`,
    operator,
    'PATCH',
    {
      revision: parked.revision,
      candidate: editLead,
    },
  );
  const admitted = await json<Candidate>(
    `/candidates/${lead.id}/review`,
    operator,
    'POST',
    {
      action: 'approve',
      revision: ready.revision,
    },
  );
  assert.ok(admitted.intelligenceId);
  items.push(admitted.intelligenceId);
  assert.deepEqual(
    (await inbox()).map((item) => item.id),
    [admitted.intelligenceId],
  );
  console.log(
    'PASS: manual lead deduplication, evidence gate, review reason, and verified publication view',
  );
  const [first] = await db
    .insert(growth.intelligenceCandidates)
    .values({ runId: run.id, extractionId: stage.id, position: 0, payload })
    .returning();
  assert.ok(first);
  assert.equal(
    (
      await request(`/candidates/${first.id}/review`, viewer, 'POST', {
        revision: 0,
        action: 'approve',
      })
    ).status,
    403,
  );
  const edited = await json<Candidate>(
    `/candidates/${first.id}`,
    operator,
    'PATCH',
    {
      revision: 0,
      candidate: { ...payload, title: `${prefix} reviewed finding` },
    },
  );
  assert.equal(edited.revision, 1);
  assert.equal(
    (
      await request(`/candidates/${first.id}`, operator, 'PATCH', {
        revision: 0,
        candidate: payload,
      })
    ).status,
    409,
  );
  const approvals = await Promise.all(
    [0, 1].map(() =>
      json<Candidate>(`/candidates/${first.id}/review`, operator, 'POST', {
        revision: 1,
        action: 'approve',
      }),
    ),
  );
  assert.equal(approvals[0]!.intelligenceId, approvals[1]!.intelligenceId);
  const itemId = approvals[0]!.intelligenceId!;
  items.push(itemId);
  assert.equal(
    (
      await request(`/candidates/${first.id}/review`, operator, 'POST', {
        revision: 1,
        action: 'reject',
        reason: '测试已审核记录不能再次修改',
      })
    ).status,
    409,
  );
  const [second] = await db
    .insert(growth.intelligenceCandidates)
    .values({
      runId: run.id,
      extractionId: stage.id,
      position: 1,
      payload: {
        ...payload,
        sources: [
          payload.sources[0]!,
          {
            url: `https://example.com/${prefix}/third`,
            title: 'Third source',
            evidence: 'Extra evidence',
          },
        ],
      },
    })
    .returning();
  assert.ok(second);
  const merged = await json<Candidate>(
    `/candidates/${second.id}/review`,
    operator,
    'POST',
    { revision: 0, action: 'approve' },
  );
  assert.equal(merged.intelligenceId, itemId);
  const evidence = await json<{ sources: unknown[]; status: string }>(
    `/intelligence/${itemId}`,
    viewer,
  );
  assert.equal(evidence.sources.length, 3);
  assert.equal(evidence.status, 'verified');
  const taskInput = {
    title: `${prefix} content task`,
    kind: 'content',
    channel: 'TikTok',
    assigneeId: users[0],
    dueAt: null,
    priority: 'normal',
  };
  assert.equal(
    (await request(`/intelligence/${itemId}/tasks`, viewer, 'POST', taskInput))
      .status,
    403,
  );
  assert.equal(
    (
      await request(`/intelligence/${itemId}/tasks`, operator, 'POST', {
        ...taskInput,
        assigneeId: users[1],
      })
    ).status,
    409,
  );
  const tasks = await Promise.all(
    [0, 1].map(() =>
      json<WorkflowTask>(
        `/intelligence/${itemId}/tasks`,
        operator,
        'POST',
        taskInput,
      ),
    ),
  );
  assert.equal(tasks[0]!.id, tasks[1]!.id);
  let task = tasks[0]!;
  assert.equal(
    (
      await request(`/tasks/${task.id}`, operator, 'PATCH', {
        revision: task.revision,
        status: 'completed',
        result: 'should not skip stages',
      })
    ).status,
    409,
  );
  task = await json<WorkflowTask>(`/tasks/${task.id}`, operator, 'PATCH', {
    revision: task.revision,
    status: 'in_progress',
  });
  assert.equal(
    (
      await request(`/tasks/${task.id}`, operator, 'PATCH', {
        revision: 0,
        status: 'in_review',
      })
    ).status,
    409,
  );
  task = await json<WorkflowTask>(`/tasks/${task.id}`, operator, 'PATCH', {
    revision: task.revision,
    status: 'in_review',
  });
  assert.equal(
    (
      await request(`/tasks/${task.id}`, operator, 'PATCH', {
        revision: task.revision,
        status: 'completed',
      })
    ).status,
    409,
  );
  task = await json<WorkflowTask>(`/tasks/${task.id}`, operator, 'PATCH', {
    revision: task.revision,
    status: 'completed',
    result: 'Completed isolated workflow validation.',
  });
  assert.equal(task.status, 'completed');
  const detail = await json<{ tasks: WorkflowTask[] }>(
    `/intelligence/${itemId}`,
    viewer,
  );
  assert.equal(detail.tasks[0]!.result, task.result);
  const audit = await db
    .select()
    .from(growth.auditLog)
    .where(eq(growth.auditLog.objectId, task.id));
  assert.equal(audit.filter((v) => v.action === 'task.created').length, 1);
  assert.ok(audit.some((v) => v.action === 'task.updated'));
  const failedRun = await createRun(users[1]!);
  const [failedStage] = await db
    .insert(growth.researchExtractions)
    .values({
      runId: failedRun.id,
      createdBy: users[1]!,
      workflowVersion: COLLECTION_WORKFLOW_VERSION,
    })
    .returning();
  assert.ok(failedStage);
  jobs.push(`extract-${failedStage.id}-0`);
  let failed: CandidateBatch | undefined;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    failed = await json<CandidateBatch>(
      `/research/${failedRun.id}/candidates`,
      operator,
    );
    if (failed.extraction?.status === 'failed') break;
    await delay(500);
  }
  assert.equal(failed?.extraction?.status, 'failed');
  assert.equal(failed.extraction.attempts, 2);
  assert.equal(failed.candidates.length, 0);
  const original = await json<{ status: string; result: string }>(
    `/research/${failedRun.id}`,
    viewer,
  );
  assert.equal(original.status, 'succeeded');
  assert.ok(original.result);
  // A source-free report exercises explicit stage retry without a paid model call.
  const retryRun = await createRun(users[0]!);
  await db
    .update(growth.researchRuns)
    .set({ result: 'No verifiable sources were found.' })
    .where(eq(growth.researchRuns.id, retryRun.id));
  const [retryStage] = await db
    .insert(growth.researchExtractions)
    .values({
      runId: retryRun.id,
      createdBy: users[0]!,
      workflowVersion: COLLECTION_WORKFLOW_VERSION,
      status: 'failed',
      attempts: 2,
    })
    .returning();
  assert.ok(retryStage);
  const retried = await json<{ id: string; generation: number }>(
    `/research/${retryRun.id}/extraction`,
    operator,
    'POST',
    {},
  );
  assert.equal(retried.generation, 1);
  jobs.push(`extract-${retried.id}-1`);
  const repeated = await json<{ generation: number }>(
    `/research/${retryRun.id}/extraction`,
    operator,
    'POST',
    {},
  );
  assert.equal(repeated.generation, 1);
  let retryBatch: CandidateBatch | undefined;
  const retryDeadline = Date.now() + 25000;
  while (Date.now() < retryDeadline) {
    retryBatch = await json<CandidateBatch>(
      `/research/${retryRun.id}/candidates`,
      operator,
    );
    if (retryBatch.extraction?.status === 'succeeded') break;
    await delay(500);
  }
  assert.equal(retryBatch?.extraction?.status, 'succeeded');
  assert.equal(retryBatch.candidates.length, 0);
  const afterRetry = await json<{ result: string }>(
    `/research/${retryRun.id}`,
    operator,
  );
  assert.equal(afterRetry.result, 'No verifiable sources were found.');
  console.log(
    'PASS: review RBAC, revision conflicts, concurrent idempotency, evidence preservation, task assignment/state/result, audit, extraction retries without rerunning research',
  );
  if (process.env.WORKFLOW_REAL_MODEL === '1') {
    const realRun = await createRun(users[0]!);
    const reports = await db
      .select()
      .from(growth.researchRuns)
      .where(eq(growth.researchRuns.status, 'succeeded'));
    const realReport = reports.find(
      (report) =>
        !runs.includes(report.id) &&
        report.goal.includes('纹身') &&
        report.result,
    );
    if (realReport)
      await db
        .update(growth.researchRuns)
        .set({ goal: realReport.goal, result: realReport.result })
        .where(eq(growth.researchRuns.id, realRun.id));
    const stage = await json<{ id: string; generation: number }>(
      `/research/${realRun.id}/extraction`,
      operator,
      'POST',
      {},
    );
    jobs.push(`extract-${stage.id}-${stage.generation}`);
    let batch: CandidateBatch | undefined;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      batch = await json<CandidateBatch>(
        `/research/${realRun.id}/candidates`,
        operator,
      );
      if (['succeeded', 'failed'].includes(batch.extraction?.status ?? ''))
        break;
      await delay(1000);
    }
    assert.equal(
      batch?.extraction?.status,
      'succeeded',
      batch?.extraction?.error ?? 'No extraction result',
    );
    if (realReport) assert.ok(batch.candidates.length > 0);
    assert.ok(batch.candidates.every((v) => v.status === 'pending'));
    console.log(
      `PASS: real AI SDK structured extraction, ${batch.candidates.length} pending candidates`,
    );
  }
} finally {
  let active = !(await waitForScoring(db, users));
  for (const id of jobs) {
    const job = await queue.getJob(id);
    if (job) {
      if ((await job.getState()) === 'active') active = true;
      else await job.remove();
    }
  }
  if (!active) {
    if (manualCandidates.length)
      await db
        .delete(growth.intelligenceCandidates)
        .where(inArray(growth.intelligenceCandidates.id, manualCandidates));
    if (items.length)
      await db
        .delete(growth.workflowTasks)
        .where(inArray(growth.workflowTasks.intelligenceId, items));
    if (runs.length)
      await db
        .delete(growth.researchRuns)
        .where(inArray(growth.researchRuns.id, runs));
    if (items.length)
      await db
        .delete(growth.intelligence)
        .where(inArray(growth.intelligence.id, items));
    if (users.length) {
      await db
        .delete(growth.auditLog)
        .where(
          or(
            inArray(growth.auditLog.actorId, users),
            inArray(growth.auditLog.objectId, users),
          ),
        );
      await db.delete(auth.user).where(inArray(auth.user.id, users));
    }
  } else
    console.log('Active test job retained with its fixtures for diagnosis.');
  await queue.close();
  redis.disconnect();
  await pool.end();
}
