import {
  pgTable,
  text,
  timestamp,
  boolean,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const productMembers = pgTable(
  'product_members',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.userId] }),
    index('product_member_user_idx').on(t.userId),
  ],
);
