import { waitForScoring } from './wait-for-scoring.js';
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
  type ResearchSchedule,
} from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { env } from '../config/env.js';
import { signInWithRetry } from './sign-in-retry.js';

// Opt-in local test: one real scheduled research and its extraction incur model costs.
assert.notEqual(process.env.NODE_ENV, 'production');
assert.equal(
  process.env.SCHEDULE_REAL_MODEL,
  '1',
  'Use SCHEDULE_REAL_MODEL=1 for this paid local integration test',
);
const { db, pool } = createDatabase(env.DATABASE_URL);
const redis = new Redis({
  ...redisConnection(env.REDIS_URL),
  maxRetriesPerRequest: 1,
});
const queue = new Queue(RESEARCH_QUEUE, { connection: redis });
const base = `http://127.0.0.1:${env.API_PORT}/api`;
const prefix = `schedule-smoke-${randomUUID()}`;
const password = randomUUID() + 'aA1!';
const users: string[] = [];
const schedules: string[] = [];
const extraJobs: string[] = [];
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
    signal: AbortSignal.timeout(15_000),
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
async function login(email: string) {
  const response = await signInWithRetry(() =>
    request('/auth/sign-in/email', '', 'POST', { email, password }),
  );
  assert.equal(response.status, 200);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
async function waitFor<T>(
  label: string,
  timeout: number,
  read: () => Promise<T>,
  done: (value: T) => boolean,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (done(value)) return value;
    await delay(750);
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  assert.equal((await request('/schedules')).status, 401);
  const cookies: Record<string, string> = {};
  const emails: Record<string, string> = {};
  for (const key of ['owner', 'other', 'viewer'] as const) {
    const member = await provisionMember(db, {
      name: `${prefix}-${key}`,
      email: `${prefix}-${key}@example.com`,
      password,
      productIds: ['MagicTattoo', 'MagicLight'],
      role: key === 'viewer' ? 'viewer' : 'operator',
    });
    assert.ok(member);
    users.push(member.id);
    emails[key] = member.email;
    cookies[key] = await login(member.email);
  }
  const integration = await json<{
    agentConfigured: boolean;
    queueAvailable: boolean;
  }>('/integrations', cookies.owner!);
  assert.ok(integration.agentConfigured && integration.queueAvailable);
  const target = new Date(Math.ceil((Date.now() + 45_000) / 60_000) * 60_000);
  const timezone = 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(target);
  const hour = Number(parts.find((part) => part.type === 'hour')!.value);
  const minute = Number(parts.find((part) => part.type === 'minute')!.value);
  const input = {
    product: 'MagicTattoo',
    goal: `${prefix} 定时研究自测：实际搜索 AI SDK 官方网站，用中文一句话说明它是什么，附一个官方来源链接。报告不超过100字，不需要延伸研究。`,
    hour,
    minute,
    timezone,
  };
  assert.equal(
    (await request('/schedules', cookies.viewer, 'POST', input)).status,
    403,
  );
  assert.equal(
    (
      await request('/schedules', cookies.owner, 'POST', {
        ...input,
        timezone: 'Invalid/Timezone',
      })
    ).status,
    400,
  );
  assert.equal(
    (await request('/schedules', cookies.owner, 'POST', { ...input, hour: 24 }))
      .status,
    400,
  );
  const schedule = await json<ResearchSchedule>(
    '/schedules',
    cookies.owner!,
    'POST',
    input,
  );
  schedules.push(schedule.id);
  assert.equal(
    (
      await request(`/schedules/${schedule.id}`, cookies.other, 'PATCH', {
        enabled: false,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/schedules/${schedule.id}`, cookies.viewer, 'PATCH', {
        enabled: false,
      })
    ).status,
    403,
  );
  const scheduler = await waitFor(
    'scheduler registration',
    25_000,
    () => queue.getJobScheduler(schedule.id),
    Boolean,
  );
  assert.ok(scheduler);
  assert.equal(scheduler.tz, timezone);
  assert.equal(scheduler.pattern, `${minute} ${hour} * * *`);
  assert.equal(
    scheduler.next,
    target.getTime(),
    'Cron must use the supplied timezone and next minute, not run immediately',
  );
  assert.equal(
    (
      await db
        .select()
        .from(growth.researchRuns)
        .where(eq(growth.researchRuns.createdBy, users[0]!))
    ).length,
    0,
  );
  assert.equal(
    (await request('/auth/sign-out', cookies.owner, 'POST', {})).status,
    200,
  );
  assert.equal((await request('/me', cookies.owner)).status, 401);
  console.log(
    JSON.stringify({
      step: 'registered; owner signed out; no browser or SSE',
      timezone,
      hour,
      minute,
      expectedAt: target.toISOString(),
    }),
  );
  const run = await waitFor(
    'clock-triggered research',
    target.getTime() - Date.now() + 35_000,
    async () => {
      const rows = await db
        .select()
        .from(growth.researchRuns)
        .where(eq(growth.researchRuns.createdBy, users[0]!));
      assert.ok(
        rows.length <= 1,
        'One firing must not create duplicate research rows',
      );
      return rows[0];
    },
    Boolean,
  );
  assert.ok(run?.queueJobId);
  assert.ok(run.queueJobId.startsWith(`repeat:${schedule.id}:`));
  assert.ok(run.createdAt.getTime() >= target.getTime(), 'No early firing');
  assert.ok(
    run.createdAt.getTime() < target.getTime() + 35_000,
    'Trigger must arrive promptly',
  );
  console.log(
    JSON.stringify({
      step: 'clock fired while signed out',
      scheduledAt: target.toISOString(),
      actualAt: run.createdAt.toISOString(),
      delayMs: run.createdAt.getTime() - target.getTime(),
    }),
  );
  // Stopping a plan removes the next occurrence while an already running job continues.
  const cookie = await login(emails.owner!);
  await json(`/schedules/${schedule.id}`, cookie, 'PATCH', { enabled: false });
  await waitFor(
    'disabled scheduler removal',
    25_000,
    () => queue.getJobScheduler(schedule.id),
    (value) => !value,
  );
  const report = await waitFor(
    'research completion',
    420_000,
    async () => {
      const [row] = await db
        .select()
        .from(growth.researchRuns)
        .where(eq(growth.researchRuns.id, run.id));
      return row;
    },
    (value) => !!value && ['succeeded', 'failed'].includes(value.status),
  );
  assert.equal(
    report?.status,
    'succeeded',
    report?.error ?? 'No research result',
  );
  assert.ok(report.result);
  const stage = await waitFor(
    'automatic extraction completion',
    420_000,
    async () => {
      const [row] = await db
        .select()
        .from(growth.researchExtractions)
        .where(eq(growth.researchExtractions.runId, run.id));
      return row;
    },
    (value) => !!value && ['succeeded', 'failed'].includes(value.status),
  );
  assert.equal(
    stage?.status,
    'succeeded',
    stage?.error ?? 'No extraction result',
  );
  const candidates = await db
    .select()
    .from(growth.intelligenceCandidates)
    .where(eq(growth.intelligenceCandidates.runId, run.id));
  assert.ok(candidates.length > 0);
  assert.ok(
    candidates.every(
      (row) =>
        row.status === 'pending' && Array.isArray(row.payload.sourceTimes),
    ),
  );
  console.log(
    JSON.stringify({
      step: 'report and candidates completed after plan stopped',
      researchAttempts: report.attempts,
      extractionAttempts: stage.attempts,
      workflowVersion: stage.workflowVersion,
      candidates: candidates.length,
    }),
  );
  // Re-enabling returns the same plan to the next daily occurrence.
  await json(`/schedules/${schedule.id}`, cookie, 'PATCH', { enabled: true });
  const resumed = await waitFor(
    'resumed scheduler',
    25_000,
    () => queue.getJobScheduler(schedule.id),
    Boolean,
  );
  assert.ok(resumed?.next);
  // A local day may be 23 or 25 hours across daylight saving transitions.
  const nextDay = new Date(target);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  assert.equal(
    localDate.format(new Date(resumed.next)),
    localDate.format(nextDay),
  );
  assert.equal(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(resumed.next)),
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(target),
  );
  await json(`/schedules/${schedule.id}`, cookie, 'PATCH', { enabled: false });
  await waitFor(
    'stopped scheduler',
    25_000,
    () => queue.getJobScheduler(schedule.id),
    (value) => !value,
  );
  async function skippedJob(label: string) {
    const jobId = `${prefix}-${label}`;
    extraJobs.push(jobId);
    const job = await queue.add(
      'scheduled-research',
      { scheduleId: schedule.id },
      { jobId },
    );
    await waitFor(
      label,
      20_000,
      () => job.getState(),
      (value) => value === 'completed' || value === 'failed',
    );
    assert.equal(await job.getState(), 'completed');
    const rows = await db
      .select()
      .from(growth.researchRuns)
      .where(eq(growth.researchRuns.createdBy, users[0]!));
    assert.equal(
      rows.length,
      1,
      'An ineligible scheduled job must not start research',
    );
  }
  await skippedJob('disabled-plan');
  await db
    .update(growth.researchSchedules)
    .set({ enabled: true })
    .where(eq(growth.researchSchedules.id, schedule.id));
  await db
    .update(auth.user)
    .set({ disabled: true })
    .where(eq(auth.user.id, users[0]!));
  await skippedJob('disabled-owner');
  await db
    .update(auth.user)
    .set({ disabled: false, role: 'viewer' })
    .where(eq(auth.user.id, users[0]!));
  await skippedJob('viewer-owner');
  console.log(
    'PASS: real clock trigger, timezone, no early or duplicate run, signed-out execution, research and extraction, disable/removal, re-enable, stale-job/disabled-owner/role guards, RBAC and validation',
  );
} finally {
  // Remove only this test's schedules. Leave live work intact if interrupted.
  if (schedules.length) {
    await db
      .update(growth.researchSchedules)
      .set({ enabled: false })
      .where(inArray(growth.researchSchedules.id, schedules));
    for (const id of schedules) await queue.removeJobScheduler(id);
    await db
      .delete(growth.researchSchedules)
      .where(inArray(growth.researchSchedules.id, schedules));
  }
  if (users.length) {
    const runs = await db
      .select()
      .from(growth.researchRuns)
      .where(inArray(growth.researchRuns.createdBy, users));
    const stages = runs.length
      ? await db
          .select()
          .from(growth.researchExtractions)
          .where(
            inArray(
              growth.researchExtractions.runId,
              runs.map((row) => row.id),
            ),
          )
      : [];
    const ids = [
      ...extraJobs,
      ...runs.map((row) => row.queueJobId).filter((id): id is string => !!id),
      ...stages.map((row) => `extract-${row.id}-${row.generation}`),
    ];
    const scoringSettled = await waitForScoring(db, users);
    let active =
      !scoringSettled ||
      runs.some((row) => ['queued', 'running'].includes(row.status)) ||
      stages.some((row) => ['queued', 'running'].includes(row.status));
    for (const id of ids) {
      const job = await queue.getJob(id);
      if (job) {
        if ((await job.getState()) === 'active') active = true;
        else await job.remove();
      }
    }
    if (!active) {
      if (runs.length)
        await db.delete(growth.researchRuns).where(
          inArray(
            growth.researchRuns.id,
            runs.map((row) => row.id),
          ),
        );
      await db
        .delete(growth.auditLog)
        .where(
          or(
            inArray(growth.auditLog.actorId, users),
            inArray(growth.auditLog.objectId, users),
          ),
        );
      await db.delete(auth.user).where(inArray(auth.user.id, users));
      console.log(
        'CLEANUP: temporary schedules, jobs, reports, candidates and members removed',
      );
    } else
      console.log(
        'CLEANUP: schedules removed; active runs and members retained for diagnosis',
      );
  }
  await queue.close();
  redis.disconnect();
  await pool.end();
}
