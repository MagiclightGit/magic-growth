import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { eq, inArray, or } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { auth, createDatabase, growth } from '@guangmo/database';
import {
  RESEARCH_QUEUE,
  redisConnection,
  scoreContext,
  calculateScore,
  type Candidate,
} from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { env } from '../config/env.js';
import { signInWithRetry } from './sign-in-retry.js';
assert.notEqual(process.env.NODE_ENV, 'production');
assert.equal(
  process.env.SCORING_REAL_MODEL,
  '1',
  'Use SCORING_REAL_MODEL=1: this local test calls the configured paid model',
);
const { db, pool } = createDatabase(env.DATABASE_URL);
const redis = new Redis({
  ...redisConnection(env.REDIS_URL),
  maxRetriesPerRequest: 1,
});
const queue = new Queue(RESEARCH_QUEUE, { connection: redis });
const prefix = `scoring-smoke-${randomUUID()}`;
const users: string[] = [];
let runId = '';
let assessmentId = '';
const password = randomUUID() + 'aA1!';
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
    signal: AbortSignal.timeout(15000),
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
  return response.json() as Promise<T>;
}
try {
  const cookies: Record<string, string> = {};
  for (const role of ['operator', 'viewer'] as const) {
    const user = await provisionMember(db, {
      name: `${prefix}-${role}`,
      email: `${prefix}-${role}@example.com`,
      password,
      productIds: ['MagicTattoo', 'MagicLight'],
      role,
    });
    assert.ok(user);
    users.push(user.id);
    const response = await signInWithRetry(() =>
      request('/auth/sign-in/email', '', 'POST', {
        email: user.email,
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
  const [original] = await db
    .select()
    .from(growth.intelligenceCandidates)
    .where(
      eq(
        growth.intelligenceCandidates.runId,
        '9ceaecf6-ed8f-4526-a8c8-c227fbc12565',
      ),
    )
    .limit(1);
  assert.ok(
    original,
    'A retained real research candidate is required; the test only copies it',
  );
  const [run] = await db
    .insert(growth.researchRuns)
    .values({
      product: 'MagicTattoo',
      goal: prefix,
      createdBy: users[0],
      status: 'succeeded',
      result: 'Copied real candidate for scoring test',
    })
    .returning();
  runId = run!.id;
  const [stage] = await db
    .insert(growth.researchExtractions)
    .values({
      runId,
      createdBy: users[0]!,
      workflowVersion: 'research-to-intelligence/v2',
      status: 'succeeded',
    })
    .returning();
  const [candidate] = await db
    .insert(growth.intelligenceCandidates)
    .values({
      runId,
      extractionId: stage!.id,
      position: 0,
      payload: original.payload,
    })
    .returning();
  const path = `/scoring/candidate/${candidate!.id}`;
  assert.equal((await request(path, '', 'POST', {})).status, 401);
  assert.equal((await request(path, cookies.viewer, 'POST', {})).status, 403);
  assert.equal(
    (
      await request(path, cookies.operator, 'POST', {
        context: { preparationDays: -1 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/scoring/candidate/${randomUUID()}`,
        cookies.operator,
        'POST',
        {},
      )
    ).status,
    404,
  );
  const [first, second] = await Promise.all([
    json<{ id: string }>(path, cookies.operator!, 'POST', {}),
    json<{ id: string }>(path, cookies.operator!, 'POST', {}),
  ]);
  assert.equal(
    first.id,
    second.id,
    'Concurrent requests must share one assessment',
  );
  assessmentId = first.id;
  console.log(
    'Queued real scoring through API; concurrent requests deduplicated.',
  );
  let assessed: Candidate | undefined;
  const deadline = Date.now() + 420000;
  while (Date.now() < deadline) {
    const rows = await json<Candidate[]>(
      `/candidates?runId=${runId}`,
      cookies.operator!,
    );
    assessed = rows[0];
    if (assessed?.scoring?.status === 'failed')
      throw new Error(assessed.scoring.error ?? 'Scoring failed');
    if (assessed?.scoring?.status === 'succeeded') break;
    await delay(1000);
  }
  assert.equal(assessed?.scoring?.status, 'succeeded');
  const scoring = assessed.scoring;
  assert.ok(scoring.proposal);
  assert.equal(scoring.stale, false);
  assert.equal(
    scoring.proposal.dimensions.timing.value,
    null,
    'Missing preparation cycle must remain unknown',
  );
  assert.ok(
    scoring.proposal.evidenceGrade !== 'U' || !!scoring.proposal.evidenceReason,
  );
  assert.deepEqual(
    scoring.calculation,
    calculateScore(scoring.proposal.dimensions),
  );
  assert.equal(scoring.calculation?.total, null);
  const reuse = await json<{ id: string }>(path, cookies.operator!, 'POST', {
    context: scoreContext.parse({}),
  });
  assert.equal(reuse.id, assessmentId);
  await json(`/candidates/${candidate!.id}`, cookies.operator!, 'PATCH', {
    revision: 0,
    candidate: {
      ...original.payload,
      title: `${original.payload.title}（自测修改）`,
    },
  });
  const edited = await json<Candidate[]>(
    `/candidates?runId=${runId}`,
    cookies.operator!,
  );
  assert.equal(
    edited[0]?.scoring?.stale,
    true,
    'Editing candidate must invalidate previous score',
  );
  assert.equal(
    edited[0]?.status,
    'pending',
    'Scoring must never approve a candidate',
  );
  const [stored] = await db
    .select()
    .from(growth.opportunityAssessments)
    .where(eq(growth.opportunityAssessments.id, assessmentId));
  console.log(
    JSON.stringify({
      result: 'PASS',
      assessmentId,
      attempts: stored!.attempts,
      coverage: scoring.calculation?.coverage,
      dimensions: Object.fromEntries(
        Object.entries(scoring.proposal.dimensions).map(([k, v]) => [
          k,
          v.value,
        ]),
      ),
      checks: [
        'real API to Worker to model to UI transport',
        'no invented total',
        'concurrent and repeated idempotency',
        'RBAC and validation',
        'edit makes score stale',
        'review status unchanged',
      ],
    }),
  );
} finally {
  let active = false;
  if (assessmentId) {
    const [row] = await db
      .select()
      .from(growth.opportunityAssessments)
      .where(eq(growth.opportunityAssessments.id, assessmentId));
    if (row) {
      const job = await queue.getJob(`score-${row.id}-${row.generation}`);
      if (job) {
        if ((await job.getState()) === 'active') active = true;
        else await job.remove();
      }
    }
  }
  if (!active) {
    if (runId)
      await db
        .delete(growth.researchRuns)
        .where(eq(growth.researchRuns.id, runId));
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
    console.log(
      'CLEANUP: temporary assessment, candidate, research and members removed',
    );
  } else console.log('CLEANUP: active test run retained for diagnosis');
  await queue.close();
  redis.disconnect();
  await pool.end();
}
