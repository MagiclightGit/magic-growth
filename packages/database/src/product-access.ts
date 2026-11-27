import { and, eq } from 'drizzle-orm';
import { user } from './schema/auth.js';
import { products, productMembers } from './schema/products.js';
import type { Database } from './index.js';
// Accept both database and transaction clients; never derive grants from model output.
type Reader = Pick<Database, 'select'>;
export async function canAccessProduct(
  db: Reader,
  userId: string,
  product: string | null,
  active = false,
) {
  const [member] = await db.select().from(user).where(eq(user.id, userId));
  if (!member || member.disabled || !product) return false;
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, product));
  if (!row || (active && row.archived)) return false;
  if (member.role === 'admin') return true;
  const [grant] = await db
    .select()
    .from(productMembers)
    .where(
      and(
        eq(productMembers.userId, userId),
        eq(productMembers.productId, product),
      ),
    );
  return !!grant;
}
