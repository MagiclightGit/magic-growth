import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import {
  auth,
  catalog,
  createDatabase,
  growth,
  outreach,
  canAccessProduct,
} from '@guangmo/database';
import {
  COLLECTION_WORKFLOW_VERSION,
  type Product,
  type Creator,
  type CsvBatch,
  type CandidateInput,
} from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { signInWithRetry } from './sign-in-retry.js';
import { env } from '../config/env.js';
assert.notEqual(process.env.NODE_ENV, 'production');
const { db, pool } = createDatabase(env.DATABASE_URL);
const prefix = `products-${randomUUID()}`;
const products = [`${prefix}-a`, `${prefix}-b`];
const users: string[] = [];
const items: string[] = [];
const runs: string[] = [];
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
  const r = await request(path, cookie, method, body);
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${await r.clone().text()}`);
  return r.json() as Promise<T>;
}
try {
  const cookies: string[] = [];
  for (const role of ['admin', 'operator', 'viewer', 'operator'] as const) {
    const member = await provisionMember(db, {
      name: `${prefix}-${users.length}`,
      email: `${prefix}-${users.length}@example.com`,
      password,
      role,
    });
    assert.ok(member);
    users.push(member.id);
    const login = await signInWithRetry(() =>
      request('/auth/sign-in/email', '', 'POST', {
        email: member.email,
        password,
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
  const [admin, operator, viewer, empty] = cookies as [
    string,
    string,
    string,
    string,
  ];
  assert.equal((await request('/products')).status, 401);
  assert.equal(
    (
      await request('/products', operator, 'POST', {
        id: products[0],
        name: 'Forbidden',
      })
    ).status,
    403,
  );
  for (const id of products)
    await json<Product>('/products', admin, 'POST', {
      id,
      name: id,
      description: 'Temporary product verification.',
    });
  assert.equal(
    (
      await request('/products', admin, 'POST', {
        id: products[0],
        name: 'duplicate',
      })
    ).status,
    409,
  );
  assert.deepEqual(await json('/products', operator), []);
  for (const id of users.slice(1, 3))
    await json(`/members/${id}/products`, admin, 'PATCH', {
      revision: 0,
      productIds: [products[0]],
    });
  assert.deepEqual(
    (await json<Product[]>('/products', operator)).map((p) => p.id),
    [products[0]],
  );
  const outreachPath = '/outreach/' + products[0];
  const creatorInput = {
    link: 'http://example.com/creator?utm_source=manual',
    email: 'creator@example.com',
  };
  const manual = await json<{ creator: Creator; duplicate: boolean }>(
    outreachPath + '/creators',
    operator,
    'POST',
    creatorInput,
  );
  assert.equal(manual.duplicate, false);
  assert.equal(manual.creator.link, creatorInput.link);
  const repeated = await json<typeof manual>(
    outreachPath + '/creators',
    operator,
    'POST',
    { link: 'https://example.com/creator/#bio' },
  );
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.creator.id, manual.creator.id);
  const file = {
    filename: 'review.csv',
    csv: 'link,name,email\nhttps://example.com/creator,,\nhttps://example.com/new,Creator,\ninvalid,,\nhttps://example.com/new/,Duplicate,',
  };
  const preview = await json<CsvBatch>(
    outreachPath + '/batches/preview',
    operator,
    'POST',
    file,
  );
  assert.deepEqual(
    preview.rows.map((row) => [row.line, row.status]),
    [
      [2, 'duplicate'],
      [3, 'valid'],
      [4, 'failed'],
      [5, 'duplicate'],
    ],
  );
  assert.equal(
    (await json<Creator[]>(outreachPath + '/creators', operator)).length,
    1,
  );
  const imports = await Promise.all(
    [operator, admin].map((actor) =>
      json<CsvBatch>(outreachPath + '/batches', actor, 'POST', file),
    ),
  );
  const imported = imports
    .flatMap((batch) => batch.rows)
    .filter((row) => row.status === 'created');
  assert.equal(imported.length, 1);
  const batch = imports.find((value) =>
    value.rows.some((row) => row.status === 'created'),
  )!;
  const detailPath = outreachPath + '/creators/' + imported[0]!.creatorId;
  assert.equal(
    (await json<{ creator: Creator }>(detailPath, viewer)).creator.batchId,
    batch.id,
  );
  assert.deepEqual(
    (await json<CsvBatch>(outreachPath + '/batches/' + batch.id, viewer)).rows,
    batch.rows,
  );
  for (const path of [
    outreachPath + '/creators',
    detailPath,
    outreachPath + '/batches/' + batch.id,
  ])
    assert.equal((await request(path, empty)).status, 403);
  for (const [path, body] of [
    [outreachPath + '/creators', creatorInput],
    [outreachPath + '/batches', file],
    [outreachPath + '/messages', {}],
  ] as const)
    assert.equal((await request(path, viewer, 'POST', body)).status, 403);
  const otherProduct = '/outreach/' + products[1];
  assert.equal(
    (await request(otherProduct + '/creators/' + manual.creator.id, admin))
      .status,
    404,
  );
  assert.equal(
    (await request(otherProduct + '/batches/' + batch.id, admin)).status,
    404,
  );
  assert.deepEqual(await json('/intelligence', empty), []);
  assert.equal(
    (
      await request(`/members/${users[1]}/products`, operator, 'PATCH', {
        revision: 1,
        productIds: products,
      })
    ).status,
    403,
  );
  for (const product of products) {
    const item = await json<{ id: string }>('/intelligence', admin, 'POST', {
      title: `${prefix} intelligence`,
      summary: 'Temporary evidence for scoped access checks.',
      sourceUrl: `https://example.com/${product}`,
      product,
      market: 'US',
      category: 'competitor',
    });
    items.push(item.id);
    const [run] = await db
      .insert(growth.researchRuns)
      .values({
        product,
        goal: `${prefix} report`,
        createdBy: users[0],
        status: 'succeeded',
        result: 'Source: https://example.com/evidence',
        completedAt: new Date(),
      })
      .returning();
    assert.ok(run);
    runs.push(run.id);
    const [extraction] = await db
      .insert(growth.researchExtractions)
      .values({
        runId: run.id,
        createdBy: users[0]!,
        workflowVersion: COLLECTION_WORKFLOW_VERSION,
        status: 'succeeded',
      })
      .returning();
    assert.ok(extraction);
    const payload: CandidateInput = {
      title: `${prefix} candidate`,
      summary: 'Temporary source finding.',
      product: product!,
      market: 'US',
      category: 'industry',
      claimType: 'fact',
      publishedAt: null,
      language: null,
      tags: [],
      suggestedAction: 'Review source.',
      sources: [
        {
          url: `https://example.com/${product}/finding`,
          title: 'Evidence',
          evidence: 'Temporary evidence.',
        },
      ],
    };
    await db.insert(growth.intelligenceCandidates).values({
      runId: run.id,
      extractionId: extraction.id,
      position: 0,
      payload,
    });
    await db.insert(growth.researchSchedules).values({
      product,
      goal: `${prefix} plan`,
      createdBy: users[1]!,
      hour: 0,
      minute: 0,
      timezone: 'UTC',
      enabled: false,
    });
    await db.insert(growth.workflowTasks).values({
      intelligenceId: item.id,
      title: `${prefix} task`,
      kind: 'content',
      channel: 'TikTok',
      assigneeId: users[0]!,
      createdBy: users[0]!,
      product: product!,
      market: 'US',
      priority: 'normal',
    });
  }
  for (const endpoint of [
    'intelligence',
    'research',
    'candidates',
    'tasks',
    'schedules',
  ]) {
    const rows = await json<{ product: string }[]>(`/${endpoint}`, operator);
    assert.equal(rows.length, 1, endpoint);
    assert.equal(rows[0]!.product, products[0]);
    assert.deepEqual(
      await json(`/${endpoint}?product=${products[1]}`, operator),
      [],
    );
  }
  const overview = await json<{
    total: number;
    runs: number;
    recentItems: unknown[];
    recentRuns: unknown[];
  }>('/overview', operator);
  assert.equal(overview.total, 1);
  assert.equal(overview.runs, 1);
  assert.equal(overview.recentItems.length, 1);
  assert.equal(overview.recentRuns.length, 1);
  assert.equal(
    (
      await json<{ total: number }>(
        `/overview?product=${products[1]}`,
        operator,
      )
    ).total,
    0,
  );
  const [task] = await db
    .select()
    .from(growth.workflowTasks)
    .where(eq(growth.workflowTasks.intelligenceId, items[1]!));
  assert.ok(task);
  const [candidate] = await db
    .select()
    .from(growth.intelligenceCandidates)
    .where(eq(growth.intelligenceCandidates.runId, runs[1]!));
  assert.ok(candidate);
  const [plan] = await db
    .select()
    .from(growth.researchSchedules)
    .where(eq(growth.researchSchedules.product, products[1]!));
  assert.ok(plan);
  for (const path of [
    `/intelligence/${items[1]}`,
    `/research/${runs[1]}`,
    `/research/${runs[1]}/stream`,
    `/research/${runs[1]}/candidates`,
    `/tasks/${task.id}`,
  ])
    assert.equal((await request(path, operator)).status, 403, path);
  for (const [path, method, body] of [
    [`/intelligence/${items[1]}/status`, 'PATCH', { status: 'verified' }],
    [
      `/intelligence/${items[1]}/owner`,
      'PATCH',
      { ownerId: users[1], revision: 0 },
    ],
    [
      `/candidates/${candidate.id}`,
      'PATCH',
      { revision: 0, candidate: candidate.payload },
    ],
    [
      `/candidates/${candidate.id}/review`,
      'POST',
      { revision: 0, action: 'approve' },
    ],
    [`/research/${runs[1]}/extraction`, 'POST', {}],
    [`/scoring/candidate/${candidate.id}`, 'POST', {}],
    [`/tasks/${task.id}`, 'PATCH', { revision: 0, status: 'in_progress' }],
    [`/schedules/${plan.id}`, 'PATCH', { enabled: true }],
    [
      '/research',
      'POST',
      { product: products[1], goal: 'Unauthorized product research.' },
    ],
    [
      '/schedules',
      'POST',
      {
        product: products[1],
        goal: 'Unauthorized product plan.',
        hour: 9,
        minute: 0,
        timezone: 'UTC',
      },
    ],
  ] as const)
    assert.equal(
      (await request(path, operator, method, body)).status,
      403,
      path,
    );
  assert.equal(
    (
      await request(`/intelligence/${items[0]}/owner`, admin, 'PATCH', {
        ownerId: users[3],
        revision: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/intelligence/${items[0]}/status`, viewer, 'PATCH', {
        status: 'verified',
      })
    ).status,
    403,
  );
  // Existing sessions must lose access immediately after revocation, including new product choices.
  await json(`/members/${users[1]}/products`, admin, 'PATCH', {
    revision: 1,
    productIds: [],
  });
  assert.equal(
    (await request(`/intelligence/${items[0]}`, operator)).status,
    403,
  );
  assert.deepEqual(await json('/products', operator), []);
  assert.equal(
    await canAccessProduct(db, users[1]!, products[0]!, true),
    false,
  );
  assert.equal(
    (
      await request(`/members/${users[1]}/products`, admin, 'PATCH', {
        revision: 1,
        productIds: products,
      })
    ).status,
    409,
  );
  await json(`/members/${users[1]}/products`, admin, 'PATCH', {
    revision: 2,
    productIds: [products[1]],
  });
  assert.equal(
    (await json<Product[]>('/products', operator))[0]!.id,
    products[1],
  );
  // Archiving retains history, blocks new work, and is reversible.
  await json(`/products/${products[1]}`, admin, 'PATCH', { archived: true });
  assert.equal(
    (await request(`/intelligence/${items[1]}`, operator)).status,
    200,
  );
  assert.equal(
    (
      await request('/research', operator, 'POST', {
        product: products[1],
        goal: 'An archived product research.',
      })
    ).status,
    403,
  );
  assert.equal(
    await canAccessProduct(db, users[1]!, products[1]!, true),
    false,
  );
  await json(`/products/${products[1]}`, admin, 'PATCH', {
    archived: false,
    name: 'Renamed test product',
  });
  assert.equal(await canAccessProduct(db, users[1]!, products[1]!, true), true);
  const audit = await db
    .select()
    .from(growth.auditLog)
    .where(eq(growth.auditLog.actorId, users[0]!));
  assert.ok(audit.some((r) => r.action === 'member.products'));
  assert.ok(audit.some((r) => r.action === 'product.created'));
  console.log(
    'PASS: dynamic catalog, default-deny grants, scoped lists/overview/details/SSE, cross-product mutation rejection, assignee access, live revocation, revisions, archival, background policy, creator import isolation, concurrent deduplication and audit.',
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
  await db
    .delete(growth.researchSchedules)
    .where(inArray(growth.researchSchedules.product, products));
  if (runs.length)
    await db
      .delete(growth.researchRuns)
      .where(inArray(growth.researchRuns.id, runs));
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
    .delete(outreach.creators)
    .where(inArray(outreach.creators.product, products));
  await db
    .delete(outreach.batches)
    .where(inArray(outreach.batches.product, products));
  await db
    .delete(catalog.products)
    .where(inArray(catalog.products.id, products));
  await pool.end();
}
