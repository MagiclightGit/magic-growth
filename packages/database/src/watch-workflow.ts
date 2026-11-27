import { and, eq, desc, inArray, lte, isNull, isNotNull } from 'drizzle-orm';
import {
  competitorWatches,
  competitorSnapshots,
} from './schema/market-watch.js';
import { user } from './schema/auth.js';
import { canAccessProduct } from './product-access.js';
import {
  candidateInput,
  priceComparison,
  textDifference,
  watchKinds,
  type PriceObservation,
} from '@guangmo/contracts';
import { intelligenceCandidates } from './schema/growth.js';
import type { Database } from './index.js';
// Database rows form a durable outbox; only one collection may be pending per watch.
export async function requestWatchSnapshot(
  db: Database,
  watchId: string,
  actorId: string,
  scheduled = false,
) {
  return db.transaction(async (tx) => {
    const [watch] = await tx
      .select()
      .from(competitorWatches)
      .where(eq(competitorWatches.id, watchId))
      .for('update');
    if (!watch) throw new Error('监控不存在');
    if (scheduled && (!watch.enabled || watch.nextRunAt > new Date()))
      return null;
    const [actor] = await tx.select().from(user).where(eq(user.id, actorId));
    if (
      !actor ||
      !['admin', 'operator'].includes(actor.role) ||
      !(await canAccessProduct(tx, actorId, watch.product, true))
    ) {
      if (scheduled)
        await tx
          .update(competitorWatches)
          .set({ enabled: false, revision: watch.revision + 1 })
          .where(eq(competitorWatches.id, watchId));
      return null;
    }
    const [active] = await tx
      .select()
      .from(competitorSnapshots)
      .where(
        and(
          eq(competitorSnapshots.watchId, watchId),
          eq(competitorSnapshots.method, 'web'),
          inArray(competitorSnapshots.status, ['queued', 'running']),
        ),
      );
    if (active) return active;
    const [row] = await tx
      .insert(competitorSnapshots)
      .values({ watchId, sourceUrl: watch.url, createdBy: actorId })
      .returning();
    await tx
      .update(competitorWatches)
      .set({ nextRunAt: new Date(Date.now() + watch.intervalHours * 3600000) })
      .where(eq(competitorWatches.id, watchId));
    return row!;
  });
}
export async function saveWatchSnapshot(
  db: Database,
  id: string,
  content: string,
) {
  return db.transaction((tx) => completeSnapshot(tx, id, content));
}
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
async function completeSnapshot(tx: Transaction, id: string, content: string) {
  const [snapshot] = await tx
    .select()
    .from(competitorSnapshots)
    .where(eq(competitorSnapshots.id, id));
  if (!snapshot) throw new Error('采集记录不存在');
  // Serialize manual and automatic snapshots against the same watch.
  const [watch] = await tx
    .select()
    .from(competitorWatches)
    .where(eq(competitorWatches.id, snapshot.watchId))
    .for('update');
  const [actor] = await tx
    .select()
    .from(user)
    .where(eq(user.id, snapshot.createdBy));
  if (
    !actor ||
    !['admin', 'operator'].includes(actor.role) ||
    !watch ||
    !(await canAccessProduct(tx, snapshot.createdBy, watch.product, true))
  )
    throw new Error('产品已归档或采集成员权限已撤销');
  const [current] = await tx
    .select()
    .from(competitorSnapshots)
    .where(eq(competitorSnapshots.id, id))
    .for('update');
  if (current?.status === 'succeeded') return current;
  const [previous] = await tx
    .select()
    .from(competitorSnapshots)
    .where(
      and(
        eq(competitorSnapshots.watchId, watch.id),
        eq(competitorSnapshots.status, 'succeeded'),
        eq(competitorSnapshots.method, snapshot.method),
        eq(competitorSnapshots.sourceUrl, snapshot.sourceUrl),
        eq(competitorSnapshots.claimType, snapshot.claimType),
        snapshot.price
          ? isNotNull(competitorSnapshots.price)
          : isNull(competitorSnapshots.price),
      ),
    )
    .orderBy(
      desc(competitorSnapshots.completedAt),
      desc(competitorSnapshots.id),
    )
    .limit(1);
  const difference = textDifference(previous?.content ?? null, content);
  const change = snapshot.price
    ? priceComparison(previous?.price ?? null, snapshot.price)
    : difference.change;
  const completedAt = new Date();
  const [saved] = await tx
    .update(competitorSnapshots)
    .set({
      content,
      previousContent: previous?.content ?? null,
      previousPrice: previous?.price ?? null,
      change,
      status: 'succeeded',
      error: null,
      completedAt,
    })
    .where(eq(competitorSnapshots.id, id))
    .returning();
  if ((snapshot.method === 'web' || snapshot.price) && change === 'changed') {
    const significantText = (lines: string[]) =>
      lines
        .filter(
          (line) =>
            /[\p{L}\p{N}]/u.test(line) &&
            !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line),
        )
        .join('\n');
    const formatPrice = (price: PriceObservation) =>
      `${price.plan} · ${price.locale} · ${price.currency} ${price.amount} · ${price.interval}`;
    const before = previous?.price
      ? formatPrice(previous.price)
      : significantText(difference.removed);
    const after = snapshot.price
      ? formatPrice(snapshot.price)
      : significantText(difference.added);
    if (before || after) {
      const changes = `上次页面（${previous?.completedAt?.toISOString() ?? '未知'}）\n${before.slice(0, 800) || '无移除文本'}\n\n本次页面（${completedAt.toISOString()}）\n${after.slice(0, 800) || '无新增文本'}`;
      const payload = candidateInput.parse({
        title:
          `${watch.name} · ${watchKinds[watch.kind as keyof typeof watchKinds]}`.slice(
            0,
            200,
          ),
        summary: changes,
        product: watch.product,
        market: watch.market,
        category: 'competitor',
        claimType:
          snapshot.method === 'web' ? 'source_claim' : snapshot.claimType,
        publishedAt: null,
        language: null,
        tags: ['页面变化'],
        suggestedAction:
          '核对页面变化和适用范围。定价需确认地区、币种与订阅周期。',
        sources: [
          {
            url: snapshot.sourceUrl,
            title: watch.name,
            evidence: changes.slice(0, 2000),
          },
        ],
        sourceTimes: [
          {
            url: snapshot.sourceUrl,
            fetchedAt: completedAt.toISOString(),
            status: 'ok',
            publishedAt: null,
            modifiedAt: null,
            eventStartsAt: null,
            eventEndsAt: null,
          },
        ],
      });
      await tx
        .insert(intelligenceCandidates)
        .values({ payload, originKey: `watch:${id}` })
        .onConflictDoNothing();
    }
  }
  return saved!;
}

export async function dueWatches(db: Database) {
  return db
    .select()
    .from(competitorWatches)
    .where(
      and(
        eq(competitorWatches.enabled, true),
        lte(competitorWatches.nextRunAt, new Date()),
      ),
    )
    .limit(50);
}

export async function recordManualWatchSnapshot(
  db: Database,
  watchId: string,
  actorId: string,
  input: {
    content: string;
    claimType: 'fact' | 'estimate' | 'analysis';
    note: string;
    price?: PriceObservation;
  },
) {
  return db.transaction(async (tx) => {
    const [watch] = await tx
      .select()
      .from(competitorWatches)
      .where(eq(competitorWatches.id, watchId))
      .for('update');
    if (!watch) throw new Error('监控不存在');
    if (input.price && watch.kind !== 'pricing')
      throw new Error('仅定价页面支持结构化报价');
    const [row] = await tx
      .insert(competitorSnapshots)
      .values({
        watchId,
        sourceUrl: watch.url,
        createdBy: actorId,
        method: 'manual',
        attempts: 1,
        claimType: input.claimType,
        note: input.note,
        price: input.price,
      })
      .returning();
    return completeSnapshot(tx, row!.id, input.content);
  });
}
