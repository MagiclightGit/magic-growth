import assert from 'node:assert/strict';
import { signInWithRetry } from './sign-in-retry.js';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { eq, inArray } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createDatabase, auth, growth } from '@guangmo/database';
import { RESEARCH_QUEUE, redisConnection } from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { env } from '../config/env.js';

// Explicit local integration command: requires running API, Worker and migrated DB.
// Unique temporary fixtures are removed in finally; never use production credentials.
assert.equal(
  process.env.NODE_ENV === 'production',
  false,
  'Do not run smoke tests in production',
);
const { db, pool } = createDatabase(env.DATABASE_URL);
const base = `http://127.0.0.1:${env.API_PORT}/api`;
const prefix = `smoke-${randomUUID()}`;
const password = randomUUID() + 'aA1!';
const users: string[] = [];
let queueRunId: string | undefined;
const redis = new Redis({
  ...redisConnection(env.REDIS_URL),
  maxRetriesPerRequest: 1,
});
redis.on('error', () => {});
const queue = new Queue(RESEARCH_QUEUE, { connection: redis });
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
async function signIn(email: string) {
  const response = await signInWithRetry(() =>
    request('/auth/sign-in/email', '', 'POST', { email, password }),
  );
  assert.equal(
    response.status,
    200,
    `sign-in: ${await response.clone().text()}`,
  );
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.ok(cookie);
  return cookie;
}
try {
  assert.equal((await request('/health/ready')).status, 200);
  assert.equal((await request('/intelligence')).status, 401);
  const signup = await request('/auth/sign-up/email', '', 'POST', {
    name: 'Blocked',
    email: `${prefix}-signup@example.com`,
    password,
    role: 'admin',
  });
  assert.ok(
    [400, 403, 404].includes(signup.status),
    `signup unexpectedly returned ${signup.status}`,
  );
  const first = await provisionMember(db, {
    name: 'Temporary smoke admin',
    email: `${prefix}@example.com`,
    password,
    role: 'admin',
  });
  assert.ok(first);
  users.push(first.id);
  const adminCookie = await signIn(first.email);
  assert.equal((await request('/me', adminCookie)).status, 200);
  const cookies: Record<string, string> = { admin: adminCookie };
  for (const role of ['operator', 'viewer'] as const) {
    const email = `${prefix}-${role}@example.com`;
    const response = await request('/members', adminCookie, 'POST', {
      name: `Temporary ${role}`,
      email,
      password,
      productIds: ['MagicTattoo', 'MagicLight'],
      role,
    });
    assert.equal(response.status, 201, await response.clone().text());
    const member = (await response.json()) as { id: string };
    users.push(member.id);
    cookies[role] = await signIn(email);
  }
  const duplicateMember = await request('/members', adminCookie, 'POST', {
    name: 'Duplicate',
    email: first.email.toUpperCase(),
    password,
    role: 'viewer',
  });
  assert.equal(duplicateMember.status, 409);
  assert.equal((await request('/members', cookies.operator)).status, 403);
  const input = {
    title: prefix,
    summary: 'Temporary integration fixture, removed after test.',
    sourceUrl: `https://example.com/${prefix}?utm_source=test#section`,
    category: 'industry',
    product: 'MagicTattoo',
    market: 'US',
  };
  assert.equal(
    (await request('/intelligence', cookies.viewer, 'POST', input)).status,
    403,
  );
  assert.equal(
    (
      await request('/intelligence', cookies.operator, 'POST', {
        ...input,
        sourceUrl: 'javascript:alert(1)',
      })
    ).status,
    400,
  );
  const created = await request(
    '/intelligence',
    cookies.operator,
    'POST',
    input,
  );
  assert.equal(created.status, 201, await created.clone().text());
  const item = (await created.json()) as { id: string };
  assert.equal(
    (
      await request('/intelligence', cookies.operator, 'POST', {
        ...input,
        sourceUrl: `https://example.com/${prefix}`,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/intelligence/${item.id}/status`,
        cookies.viewer,
        'PATCH',
        { status: 'verified' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/intelligence/${item.id}/status`,
        cookies.operator,
        'PATCH',
        { status: 'verified' },
      )
    ).status,
    200,
  );
  const visible = (await (
    await request(
      `/intelligence?search=${prefix}&status=verified`,
      cookies.viewer,
    )
  ).json()) as { id: string }[];
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.id, item.id);
  const audit = await db
    .select()
    .from(growth.auditLog)
    .where(eq(growth.auditLog.objectId, item.id));
  assert.deepEqual(audit.map((entry) => entry.action).sort(), [
    'intelligence.created',
    'intelligence.status',
  ]);
  assert.equal(
    (await request('/research/not-a-uuid', adminCookie)).status,
    400,
  );
  const integration = (await (
    await request('/integrations', adminCookie)
  ).json()) as { agentConfigured: boolean; queueAvailable: boolean };
  assert.equal(integration.queueAvailable, true);
  if (!integration.agentConfigured) {
    assert.equal(
      (
        await request('/research', adminCookie, 'POST', {
          product: 'MagicTattoo',
          goal: 'Temporary smoke research with no provider configured',
        })
      ).status,
      503,
    );
    // Exercise the durable outbox and real background retries without a paid model call.
    const [run] = await db
      .insert(growth.researchRuns)
      .values({
        product: 'MagicTattoo',
        goal: prefix,
        createdBy: first.id,
      })
      .returning();
    assert.ok(run);
    queueRunId = run.id;
    const deadline = Date.now() + 35_000;
    let failed = false;
    while (Date.now() < deadline) {
      const [current] = await db
        .select()
        .from(growth.researchRuns)
        .where(eq(growth.researchRuns.id, run.id));
      if (current?.status === 'failed') {
        assert.equal(current.attempts, 2);
        failed = true;
        break;
      }
      await setTimeout(500);
    }
    assert.ok(
      failed,
      'Worker must reconcile queued rows and persist final failure after retries',
    );
    console.log(
      'PASS: real Redis delivery, independent Worker, two attempts and persisted failure',
    );
  }
  await db
    .update(auth.user)
    .set({ disabled: true })
    .where(eq(auth.user.id, users[2]!));
  assert.equal((await request('/me', cookies.viewer)).status, 403);
  assert.equal(
    (await request('/auth/sign-out', adminCookie, 'POST', {})).status,
    200,
  );
  assert.equal((await request('/me', adminCookie)).status, 401);
  console.log(
    'PASS: authentication, closed signup, provisioning, RBAC, validation, canonical deduplication, cross-member reads, audit and sign-out',
  );
} finally {
  if (queueRunId) {
    const job = await queue.getJob(queueRunId);
    if (job) await job.remove();
  }
  if (users.length) {
    await db
      .delete(growth.runEvents)
      .where(
        inArray(
          growth.runEvents.runId,
          db
            .select({ id: growth.researchRuns.id })
            .from(growth.researchRuns)
            .where(inArray(growth.researchRuns.createdBy, users)),
        ),
      );
    await db
      .delete(growth.researchRuns)
      .where(inArray(growth.researchRuns.createdBy, users));
    await db
      .delete(growth.intelligence)
      .where(inArray(growth.intelligence.createdBy, users));
    await db
      .delete(growth.auditLog)
      .where(inArray(growth.auditLog.actorId, users));
    await db.delete(auth.user).where(inArray(auth.user.id, users));
  }
  await queue.close();
  redis.disconnect();
  await pool.end();
}
