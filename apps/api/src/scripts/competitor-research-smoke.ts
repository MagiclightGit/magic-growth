import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import {
  auth,
  catalog,
  createDatabase,
  growth,
  competitorResearch as c,
} from '@guangmo/database';
import {
  competitorDimensions,
  type CompetitorProfile,
  type CompetitorRunDetail,
  type CompetitorFinding,
} from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { signInWithRetry } from './sign-in-retry.js';
import { env } from '../config/env.js';
assert.notEqual(process.env.NODE_ENV, 'production');
const { db, pool } = createDatabase(env.DATABASE_URL);
const prefix = `research-${randomUUID()}`;
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
  const input = {
    product: products[0]!,
    name: 'Temporary competitor',
    website: 'https://example.com/competitor-test',
    market: 'US' as const,
    focus: 'Isolated endpoint tests, not real business findings.',
    sources: [],
    intervalHours: 24,
    enabled: false,
  };
  assert.equal((await request('/competitor-profiles')).status, 401);
  assert.equal(
    (await request('/competitor-profiles', viewer, 'POST', input)).status,
    403,
  );
  const profile = await json<CompetitorProfile>(
    '/competitor-profiles',
    operator,
    'POST',
    input,
  );
  assert.equal(
    (await request('/competitor-profiles', operator, 'POST', input)).status,
    409,
  );
  const foreign = await json<CompetitorProfile>(
    '/competitor-profiles',
    admin,
    'POST',
    { ...input, product: products[1] },
  );
  assert.equal(
    (await request(`/competitor-profiles/${foreign.id}`, operator)).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/competitor-profiles/${foreign.id}/research`,
        operator,
        'POST',
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (await json<CompetitorProfile[]>('/competitor-profiles', operator)).length,
    1,
  );
  const { product: omit, ...data } = input;
  void omit;
  await json(`/competitor-profiles/${profile.id}`, operator, 'PATCH', {
    revision: 0,
    data: { ...data, name: 'Revised competitor' },
  });
  assert.equal(
    (
      await request(`/competitor-profiles/${profile.id}`, operator, 'PATCH', {
        revision: 0,
        data,
      })
    ).status,
    409,
  );
  // Completed, explicitly synthetic fixtures exercise authorization and publication only; no queued model calls.
  const findings: CompetitorFinding[] = competitorDimensions.map(
    (dimension) => ({
      dimension,
      availability: dimension === 'ads' ? 'unknown' : 'found',
      summary: 'Synthetic endpoint fixture, not a real business observation.',
      claimType: dimension === 'pricing' ? 'estimate' : 'analysis',
      evidence:
        dimension === 'ads'
          ? []
          : [
              {
                url: 'https://example.com/competitor-evidence',
                title: 'Fixture source',
                basis: 'Explicit synthetic endpoint fixture.',
              },
            ],
      change: 'baseline',
      comparison: 'First fixture baseline.',
    }),
  );
  const [first] = await db
    .insert(c.competitorResearchRuns)
    .values({
      competitorId: profile.id,
      status: 'succeeded',
      stage: 'analysis',
      config: input,
      createdBy: users[1]!,
      report: 'Synthetic completed report fixture.',
      findings,
      completedAt: new Date(),
    })
    .returning();
  assert.ok(first);
  const [second] = await db
    .insert(c.competitorResearchRuns)
    .values({
      competitorId: profile.id,
      status: 'succeeded',
      stage: 'analysis',
      config: input,
      createdBy: users[1]!,
      report: 'Synthetic next report fixture.',
      findings,
      previousRunId: first.id,
      completedAt: new Date(),
    })
    .returning();
  assert.ok(second);
  await db.insert(c.competitorResearchEvents).values({
    runId: second.id,
    message: 'Synthetic source event',
    data: { kind: 'source', url: 'https://example.com/competitor-evidence' },
  });
  const path = `/competitor-profiles/${profile.id}/runs/${second.id}`;
  const detail = await json<CompetitorRunDetail>(path, viewer);
  assert.equal(detail.findings?.length, 6);
  assert.equal(detail.previous?.id, first.id);
  assert.equal(detail.events.length, 1);
  assert.equal(
    (
      await request(
        `/competitor-profiles/${foreign.id}/runs/${second.id}`,
        admin,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request(path + '/publish', viewer, 'POST', { dimension: 'product' }))
      .status,
    403,
  );
  assert.equal(
    (await request(path + '/publish', operator, 'POST', { dimension: 'ads' }))
      .status,
    409,
  );
  const confirmed = await Promise.all(
    [1, 2].map(() =>
      json<{ id: string }>(path + '/publish', operator, 'POST', {
        dimension: 'pricing',
      }),
    ),
  );
  assert.equal(confirmed[0]!.id, confirmed[1]!.id);
  const [item] = await db
    .select()
    .from(growth.intelligence)
    .where(eq(growth.intelligence.id, confirmed[0]!.id));
  assert.equal(item?.metadata?.claimType, 'estimate');
  assert.equal(item?.metadata?.publishedAt, null);
  const evidence = await db
    .select()
    .from(growth.intelligenceEvidence)
    .where(eq(growth.intelligenceEvidence.intelligenceId, item!.id));
  assert.equal(evidence.length, 1);
  assert.match(evidence[0]!.evidence, /非原文引述/);
  assert.equal(
    (await json<CompetitorRunDetail>(path, operator)).published.pricing,
    item!.id,
  );
  assert.equal(
    (await request(path + '/retry', operator, 'POST', {})).status,
    409,
  );
  await json(`/products/${products[0]}`, admin, 'PATCH', {
    name: 'Archived fixture',
    archived: true,
  });
  assert.equal(
    (
      await request(
        `/competitor-profiles/${profile.id}/research`,
        operator,
        'POST',
        {},
      )
    ).status,
    403,
  );
  await json(`/members/${users[1]}/products`, admin, 'PATCH', {
    revision: 1,
    productIds: [],
  });
  assert.deepEqual(await json('/competitor-profiles', operator), []);
  assert.equal((await request(path, operator)).status, 403);
  assert.equal(
    (
      await request(path + '/publish', operator, 'POST', {
        dimension: 'product',
      })
    ).status,
    403,
  );
  console.log(
    'PASS: competitor profile validation, RBAC, product isolation/revocation/archive, revision conflicts, six-dimension history/evidence, estimate preservation, unknown rejection, concurrent publication idempotency; no model calls.',
  );
} finally {
  await db
    .delete(c.competitorProfiles)
    .where(inArray(c.competitorProfiles.product, products));
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
