import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from './index.js';
import { collectionRuns, feedSources } from './schema/collection.js';
import { user } from './schema/auth.js';
import { canAccessProduct } from './product-access.js';

export async function requestCollectionRun(
  db: Database,
  sourceId: string,
  actorId?: string,
) {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(feedSources)
      .where(eq(feedSources.id, sourceId))
      .for('update');
    if (!source) return null;
    const now = new Date();
    if (!actorId && (!source.enabled || source.nextRunAt > now)) return null;
    const actor = actorId ?? source.createdBy;
    const [member] = await tx
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, actor));
    if (
      member?.role !== 'admin' ||
      !(await canAccessProduct(tx, actor, source.product, true))
    ) {
      if (!actorId)
        await tx
          .update(feedSources)
          .set({ enabled: false, revision: source.revision + 1 })
          .where(eq(feedSources.id, sourceId));
      return null;
    }
    const [active] = await tx
      .select()
      .from(collectionRuns)
      .where(
        and(
          eq(collectionRuns.sourceId, sourceId),
          inArray(collectionRuns.status, ['queued', 'running']),
        ),
      );
    if (!actorId)
      await tx
        .update(feedSources)
        .set({
          nextRunAt: new Date(now.getTime() + source.intervalHours * 3600000),
        })
        .where(eq(feedSources.id, sourceId));
    if (active) return active;
    const [run] = await tx
      .insert(collectionRuns)
      .values({
        sourceId,
        actorId: actor,
        scheduled: !actorId,
      })
      .returning();
    return run!;
  });
}
