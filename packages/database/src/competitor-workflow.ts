import { and, eq, desc, inArray, lte } from 'drizzle-orm';
import {
  competitorProfiles as profiles,
  competitorResearchRuns as runs,
} from './schema/competitor-research.js';
import { user } from './schema/auth.js';
import { canAccessProduct } from './product-access.js';
import type { Database } from './index.js';
export async function requestCompetitorResearch(
  db: Database,
  id: string,
  actorId: string,
  scheduled = false,
) {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(profiles)
      .where(eq(profiles.id, id))
      .for('update');
    if (!profile) throw new Error('竞品不存在');
    if (scheduled && (!profile.enabled || profile.nextRunAt > new Date()))
      return null;
    const [actor] = await tx.select().from(user).where(eq(user.id, actorId));
    if (
      !actor ||
      actor.disabled ||
      !['admin', 'operator'].includes(actor.role) ||
      !(await canAccessProduct(tx, actorId, profile.product, true))
    ) {
      if (scheduled)
        await tx
          .update(profiles)
          .set({ enabled: false, revision: profile.revision + 1 })
          .where(eq(profiles.id, id));
      return null;
    }
    const [active] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.competitorId, id),
          inArray(runs.status, ['queued', 'running']),
        ),
      );
    if (active) return active;
    const [previous] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.competitorId, id), eq(runs.status, 'succeeded')))
      .orderBy(desc(runs.completedAt))
      .limit(1);
    const [run] = await tx
      .insert(runs)
      .values({
        competitorId: id,
        createdBy: actorId,
        config: {
          product: profile.product,
          name: profile.name,
          website: profile.website,
          market: profile.market as 'US' | 'UK' | 'EU' | 'Global',
          focus: profile.focus,
          sources: profile.sources,
          intervalHours: profile.intervalHours,
          enabled: profile.enabled,
        },
        previousRunId: previous?.id ?? null,
      })
      .returning();
    await tx
      .update(profiles)
      .set({
        nextRunAt: new Date(Date.now() + profile.intervalHours * 3600000),
      })
      .where(eq(profiles.id, id));
    return run!;
  });
}
export async function dueCompetitors(db: Database) {
  return db
    .select()
    .from(profiles)
    .where(and(eq(profiles.enabled, true), lte(profiles.nextRunAt, new Date())))
    .limit(50);
}
