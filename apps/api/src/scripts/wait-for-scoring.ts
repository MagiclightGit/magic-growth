import { setTimeout as delay } from 'node:timers/promises';
import { and, inArray } from 'drizzle-orm';
import { growth, type Database } from '@guangmo/database';
// Real research now also queues opportunity assessments; let them settle before fixture deletion.
export async function waitForScoring(db: Database, owners: string[]) {
  if (!owners.length) return true;
  const deadline = Date.now() + 420000;
  while (Date.now() < deadline) {
    const active = await db
      .select({ id: growth.opportunityAssessments.id })
      .from(growth.opportunityAssessments)
      .where(
        and(
          inArray(growth.opportunityAssessments.createdBy, owners),
          inArray(growth.opportunityAssessments.status, ['queued', 'running']),
        ),
      );
    if (!active.length) return true;
    await delay(1000);
  }
  return false;
}
