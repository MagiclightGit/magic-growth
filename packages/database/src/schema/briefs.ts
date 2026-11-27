import {
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { BriefContent } from '@guangmo/contracts';
import { products } from './products.js';

export const dailyBriefs = pgTable(
  'daily_briefs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    businessDate: date('business_date').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    content: jsonb('content').$type<BriefContent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('daily_brief_product_date').on(
      table.product,
      table.businessDate,
    ),
  ],
);
