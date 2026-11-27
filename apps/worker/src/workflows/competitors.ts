import { and, ne, eq } from 'drizzle-orm';
import {
  marketWatch as m,
  auth,
  type Database,
  canAccessProduct,
  saveWatchSnapshot,
} from '@guangmo/database';
import { collectWatchPage } from '@guangmo/agent';
export async function executeWatch(db: Database, id: string, attempt: number) {
  const [snapshot] = await db
    .select()
    .from(m.competitorSnapshots)
    .where(eq(m.competitorSnapshots.id, id));
  if (!snapshot || snapshot.status === 'succeeded' || snapshot.method !== 'web')
    return;
  const [actor] = await db
    .select()
    .from(auth.user)
    .where(eq(auth.user.id, snapshot.createdBy));
  if (!actor || !['admin', 'operator'].includes(actor.role))
    throw new Error('采集成员已无执行权限');
  const [watch] = await db
    .select()
    .from(m.competitorWatches)
    .where(eq(m.competitorWatches.id, snapshot.watchId));
  if (
    !watch ||
    !(await canAccessProduct(db, snapshot.createdBy, watch.product, true))
  )
    throw new Error('产品已归档或采集成员无权限');
  await db
    .update(m.competitorSnapshots)
    .set({ status: 'running', attempts: attempt, error: null })
    .where(eq(m.competitorSnapshots.id, id));
  const text = await collectWatchPage(snapshot.sourceUrl);
  await saveWatchSnapshot(db, id, text);
}
export async function failWatch(
  db: Database,
  id: string,
  attempts: number,
  final: boolean,
  error: Error,
) {
  await db
    .update(m.competitorSnapshots)
    .set({
      status: final ? 'failed' : 'queued',
      attempts,
      error: error.message.slice(0, 1000),
      change: 'unknown',
      completedAt: final ? new Date() : null,
    })
    .where(
      and(
        eq(m.competitorSnapshots.id, id),
        ne(m.competitorSnapshots.status, 'succeeded'),
      ),
    );
}
