import { and, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import type { BriefContent, BriefEntry } from '@guangmo/contracts';
import type { Database } from './index.js';
import { dailyBriefs } from './schema/briefs.js';
import { collectionRuns, feedSources } from './schema/collection.js';
import { intelligence } from './schema/growth.js';
import { products } from './schema/products.js';

const hour = 3600000;
const day = 24 * hour;

export function briefWindow(now = new Date()) {
  const local = new Date(now.getTime() + 8 * hour);
  if (local.getUTCHours() * 60 + local.getUTCMinutes() < 9 * 60 + 5)
    local.setUTCDate(local.getUTCDate() - 1);
  const businessDate = local.toISOString().slice(0, 10);
  const windowEnd = new Date(`${businessDate}T08:30:00+08:00`);
  return {
    businessDate,
    windowStart: new Date(windowEnd.getTime() - day),
    windowEnd,
  };
}

function sectionFor(
  row: typeof intelligence.$inferSelect,
): BriefEntry['section'] | null {
  if (row.category === 'competitor') return 'competitor';
  if (row.category === 'content' && row.metadata?.tags.includes('社媒热点'))
    return 'social';
  if (!['industry', 'merchant'].includes(row.category)) return null;
  if (row.metadata?.vertical === 'tattoo') return 'tattoo';
  if (
    row.market === 'US' &&
    row.metadata?.vertical &&
    [
      'nails',
      'hair_barber',
      'beauty_lash_brow',
      'other_local_service',
    ].includes(row.metadata.vertical)
  )
    return 'local';
  return null;
}

export async function generateDailyBriefs(db: Database, now = new Date()) {
  const window = briefWindow(now);
  const eligible = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.archived, false),
        sql`not exists (select 1 from ${dailyBriefs} where ${dailyBriefs.product} = ${products.id} and ${dailyBriefs.businessDate} = ${window.businessDate})`,
      ),
    )
    .orderBy(products.id)
    .limit(30);
  for (const product of eligible) await saveBrief(db, product.id, window, now);
}

async function saveBrief(
  db: Database,
  product: string,
  window: ReturnType<typeof briefWindow>,
  now: Date,
) {
  const [rows, previous, sources] = await Promise.all([
    db
      .select()
      .from(intelligence)
      .where(
        and(
          eq(intelligence.product, product),
          eq(intelligence.status, 'verified'),
          lte(intelligence.updatedAt, now),
          gte(
            intelligence.updatedAt,
            new Date(window.windowStart.getTime() - 3 * day),
          ),
        ),
      )
      .orderBy(desc(intelligence.updatedAt), desc(intelligence.id))
      .limit(500),
    db
      .select({ content: dailyBriefs.content })
      .from(dailyBriefs)
      .where(
        and(
          eq(dailyBriefs.product, product),
          gt(
            dailyBriefs.windowEnd,
            new Date(window.windowEnd.getTime() - 3 * day),
          ),
          lte(dailyBriefs.windowEnd, window.windowStart),
        ),
      ),
    db
      .select({ id: feedSources.id, name: feedSources.name })
      .from(feedSources)
      .where(
        and(eq(feedSources.product, product), eq(feedSources.enabled, true)),
      ),
  ]);
  const runs = sources.length
    ? await db
        .selectDistinctOn([collectionRuns.sourceId])
        .from(collectionRuns)
        .where(
          and(
            inArray(
              collectionRuns.sourceId,
              sources.map((source) => source.id),
            ),
            gte(collectionRuns.createdAt, window.windowStart),
            lte(collectionRuns.createdAt, window.windowEnd),
          ),
        )
        .orderBy(
          collectionRuns.sourceId,
          desc(collectionRuns.createdAt),
          desc(collectionRuns.id),
        )
    : [];
  const latest = new Map(runs.map((run) => [run.sourceId, run]));
  const seen = new Set(
    previous.flatMap((row) =>
      [...row.content.entries, ...row.content.leads].map((item) => item.id),
    ),
  );
  const content: BriefContent = {
    entries: [],
    leads: [],
    coverage: sources.map((source) => {
      const run = latest.get(source.id);
      const completed = run?.completedAt && run.completedAt <= now;
      return {
        name: source.name,
        state: !run
          ? 'unobserved'
          : !completed
            ? 'pending'
            : run.status === 'succeeded'
              ? 'succeeded'
              : 'failed',
        completedAt: completed ? run.completedAt!.toISOString() : null,
      };
    }),
  };
  const counts = new Map<BriefEntry['section'], number>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const section = sectionFor(row);
    if (!section) continue;
    const publishedAt = row.metadata?.publishedAt ?? null;
    const start = window.windowStart.getTime();
    const end = window.windowEnd.getTime();
    const observedAt = row.metadata?.sourceTimes?.[0]?.fetchedAt;
    const timeValue =
      publishedAt ?? (section === 'competitor' ? observedAt : null);
    const dateOnly = !!publishedAt && publishedAt.length === 10;
    const timestamp = timeValue
      ? Date.parse(dateOnly ? `${timeValue}T00:00:00+08:00` : timeValue)
      : NaN;
    if (
      timeValue &&
      (!Number.isFinite(timestamp) ||
        timestamp >= end ||
        timestamp + (dateOnly ? day : 0) <= start)
    )
      continue;
    if (!timeValue && row.updatedAt < window.windowStart) continue;
    const entry = {
      id: row.id,
      section,
      title: row.title,
      summary: row.summary.slice(0, 110),
      sourceUrl: row.sourceUrl,
      publishedAt,
      action: row.metadata?.suggestedAction?.slice(0, 80) ?? '',
    };
    if (!timeValue) {
      if (content.leads.length < 2) content.leads.push(entry);
      continue;
    }
    if ((counts.get(section) ?? 0) >= 2 || content.entries.length >= 8)
      continue;
    counts.set(section, (counts.get(section) ?? 0) + 1);
    content.entries.push(entry);
  }
  await db
    .insert(dailyBriefs)
    .values({ ...window, product, content, createdAt: now })
    .onConflictDoNothing();
}
