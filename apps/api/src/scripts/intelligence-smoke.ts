import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import { auth, createDatabase, growth } from '@guangmo/database';
import type { IntelligenceListItem } from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { signInWithRetry } from './sign-in-retry.js';
import { env } from '../config/env.js';

assert.notEqual(process.env.NODE_ENV, 'production');
const { db, pool } = createDatabase(env.DATABASE_URL);
const prefix = `list-${randomUUID()}`;
const users: string[] = [];
const items: string[] = [];
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
  const response = await request(path, cookie, method, body);
  assert.ok(
    response.ok,
    `${path}: ${response.status} ${await response.clone().text()}`,
  );
  return response.json() as Promise<T>;
}
try {
  const cookies: string[] = [];
  for (const role of ['operator', 'operator', 'viewer'] as const) {
    const member = await provisionMember(db, {
      name: `${prefix}-${users.length}`,
      email: `${prefix}-${users.length}@example.com`,
      password,
      productIds: ['MagicTattoo', 'MagicLight'],
      role,
    });
    assert.ok(member);
    users.push(member.id);
    const login = await signInWithRetry(() =>
      request('/auth/sign-in/email', '', 'POST', {
        email: member.email,
        password,
        productIds: ['MagicTattoo', 'MagicLight'],
      }),
    );
    assert.equal(login.status, 200);
    cookies.push(
      login.headers
        .getSetCookie()
        .map((v) => v.split(';')[0])
        .join('; '),
    );
  }
  const operator = cookies[0]!;
  const viewer = cookies[2]!;
  const now = Date.now();
  for (const [product, market, age] of [
    ['MagicTattoo', 'US', 1],
    ['MagicTattoo', 'UK', 1],
    ['MagicLight', 'US', 1],
    ['MagicTattoo', 'US', 8],
    ['MagicTattoo', 'US', -1],
  ] as const) {
    const [item] = await db
      .insert(growth.intelligence)
      .values({
        title: `${prefix}-${items.length}`,
        summary: 'Temporary list and ownership verification.',
        sourceUrl: `https://example.com/${prefix}/${items.length}`,
        canonicalUrl: `https://example.com/${prefix}/${items.length}`,
        product,
        market,
        category: 'industry',
        createdBy: users[0],
        createdAt: new Date(now - age * 86400000),
      })
      .returning();
    assert.ok(item);
    items.push(item.id);
  }
  const list = (query: string) =>
    json<IntelligenceListItem[]>(
      `/intelligence?search=${prefix}&${query}`,
      viewer,
    );
  assert.equal((await request('/intelligence')).status, 401);
  for (const query of [
    'range=invalid',
    'market=CN',
    'product=invalid%20product',
    'range=7d&range=30d',
  ])
    assert.equal((await request(`/intelligence?${query}`, viewer)).status, 400);
  assert.deepEqual(
    (await list('product=MagicTattoo&market=US&range=7d')).map((v) => v.id),
    [items[0]],
  );
  assert.equal((await list('range=30d')).length, 4);
  assert.equal((await list('range=all')).length, 5);
  assert.equal((await list('owner=unassigned')).length, 5);
  const path = `/intelligence/${items[0]}/owner`;
  const body = { ownerId: users[0], revision: 0 };
  assert.equal((await request(path, '', 'PATCH', body)).status, 401);
  assert.equal((await request(path, viewer, 'PATCH', body)).status, 403);
  assert.equal(
    (await request(path, operator, 'PATCH', { ...body, revision: -1 })).status,
    400,
  );
  for (const ownerId of [users[2], randomUUID()])
    assert.equal(
      (await request(path, operator, 'PATCH', { ...body, ownerId })).status,
      409,
    );
  await db
    .update(auth.user)
    .set({ disabled: true })
    .where(eq(auth.user.id, users[1]!));
  assert.equal(
    (await request(path, operator, 'PATCH', { ...body, ownerId: users[1] }))
      .status,
    409,
  );
  const eligible = await json<{ id: string }[]>(
    '/intelligence/assignees',
    viewer,
  );
  assert.ok(eligible.some((v) => v.id === users[0]));
  assert.ok(!eligible.some((v) => v.id === users[1] || v.id === users[2]));
  await db
    .update(auth.user)
    .set({ disabled: false })
    .where(eq(auth.user.id, users[1]!));
  const race = await Promise.all(
    users
      .slice(0, 2)
      .map((ownerId) =>
        request(path, operator, 'PATCH', { ownerId, revision: 0 }),
      ),
  );
  assert.deepEqual(race.map((v) => v.status).sort(), [200, 409]);
  let detail = await json<IntelligenceListItem>(
    `/intelligence/${items[0]}`,
    viewer,
  );
  assert.equal(detail.ownerRevision, 1);
  assert.ok(detail.owner);
  assert.equal((await list(`owner=${detail.ownerId}`)).length, 1);
  const byName = await json<IntelligenceListItem[]>(
    `/intelligence?search=${encodeURIComponent(detail.owner.name)}`,
    viewer,
  );
  assert.ok(byName.some((v) => v.id === items[0]));
  await db.insert(growth.workflowTasks).values({
    intelligenceId: items[0]!,
    title: `${prefix} task`,
    kind: 'content',
    channel: 'TikTok',
    assigneeId: users[1]!,
    createdBy: users[0]!,
    product: 'MagicTattoo',
    market: 'US',
    priority: 'normal',
    status: 'completed',
    result: 'Verified execution result.',
  });
  detail = await json<IntelligenceListItem>(path, operator, 'PATCH', {
    ownerId: users[0],
    revision: 1,
  });
  const listed = (await list(`owner=${users[0]}`))[0]!;
  assert.equal(listed.taskSummary[0]!.channel, 'TikTok');
  assert.equal(listed.taskSummary[0]!.status, 'completed');
  assert.equal(listed.taskSummary[0]!.result, 'Verified execution result.');
  assert.equal(listed.taskSummary[0]!.assigneeName, `${prefix}-1`);
  assert.equal(detail.taskSummary[0]!.assigneeName, `${prefix}-1`);
  const revision = detail.ownerRevision;
  detail = await json<IntelligenceListItem>(path, operator, 'PATCH', {
    ownerId: null,
    revision,
  });
  assert.equal(detail.owner, null);
  assert.equal(detail.ownerRevision, revision + 1);
  assert.equal(
    (await request(path, operator, 'PATCH', { ownerId: users[0], revision }))
      .status,
    409,
  );
  const audit = await db
    .select()
    .from(growth.auditLog)
    .where(eq(growth.auditLog.objectId, items[0]!));
  assert.equal(
    audit.filter((v) => v.action === 'intelligence.owner').length,
    detail.ownerRevision,
  );
  console.log(
    'PASS: product/market/time intersection, future exclusion, owner search/filter, RBAC, unavailable members, concurrent revisions, unassignment, independent task ownership, task summaries and audit.',
  );
} finally {
  if (items.length) {
    await db
      .delete(growth.workflowTasks)
      .where(inArray(growth.workflowTasks.intelligenceId, items));
    await db
      .delete(growth.intelligence)
      .where(inArray(growth.intelligence.id, items));
  }
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
  await pool.end();
}
