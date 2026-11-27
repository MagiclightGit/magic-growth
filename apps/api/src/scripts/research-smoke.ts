import { waitForScoring } from './wait-for-scoring.js';
import assert from 'node:assert/strict';
import { signInWithRetry } from './sign-in-retry.js';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { createDatabase, auth, growth } from '@guangmo/database';
import type { ResearchDetail } from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { env } from '../config/env.js';

// Opt-in local integration test: makes one real model/search request.
assert.notEqual(process.env.NODE_ENV, 'production');
const { db, pool } = createDatabase(env.DATABASE_URL);
const base = `http://127.0.0.1:${env.API_PORT}/api`;
const password = randomUUID() + 'aA1!';
let memberId: string | undefined;
let runId: string | undefined;
try {
  assert.equal(
    (await fetch(`${base}/research/${randomUUID()}/stream`)).status,
    401,
  );
  const member = await provisionMember(db, {
    name: 'Streaming integration test',
    email: `stream-${randomUUID()}@example.com`,
    password,
    role: 'operator',
    productIds: ['MagicTattoo'],
  });
  assert.ok(member);
  memberId = member.id;
  const login = await signInWithRetry(() =>
    fetch(`${base}/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.WEB_ORIGIN },
      body: JSON.stringify({ email: member.email, password }),
    }),
  );
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const response = await fetch(`${base}/research`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      product: 'MagicTattoo',
      goal: '搜索 AI SDK 官方网站，简要说明它是什么，附上一个官方来源。中文回答，不超过150字。',
    }),
  });
  assert.equal(response.status, 201);
  runId = ((await response.json()) as ResearchDetail).id;
  const stream = await fetch(`${base}/research/${runId}/stream`, {
    headers: { cookie },
    signal: AbortSignal.timeout(240000),
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const decoder = new TextDecoder();
  let buffer = '';
  let snapshots = 0;
  let partials = 0;
  let restored = false;
  let terminal: ResearchDetail | undefined;
  for await (const chunk of stream.body!) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (!frame.startsWith('data: ')) continue;
      const run = JSON.parse(frame.slice(6)) as ResearchDetail;
      snapshots++;
      if (run.result && run.status === 'running') partials++;
      if (!restored && run.events.length) {
        const replay = await fetch(`${base}/research/${runId}/stream`, {
          headers: { cookie },
          signal: AbortSignal.timeout(5000),
        });
        const reader = replay.body!.getReader();
        const initial = await reader.read();
        assert.ok(decoder.decode(initial.value).includes(runId!));
        await reader.cancel();
        restored = true;
      }
      if (['succeeded', 'failed'].includes(run.status)) terminal = run;
    }
  }
  assert.equal(
    terminal?.status,
    'succeeded',
    terminal?.error ?? 'No terminal snapshot',
  );
  assert.ok(terminal.result?.length);
  assert.ok(terminal.events.some((event) => event.data?.kind === 'search'));
  assert.ok(terminal.events.some((event) => event.data?.kind === 'source'));
  assert.ok(restored);
  const deadline = Date.now() + 240000;
  let extractionStatus = 'queued';
  while (Date.now() < deadline) {
    const [stage] = await db
      .select()
      .from(growth.researchExtractions)
      .where(eq(growth.researchExtractions.runId, runId!));
    extractionStatus = stage?.status ?? 'queued';
    if (['succeeded', 'failed'].includes(extractionStatus)) break;
    await delay(1000);
  }
  assert.equal(
    extractionStatus,
    'succeeded',
    'Automatic extraction must finish after research',
  );
  console.log(
    JSON.stringify({
      snapshots,
      partials,
      sources: terminal.events.filter((event) => event.data?.kind === 'source')
        .length,
      restored,
      status: terminal.status,
    }),
  );
} finally {
  if (runId) {
    // Leave an active run and owner intact if the test disconnects or times out.
    const [run] = await db
      .select()
      .from(growth.researchRuns)
      .where(eq(growth.researchRuns.id, runId));
    const [stage] = await db
      .select()
      .from(growth.researchExtractions)
      .where(eq(growth.researchExtractions.runId, runId));
    const scoringSettled = await waitForScoring(db, memberId ? [memberId] : []);
    if (
      !scoringSettled ||
      (run && ['queued', 'running'].includes(run.status)) ||
      (stage && ['queued', 'running'].includes(stage.status))
    )
      memberId = undefined;
    else
      await db
        .delete(growth.researchRuns)
        .where(eq(growth.researchRuns.id, runId));
  }
  if (memberId) {
    await db
      .delete(growth.auditLog)
      .where(
        or(
          eq(growth.auditLog.objectId, memberId),
          eq(growth.auditLog.actorId, memberId),
        ),
      );
    await db.delete(auth.user).where(eq(auth.user.id, memberId));
  }
  await pool.end();
}
