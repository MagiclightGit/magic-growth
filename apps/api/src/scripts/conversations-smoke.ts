import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { eq, inArray, or } from 'drizzle-orm';
import {
  auth,
  catalog,
  createDatabase,
  growth,
  competitorResearch as c,
  researchConversations as r,
} from '@guangmo/database';
import {
  RESEARCH_QUEUE,
  type ConversationDetail,
  type ResearchConversation,
  type SharedResearchSupplement,
} from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { signInWithRetry } from './sign-in-retry.js';
import { env } from '../config/env.js';
assert.notEqual(process.env.NODE_ENV, 'production');
assert.ok(
  ['localhost', '127.0.0.1'].includes(new URL(env.DATABASE_URL).hostname),
  'Only run against local test database',
);
const { db, pool } = createDatabase(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(RESEARCH_QUEUE, { connection: redis });
const prefix = `conversation-${randomUUID()}`;
const product = prefix;
const users: string[] = [];
const conversations: string[] = [];
const turns: string[] = [];
const sourceIds: string[] = [];
const profileIds: string[] = [];
let pausedByTest = false;
let workerChecked = false;
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
  });
}
async function json<T>(
  path: string,
  cookie: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const res = await request(path, cookie, method, body);
  assert.ok(
    res.ok,
    `${method} ${path}: ${res.status} ${await res.clone().text()}`,
  );
  return res.json() as Promise<T>;
}
async function detail(id: string, cookie: string) {
  return json<ConversationDetail>(`/research-conversations/${id}`, cookie);
}
try {
  const cookies: string[] = [];
  for (const role of ['admin', 'operator', 'operator', 'viewer'] as const) {
    const member = await provisionMember(db, {
      name: `${prefix}-${users.length}`,
      email: `${prefix}-${users.length}@example.com`,
      password,
      role,
    });
    assert.ok(member);
    users.push(member.id);
    const res = await signInWithRetry(() =>
      request('/auth/sign-in/email', '', 'POST', {
        email: member.email,
        password,
      }),
    );
    assert.equal(res.status, 200);
    cookies.push(
      res.headers
        .getSetCookie()
        .map((v) => v.split(';')[0])
        .join('; '),
    );
  }
  const [admin, a, b, viewer] = cookies as [string, string, string, string];
  await json('/products', admin, 'POST', {
    id: product,
    name: 'Temporary conversation tests',
  });
  for (const owner of users.slice(1))
    await json(`/members/${owner}/products`, admin, 'PATCH', {
      revision: 0,
      productIds: [product],
    });
  const [report] = await db
    .insert(growth.researchRuns)
    .values({
      goal: 'Synthetic source for isolation tests, not business findings.',
      product,
      createdBy: users[0]!,
      status: 'succeeded',
      result: 'Synthetic immutable report baseline.',
      completedAt: new Date(),
    })
    .returning();
  sourceIds.push(report!.id);
  const source = { sourceKind: 'research', sourceId: report!.id };
  const query = new URLSearchParams(source).toString();
  assert.equal((await request(`/research-conversations?${query}`)).status, 401);
  assert.equal(
    (
      await request('/research-conversations', viewer, 'POST', {
        ...source,
        requestId: randomUUID(),
      })
    ).status,
    403,
  );
  const createId = randomUUID();
  const ca = await json<{ id: string }>('/research-conversations', a, 'POST', {
    ...source,
    requestId: createId,
  });
  conversations.push(ca.id);
  assert.equal(
    (
      await json<{ id: string }>('/research-conversations', a, 'POST', {
        ...source,
        requestId: createId,
      })
    ).id,
    ca.id,
  );
  const cb = await json<{ id: string }>('/research-conversations', b, 'POST', {
    ...source,
    requestId: randomUUID(),
  });
  conversations.push(cb.id);
  assert.notEqual(ca.id, cb.id);
  assert.equal(
    (await request(`/research-conversations/${ca.id}`, b)).status,
    404,
  );
  assert.equal(
    (await request(`/research-conversations/${ca.id}`, admin)).status,
    404,
  );
  assert.deepEqual(
    (
      await json<ResearchConversation[]>(`/research-conversations?${query}`, b)
    ).map((x) => x.id),
    [cb.id],
  );
  await db
    .update(growth.researchRuns)
    .set({ result: 'Changed shared report after conversation creation.' })
    .where(eq(growth.researchRuns.id, report!.id));
  assert.equal(
    (await detail(ca.id, a)).context.report,
    'Synthetic immutable report baseline.',
  );
  // Pause the local queue only around synthetic enqueue checks; restore its prior state in finally.
  if (!(await queue.isPaused())) {
    await queue.pause();
    pausedByTest = true;
  }
  const body = {
    requestId: randomUUID(),
    text: 'A private question: secret-alpha',
    mode: 'discuss',
  };
  const sent = await Promise.all([
    json<{ id: string }>(
      `/research-conversations/${ca.id}/messages`,
      a,
      'POST',
      body,
    ),
    json<{ id: string }>(
      `/research-conversations/${ca.id}/messages`,
      a,
      'POST',
      body,
    ),
  ]);
  assert.equal(sent[0]!.id, sent[1]!.id);
  turns.push(sent[0]!.id);
  assert.equal(
    (
      await request(`/research-conversations/${ca.id}/messages`, a, 'POST', {
        ...body,
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/research-conversations/${ca.id}/messages`,
        b,
        'POST',
        body,
      )
    ).status,
    404,
  );
  const bt = await json<{ id: string }>(
    `/research-conversations/${cb.id}/messages`,
    b,
    'POST',
    {
      ...body,
      requestId: randomUUID(),
      text: 'B private question: secret-beta',
    },
  );
  turns.push(bt.id);
  assert.equal(
    (await detail(cb.id, b)).turns[0]?.question,
    'B private question: secret-beta',
  );
  assert.ok(!JSON.stringify(await detail(cb.id, b)).includes('secret-alpha'));
  assert.equal(
    (
      await request(
        `/research-conversations/${ca.id}/messages/${bt.id}/share`,
        a,
        'POST',
        {},
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/research-conversations/${ca.id}/messages/${sent[0]!.id}/share`,
        a,
        'POST',
        {},
      )
    ).status,
    409,
  );
  await db
    .update(r.conversationTurns)
    .set({
      status: 'succeeded',
      answer: 'Synthetic shared answer from alpha only.',
      completedAt: new Date(),
    })
    .where(eq(r.conversationTurns.id, sent[0]!.id));
  await db.insert(r.conversationEvents).values({
    turnId: sent[0]!.id,
    message: 'Private event alpha',
    data: { kind: 'source', url: 'https://example.com/alpha' },
  });
  await db
    .update(r.conversationTurns)
    .set({
      status: 'succeeded',
      answer: 'Private beta answer, never shared.',
      completedAt: new Date(),
    })
    .where(eq(r.conversationTurns.id, bt.id));
  const sharePath = `/research-conversations/${ca.id}/messages/${sent[0]!.id}/share`;
  assert.equal((await request(sharePath, admin, 'POST', {})).status, 404);
  const shares = await Promise.all([
    json<{ id: string }>(sharePath, a, 'POST', {}),
    json<{ id: string }>(sharePath, a, 'POST', {}),
  ]);
  assert.equal(shares[0]!.id, shares[1]!.id);
  const team = await json<SharedResearchSupplement[]>(
    `/research-conversations/shared?${query}`,
    viewer,
  );
  assert.equal(team.length, 1);
  assert.equal(team[0]?.answer, 'Synthetic shared answer from alpha only.');
  assert.ok(!JSON.stringify(team).includes('secret-beta'));
  assert.ok(!JSON.stringify(team).includes('conversationId'));
  assert.ok(!JSON.stringify(team).includes('turnId'));
  assert.equal(
    (await request(`/research-conversations/${ca.id}`, b)).status,
    404,
  );
  const next = await json<{ id: string }>(
    `/research-conversations/${ca.id}/messages`,
    a,
    'POST',
    { ...body, requestId: randomUUID(), text: 'Second alpha question' },
  );
  turns.push(next.id);
  await db
    .update(r.conversationTurns)
    .set({ status: 'failed', error: 'Synthetic retry case' })
    .where(eq(r.conversationTurns.id, next.id));
  const retried = await Promise.all([
    request(
      `/research-conversations/${ca.id}/messages/${next.id}/retry`,
      a,
      'POST',
      {},
    ),
    request(
      `/research-conversations/${ca.id}/messages/${next.id}/retry`,
      a,
      'POST',
      {},
    ),
  ]);
  assert.deepEqual(retried.map((x) => x.status).sort(), [201, 409]);
  assert.equal((await detail(ca.id, a)).turns[1]?.generation, 1);
  await db
    .update(r.conversationTurns)
    .set({ status: 'succeeded', answer: 'Synthetic completed retry.' })
    .where(eq(r.conversationTurns.id, next.id));
  // Competitor reports use the same private workflow and pin the selected batch.
  const [profile] = await db
    .insert(c.competitorProfiles)
    .values({
      product,
      name: 'Synthetic competitor',
      website: 'https://example.com',
      canonicalUrl: 'https://example.com',
      market: 'US',
      createdBy: users[0]!,
      enabled: false,
    })
    .returning();
  profileIds.push(profile!.id);
  const [competitorRun] = await db
    .insert(c.competitorResearchRuns)
    .values({
      competitorId: profile!.id,
      createdBy: users[0]!,
      status: 'succeeded',
      report: 'Synthetic competitor baseline.',
      completedAt: new Date(),
      config: {
        product,
        name: 'Synthetic competitor',
        website: 'https://example.com',
        market: 'US',
        focus: '',
        sources: [],
        enabled: false,
        intervalHours: 24,
      },
    })
    .returning();
  const cc = await json<{ id: string }>('/research-conversations', a, 'POST', {
    sourceKind: 'competitor',
    sourceId: competitorRun!.id,
    requestId: randomUUID(),
  });
  conversations.push(cc.id);
  assert.equal(
    (await detail(cc.id, a)).context.report,
    'Synthetic competitor baseline.',
  );
  // Archive is read-only. Revocation hides private history and team supplements immediately.
  await json(`/products/${product}`, admin, 'PATCH', { archived: true });
  assert.equal(
    (
      await request(`/research-conversations/${ca.id}/messages`, a, 'POST', {
        ...body,
        requestId: randomUUID(),
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(`/research-conversations/${ca.id}`, a)).status,
    200,
  );
  await json(`/products/${product}`, admin, 'PATCH', { archived: false });
  const grant = (
    await db.select().from(auth.user).where(eq(auth.user.id, users[1]!))
  )[0]!;
  await json(`/members/${users[1]}/products`, admin, 'PATCH', {
    revision: grant.productRevision,
    productIds: [],
  });
  assert.equal(
    (await request(`/research-conversations/${ca.id}`, a)).status,
    403,
  );
  assert.equal(
    (await request(`/research-conversations/shared?${query}`, a)).status,
    403,
  );
  assert.equal((await request(sharePath, a, 'POST', {})).status, 403);
  // A revoked owner's queued turn must fail in the real Worker before any model call.
  const [revoked] = await db
    .insert(r.conversationTurns)
    .values({
      conversationId: cc.id,
      requestId: randomUUID(),
      sequence: 1,
      question: 'Synthetic revoked owner check',
      mode: 'discuss',
    })
    .returning();
  turns.push(revoked!.id);
  if (pausedByTest) {
    await queue.resume();
    pausedByTest = false;
    const deadline = Date.now() + 60000;
    let status = 'queued';
    while (Date.now() < deadline) {
      const [t] = await db
        .select()
        .from(r.conversationTurns)
        .where(eq(r.conversationTurns.id, revoked!.id));
      status = t!.status;
      if (status === 'failed') {
        assert.equal(t!.attempts, 2);
        assert.equal(t!.answer, null);
        assert.match(t!.error ?? '', /失权/);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(
      status,
      'failed',
      'Worker must reject revoked owner without model execution',
    );
    workerChecked = true;
  }
  console.log(
    'PASS: per-owner conversations including admin isolation; pinned research/competitor report; concurrent message idempotency and sequencing; private events/history; explicit share snapshot without thread access; retry generation; viewer RBAC; archive/revocation; no paid calls.',
  );
  console.log(
    workerChecked
      ? 'PASS: real Worker rejects revoked owner before model execution.'
      : 'SKIP: Worker execution check because the queue was already paused.',
  );
} finally {
  try {
    for (const id of turns)
      for (const generation of [0, 1]) {
        const job = await queue.getJob(`conversation-${id}-${generation}`);
        if (job) await job.remove().catch(() => {});
      }
    if (conversations.length) {
      const allTurns = await db
        .select({ id: r.conversationTurns.id })
        .from(r.conversationTurns)
        .where(inArray(r.conversationTurns.conversationId, conversations));
      if (allTurns.length)
        await db.delete(r.sharedSupplements).where(
          inArray(
            r.sharedSupplements.turnId,
            allTurns.map((t) => t.id),
          ),
        );
      await db
        .delete(r.conversations)
        .where(inArray(r.conversations.id, conversations));
    }
    if (profileIds.length)
      await db
        .delete(c.competitorProfiles)
        .where(inArray(c.competitorProfiles.id, profileIds));
    if (sourceIds.length)
      await db
        .delete(growth.researchRuns)
        .where(inArray(growth.researchRuns.id, sourceIds));
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
    await db.delete(catalog.products).where(eq(catalog.products.id, product));
  } finally {
    try {
      if (pausedByTest) await queue.resume();
    } finally {
      await queue.close();
      redis.disconnect();
      await pool.end();
    }
  }
}
