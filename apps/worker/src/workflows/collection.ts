import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { collectFeed } from '@guangmo/agent';
import { candidateInput, canonicalizeUrl, webUrl } from '@guangmo/contracts';
import {
  auth,
  canAccessProduct,
  collection,
  growth,
  requestCollectionRun,
  type Database,
} from '@guangmo/database';
import type { ResearchJob } from './research.js';

const { feedSources, collectionRuns } = collection;
const active = inArray(collectionRuns.status, ['queued', 'running']);

async function canCollect(
  db: Pick<Database, 'select'>,
  actorId: string,
  product: string,
) {
  const [actor] = await db
    .select({ role: auth.user.role })
    .from(auth.user)
    .where(eq(auth.user.id, actorId));
  return (
    actor?.role === 'admin' && canAccessProduct(db, actorId, product, true)
  );
}

export async function reconcileCollection(
  db: Database,
  queue: Queue<ResearchJob>,
) {
  const due = await db
    .select({ id: feedSources.id })
    .from(feedSources)
    .where(
      and(
        eq(feedSources.enabled, true),
        lte(feedSources.nextRunAt, new Date()),
      ),
    )
    .orderBy(feedSources.nextRunAt)
    .limit(20);
  for (const source of due) await requestCollectionRun(db, source.id);

  const runs = await db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .where(active)
    .orderBy(collectionRuns.createdAt)
    .limit(30);
  for (const run of runs) {
    const jobId = `collect-${run.id}`;
    const job = await queue.getJob(jobId);
    if (!job)
      await queue.add('collect-feed', { collectionRunId: run.id }, { jobId });
    else if (await job.isFailed())
      await failCollection(db, run.id, true, new Error(job.failedReason));
  }
}

export async function executeCollection(
  db: Database,
  id: string,
  attempt: number,
  readFeed = collectFeed,
) {
  const [run] = await db
    .update(collectionRuns)
    .set({ status: 'running', attempts: attempt, error: null })
    .where(and(eq(collectionRuns.id, id), active))
    .returning();
  if (!run) return;
  const [source] = await db
    .select()
    .from(feedSources)
    .where(eq(feedSources.id, run.sourceId));
  if (
    !source ||
    (run.scheduled && !source.enabled) ||
    !(await canCollect(db, run.actorId, source.product))
  )
    throw new Error('来源已暂停或采集权限已变更');

  const signal = AbortSignal.timeout(25000);
  const feed = await readFeed(source.url, signal).catch((error: unknown) => {
    if (signal.aborted) throw new Error('来源响应超时，请检查网络或稍后重试');
    throw error;
  });
  if (feed.inspected > 0 && !feed.items.length)
    throw new Error('订阅源条目缺少可用链接或标题');
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(feedSources)
      .where(eq(feedSources.id, source.id))
      .for('update');
    if (
      !current ||
      (run.scheduled && !current.enabled) ||
      !(await canCollect(tx, run.actorId, current.product))
    )
      throw new Error('来源已暂停或采集权限已变更');
    const [running] = await tx
      .select()
      .from(collectionRuns)
      .where(and(eq(collectionRuns.id, id), active))
      .for('update');
    if (!running) return;

    const candidates = [];
    for (const item of feed.items) {
      const canonical = canonicalizeUrl(item.url);
      const evidence = item.evidence;
      const payload = candidateInput.parse({
        title: item.title,
        summary: evidence.length >= 5 ? evidence : '原文摘录不足，待补证。',
        product: source.product,
        market: source.market,
        vertical: source.vertical,
        category: source.category,
        claimType: 'source_claim',
        publishedAt: item.publishedAt,
        language: null,
        tags: [],
        suggestedAction: '',
        sources: [
          {
            url: webUrl.parse(item.url),
            title: item.title,
            evidence: evidence || '原文摘录待补充',
          },
        ],
      });
      // An excerpt may be absent. Preserve that absence in the saved evidence.
      if (!evidence) payload.sources[0]!.evidence = '';
      candidates.push({
        payload,
        collectionRunId: id,
        feedItemKey: canonical,
        status: evidence.length >= 5 ? 'pending' : 'needs_evidence',
      });
    }
    const fresh = candidates.length
      ? await tx
          .insert(growth.intelligenceCandidates)
          .values(candidates)
          .onConflictDoNothing()
          .returning({ id: growth.intelligenceCandidates.id })
      : [];
    const completedAt = new Date();
    await tx
      .update(collectionRuns)
      .set({
        status: 'succeeded',
        discovered: feed.discovered,
        added: fresh.length,
        completedAt,
        error:
          feed.discovered > feed.items.length
            ? `订阅源共 ${feed.discovered} 条，本轮取得 ${feed.items.length} 条有效记录（最多检查 50 条）。`
            : null,
      })
      .where(eq(collectionRuns.id, id));
    await tx
      .update(feedSources)
      .set({ lastSuccessAt: completedAt })
      .where(eq(feedSources.id, source.id));
  });
}

export async function failCollection(
  db: Database,
  id: string,
  final: boolean,
  error: Error,
) {
  const known = error.message.match(/^Source HTTP (\d{3})$/)?.[1];
  const safe =
    error.message.startsWith('来源') || error.message.startsWith('订阅源')
      ? error.message
      : known
        ? `来源返回 HTTP ${known}`
        : error.message === 'Source address is not public'
          ? '来源地址不可用于公网采集'
          : '无法读取有效订阅源，请核对链接和访问条件';
  await db
    .update(collectionRuns)
    .set({
      status: final ? 'failed' : 'queued',
      error: safe,
      completedAt: final ? new Date() : null,
    })
    .where(and(eq(collectionRuns.id, id), active));
}
