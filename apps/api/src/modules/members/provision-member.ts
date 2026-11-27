import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { auth, growth, catalog, type Database } from '@guangmo/database';
import type { Role } from '@guangmo/contracts';
export async function provisionMember(
  db: Database,
  input: {
    name: string;
    email: string;
    password: string;
    role: Role;
    productIds?: string[];
  },
  actorId?: string,
) {
  const password = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const id = randomUUID();
    const [member] = await tx
      .insert(auth.user)
      .values({
        id,
        name: input.name,
        email: input.email.toLowerCase(),
        role: input.role,
      })
      .returning({
        id: auth.user.id,
        name: auth.user.name,
        email: auth.user.email,
        role: auth.user.role,
      });
    if (input.productIds?.length)
      await tx.insert(catalog.productMembers).values(
        [...new Set(input.productIds)].map((productId) => ({
          productId,
          userId: id,
        })),
      );
    await tx.insert(auth.account).values({
      id: randomUUID(),
      accountId: id,
      userId: id,
      providerId: 'credential',
      password,
    });
    await tx.insert(growth.auditLog).values({
      actorId,
      action: 'member.created',
      objectId: id,
      details: { role: input.role },
    });
    return member;
  });
}
