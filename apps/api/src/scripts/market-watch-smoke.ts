import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import {
  auth,
  catalog,
  createDatabase,
  growth,
  marketWatch as m,
} from '@guangmo/database';
import type {
  Watch,
  WatchDetail,
  WatchSnapshot,
  Drama,
  WorkflowTask,
} from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { signInWithRetry } from './sign-in-retry.js';
import { env } from '../config/env.js';
assert.notEqual(process.env.NODE_ENV, 'production');
const { db, pool } = createDatabase(env.DATABASE_URL);
const prefix = `watch-${randomUUID()}`;
const products = [`${prefix}-a`, `${prefix}-b`];
const users: string[] = [];
const base = `http://127.0.0.1:${env.API_PORT}/api`;
const password = randomUUID() + 'aA1!';
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
  const r = await request(path, cookie, method, body);
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${await r.clone().text()}`);
  return r.json() as Promise<T>;
}
try {
  const cookies: string[] = [];
  for (const role of ['admin', 'operator', 'viewer'] as const) {
    const member = await provisionMember(db, {
      name: `${prefix}-${role}`,
      email: `${prefix}-${role}@example.com`,
      password,
      role,
    });
    assert.ok(member);
    users.push(member.id);
    const r = await signInWithRetry(() =>
      request('/auth/sign-in/email', '', 'POST', {
        email: member.email,
        password,
      }),
    );
    assert.equal(r.status, 200);
    cookies.push(
      r.headers
        .getSetCookie()
        .map((v) => v.split(';')[0])
        .join('; '),
    );
  }
  const [admin, operator, viewer] = cookies as [string, string, string];
  for (const id of products)
    await json('/products', admin, 'POST', { id, name: id });
  for (const id of users.slice(1))
    await json(`/members/${id}/products`, admin, 'PATCH', {
      revision: 0,
      productIds: [products[0]],
    });
  assert.equal((await request('/competitors')).status, 401);
  const input = {
    product: products[0],
    name: 'Public example verification',
    market: 'US',
    kind: 'pricing',
    url: 'https://example.com',
    intervalHours: 24,
  };
  assert.equal(
    (await request('/competitors', viewer, 'POST', input)).status,
    403,
  );
  const watch = await json<Watch>('/competitors', operator, 'POST', input);
  assert.equal(
    (await request('/competitors', operator, 'POST', input)).status,
    409,
  );
  const other = await json<Watch>('/competitors', admin, 'POST', {
    ...input,
    product: products[1],
    url: 'https://www.iana.org/help/example-domains',
  });
  assert.equal(
    (await request(`/competitors/${other.id}`, operator)).status,
    403,
  );
  const changedConfig = await json<Watch>(
    `/competitors/${watch.id}/config`,
    operator,
    'PATCH',
    { ...input, name: 'Updated monitor name', intervalHours: 12, revision: 0 },
  );
  assert.equal(changedConfig.name, 'Updated monitor name');
  assert.equal(changedConfig.intervalHours, 12);
  const scoped = await json<Watch[]>(
    `/competitors?product=${products[0]}`,
    operator,
  );
  assert.equal(scoped.length, 1);
  await json(`/competitors/${watch.id}`, operator, 'PATCH', {
    enabled: false,
    revision: 1,
  });
  assert.equal(
    (
      await request(`/competitors/${watch.id}`, operator, 'PATCH', {
        enabled: true,
        revision: 0,
      })
    ).status,
    409,
  );
  const first = await json<WatchSnapshot>(
    `/competitors/${watch.id}/snapshots`,
    operator,
    'POST',
    {
      claimType: 'fact',
      content: 'Starter price is 10 dollars\nProfessional price is 20 dollars',
      note: 'Temporary manual fixture',
    },
  );
  assert.equal(first.change, 'baseline');
  const second = await json<WatchSnapshot>(
    `/competitors/${watch.id}/snapshots`,
    operator,
    'POST',
    {
      claimType: 'fact',
      content: 'Starter price is 12 dollars\nProfessional price is 20 dollars',
    },
  );
  assert.equal(second.change, 'changed');
  assert.equal(second.previousContent, first.content);
  const third = await json<WatchSnapshot>(
    `/competitors/${watch.id}/snapshots`,
    operator,
    'POST',
    { claimType: 'fact', content: second.content },
  );
  assert.equal(third.change, 'unchanged');
  const analysis = await json<WatchSnapshot>(
    `/competitors/${watch.id}/snapshots`,
    operator,
    'POST',
    {
      claimType: 'analysis',
      content: 'Potential positioning hypothesis only, needs verification.',
    },
  );
  assert.equal(analysis.change, 'baseline');
  const published = await Promise.all(
    [1, 2].map(() =>
      json<{ id: string }>(
        `/competitors/${watch.id}/snapshots/${second.id}/publish`,
        operator,
        'POST',
        {},
      ),
    ),
  );
  assert.equal(published[0]!.id, published[1]!.id);
  const evidence = await db
    .select()
    .from(growth.intelligenceEvidence)
    .where(eq(growth.intelligenceEvidence.intelligenceId, published[0]!.id));
  assert.equal(evidence.length, 1);
  assert.match(evidence[0]!.evidence, /采集时间/);
  // Enqueue a genuine public request; leave the page closed while the Worker runs.
  const collected = await json<WatchSnapshot>(
    `/competitors/${watch.id}/collect`,
    operator,
    'POST',
    {},
  );
  let done: WatchSnapshot | undefined;
  for (let i = 0; i < 75; i++) {
    const d = await json<WatchDetail>(`/competitors/${watch.id}`, operator);
    done = d.snapshots.find((s) => s.id === collected.id);
    if (done && ['failed', 'succeeded'].includes(done.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(
    done && ['succeeded', 'failed'].includes(done.status),
    'Worker did not finish',
  );
  if (done.status === 'succeeded') {
    assert.equal(done.change, 'baseline');
    assert.equal(done.method, 'web');
    assert.match(
      done.content ?? '',
      /documentation examples|illustrative examples/i,
    );
    console.log('LIVE PASS: public HTML fetched by durable Worker.');
  } else {
    assert.equal(done.attempts, 2);
    assert.equal(done.change, 'unknown');
    assert.ok(done.error);
    console.log(
      `LIVE UNAVAILABLE: public HTML collection failed after retries: ${done.error}`,
    );
    if (process.env.WATCH_REQUIRE_LIVE === '1') assert.fail(done.error);
  }
  const bad = await json<Watch>('/competitors', operator, 'POST', {
    ...input,
    name: 'SSRF rejection verification',
    url: 'http://127.0.0.1:3001/api/health',
  });
  await json(`/competitors/${bad.id}`, operator, 'PATCH', {
    enabled: false,
    revision: 0,
  });
  const blocked = await json<WatchSnapshot>(
    `/competitors/${bad.id}/collect`,
    operator,
    'POST',
    {},
  );
  let failure: WatchSnapshot | undefined;
  for (let i = 0; i < 45; i++) {
    failure = (
      await json<WatchDetail>(`/competitors/${bad.id}`, operator)
    ).snapshots.find((s) => s.id === blocked.id);
    if (failure?.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(failure?.status, 'failed');
  assert.equal(failure.change, 'unknown');
  assert.equal(failure.attempts, 2);
  // Advance only this temporary watch's persisted due time: no browser or enqueue request.
  await db
    .update(m.competitorWatches)
    .set({ enabled: true, nextRunAt: new Date(Date.now() - 1000) })
    .where(eq(m.competitorWatches.id, bad.id));
  let scheduled: WatchSnapshot | undefined;
  for (let i = 0; i < 40; i++) {
    scheduled = (
      await json<WatchDetail>(`/competitors/${bad.id}`, operator)
    ).snapshots.find((s) => s.method === 'web' && s.id !== blocked.id);
    if (scheduled?.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(scheduled?.status, 'failed');
  assert.equal(scheduled.attempts, 2);
  await db
    .update(m.competitorWatches)
    .set({ enabled: false })
    .where(eq(m.competitorWatches.id, bad.id));
  const dramaInput = {
    product: products[0],
    title: 'Temporary narrative reference',
    platform: 'Example public chart',
    market: 'US',
    genre: 'Drama',
    hook: 'An unexpected reunion opens with a dilemma.',
    conflict: 'A decision creates opposing needs.',
    reversal: 'New evidence changes the goal.',
    pacing: 'Short setup, escalating stakes.',
    narrative:
      'Dilemma, escalating conflict, evidence, a newly designed resolution.',
    sourceUrl: 'https://example.com/drama/test',
    claimType: 'analysis',
    notes: 'Temporary test; not a real trending title.',
  };
  const drama = await json<Drama>('/dramas', operator, 'POST', dramaInput);
  assert.equal(drama.trend.state, 'unknown');
  assert.equal(
    (await request('/dramas', operator, 'POST', dramaInput)).status,
    409,
  );
  const privateDrama = await json<Drama>('/dramas', admin, 'POST', {
    ...dramaInput,
    product: products[1],
  });
  assert.equal(
    (await request(`/dramas/${privateDrama.id}`, operator)).status,
    403,
  );
  const observation = {
    sourceUrl: 'https://example.com/chart',
    observedAt: '2026-11-15T00:00:00Z',
    metric: 'rank',
    value: 20,
    unit: '名',
    scope: '美国日榜',
    claimType: 'fact',
    note: 'Temporary fixture',
  };
  await json(`/dramas/${drama.id}/observations`, operator, 'POST', observation);
  assert.equal(
    (
      await request(
        `/dramas/${drama.id}/observations`,
        operator,
        'POST',
        observation,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/dramas/${drama.id}/observations`, operator, 'POST', {
        ...observation,
        observedAt: new Date(Date.now() + 3600000).toISOString(),
      })
    ).status,
    409,
  );
  await json(`/dramas/${drama.id}/observations`, operator, 'POST', {
    ...observation,
    observedAt: '2026-11-16T00:00:00Z',
    value: 5,
  });
  assert.equal(
    (await json<Drama>(`/dramas/${drama.id}`, operator)).trend.state,
    'rising',
  );
  const { product: omit, ...edit } = dramaInput;
  void omit;
  await json(`/dramas/${drama.id}`, operator, 'PATCH', {
    revision: 0,
    data: { ...edit, pacing: 'Updated pacing' },
  });
  assert.equal(
    (
      await request(`/dramas/${drama.id}`, operator, 'PATCH', {
        revision: 0,
        data: edit,
      })
    ).status,
    409,
  );
  const task = {
    kind: 'content',
    title: 'Write an original script',
    channel: 'TikTok',
    assigneeId: users[1],
    priority: 'normal',
    dueAt: null,
  };
  const script = {
    task,
    brief:
      'Create entirely new characters and a new conflict for the product audience. Review originality before publication.',
  };
  assert.equal(
    (await request(`/dramas/${drama.id}/script`, viewer, 'POST', script))
      .status,
    403,
  );
  const tasks = await Promise.all(
    [1, 2].map(() =>
      json<WorkflowTask>(
        `/dramas/${drama.id}/script`,
        operator,
        'POST',
        script,
      ),
    ),
  );
  assert.equal(tasks[0]!.id, tasks[1]!.id);
  assert.match(tasks[0]!.brief!, /参考来源/);
  assert.match(tasks[0]!.brief!, /原创方向/);
  const listed = await json<WorkflowTask[]>(
    `/tasks?product=${products[0]}`,
    operator,
  );
  assert.ok(
    listed.some((t) => t.id === tasks[0]!.id && t.brief?.includes('重新设计')),
  );
  await json(`/members/${users[1]}/products`, admin, 'PATCH', {
    revision: 1,
    productIds: [],
  });
  assert.deepEqual(await json('/competitors', operator), []);
  assert.deepEqual(await json('/dramas', operator), []);
  assert.equal(
    (await request(`/competitors/${watch.id}/collect`, operator, 'POST', {}))
      .status,
    403,
  );
  console.log(
    'PASS: scoped products/roles/revocation; snapshots, claim isolation, diffs, revisions, concurrent confirmation; durable Worker completion/failure and SSRF retry failure; drama fields, comparable trends, duplicate/future rejection, original-script task and idempotency.',
  );
} finally {
  await db
    .update(m.competitorWatches)
    .set({ enabled: false })
    .where(inArray(m.competitorWatches.product, products));
  await db
    .delete(m.competitorWatches)
    .where(inArray(m.competitorWatches.product, products));
  await db.delete(m.dramas).where(inArray(m.dramas.product, products));
  await db
    .delete(growth.workflowTasks)
    .where(inArray(growth.workflowTasks.product, products));
  await db
    .delete(growth.intelligence)
    .where(inArray(growth.intelligence.product, products));
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
  await db
    .delete(catalog.products)
    .where(inArray(catalog.products.id, products));
  await pool.end();
}
