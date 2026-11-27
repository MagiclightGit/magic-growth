import * as collection from './schema/collection.js';
import { dailyBriefs } from './schema/briefs.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as researchConversations from './schema/research-conversations.js';
import * as auth from './schema/auth.js';
import * as competitorResearch from './schema/competitor-research.js';
import * as marketWatch from './schema/market-watch.js';
import * as catalog from './schema/products.js';
import * as outreach from './schema/outreach.js';
import * as growth from './schema/growth.js';
export const schema = {
  ...auth,
  ...researchConversations,
  ...growth,
  ...outreach,
  ...collection,
  dailyBriefs,
  ...catalog,
  ...marketWatch,
  ...competitorResearch,
};
export {
  auth,
  growth,
  outreach,
  collection,
  catalog,
  marketWatch,
  competitorResearch,
  researchConversations,
};
export function createDatabase(url: string) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  return { db: drizzle(pool, { schema }), pool };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export {
  scoreSubject,
  subjectFingerprint,
  requestScore,
  transportScore,
  attachScores,
} from './scoring.js';
export { attachIntelligenceScores } from './scoring.js';
export { canAccessProduct } from './product-access.js';
export {
  requestWatchSnapshot,
  saveWatchSnapshot,
  recordManualWatchSnapshot,
  dueWatches,
} from './watch-workflow.js';
export {
  requestCompetitorResearch,
  dueCompetitors,
} from './competitor-workflow.js';

export { requestCollectionRun } from './collection-workflow.js';
export { dailyBriefs } from './schema/briefs.js';
export { generateDailyBriefs } from './brief-workflow.js';
