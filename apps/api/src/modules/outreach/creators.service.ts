import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { outreach } from '@guangmo/database';
import {
  normalizeCreatorLink,
  type creatorInput,
  type creatorCsv,
  type CsvRow,
} from '@guangmo/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../../platform/database.module.js';
import { readCreatorCsv } from './creator-csv.js';

const { batches, creators } = outreach;
const creatorFields = {
  id: creators.id,
  link: creators.link,
  name: creators.name,
  email: creators.email,
  batchId: creators.batchId,
  createdAt: creators.createdAt,
};

@Injectable()
export class CreatorsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  list(product: string, before?: string) {
    const db = this.database.db;
    return db
      .select(creatorFields)
      .from(creators)
      .where(
        and(
          eq(creators.product, product),
          before
            ? sql`(${creators.createdAt}, ${creators.id}) < (
          select cursor.created_at, cursor.id from outreach_creators cursor
          where cursor.product = ${product} and cursor.id = ${before}
        )`
            : undefined,
        ),
      )
      .orderBy(desc(creators.createdAt), desc(creators.id))
      .limit(50);
  }

  batch(product: string, id: string) {
    return this.database.db
      .select()
      .from(batches)
      .where(and(eq(batches.product, product), eq(batches.id, id)));
  }

  create(
    product: string,
    actorId: string,
    input: z.infer<typeof creatorInput>,
  ) {
    const normalizedLink = normalizeCreatorLink(input.link)!;
    return this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(creators)
        .values({ ...input, normalizedLink, product, actorId })
        .onConflictDoNothing({
          target: [creators.product, creators.normalizedLink],
        })
        .returning(creatorFields);
      if (created) return { duplicate: false, creator: created };
      const [creator] = await tx
        .select(creatorFields)
        .from(creators)
        .where(
          and(
            eq(creators.product, product),
            eq(creators.normalizedLink, normalizedLink),
          ),
        );
      return { duplicate: true, creator };
    });
  }

  async import(
    product: string,
    actorId: string,
    file: z.infer<typeof creatorCsv>,
    preview: boolean,
  ) {
    let parsed: ReturnType<typeof readCreatorCsv>;
    try {
      if (Buffer.byteLength(file.csv) > 48000)
        throw new Error('CSV 最大支持 48 KB');
      parsed = readCreatorCsv(file.csv);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '无法读取 CSV',
      );
    }

    return this.database.db.transaction(async (tx) => {
      const links = [
        ...new Map(
          parsed
            .flatMap(({ input }) =>
              input ? [[input.normalizedLink, input] as const] : [],
            )
            .reverse(),
        ).values(),
      ].sort((a, b) => a.normalizedLink.localeCompare(b.normalizedLink, 'en'));
      const [batch] = preview
        ? []
        : await tx
            .insert(batches)
            .values({ product, actorId, filename: file.filename, rows: [] })
            .returning();
      const created =
        batch && links.length
          ? await tx
              .insert(creators)
              .values(
                links.map((input) => ({
                  ...input,
                  product,
                  actorId,
                  batchId: batch.id,
                })),
              )
              .onConflictDoNothing({
                target: [creators.product, creators.normalizedLink],
              })
              .returning({ key: creators.normalizedLink, id: creators.id })
          : [];
      const createdKeys = new Set(created.map((row) => row.key));
      const existing = links.length
        ? await tx
            .select({ key: creators.normalizedLink, id: creators.id })
            .from(creators)
            .where(
              and(
                eq(creators.product, product),
                inArray(
                  creators.normalizedLink,
                  links.map((link) => link.normalizedLink),
                ),
              ),
            )
        : [];
      const byKey = new Map(existing.map((row) => [row.key, row.id]));
      const seen = new Set<string>();
      const rows = parsed.map(({ result, input }): CsvRow => {
        if (!input) return result;
        const key = input.normalizedLink;
        const creatorId = byKey.get(key);
        if (seen.has(key))
          return {
            ...result,
            creatorId,
            status: 'duplicate',
            reason: 'CSV 内链接重复',
          };
        seen.add(key);
        if (createdKeys.has(key))
          return { ...result, creatorId, status: 'created' };
        if (creatorId)
          return {
            ...result,
            creatorId,
            status: 'duplicate',
            reason: '产品内已有该链接',
          };
        return result;
      });
      if (batch)
        await tx.update(batches).set({ rows }).where(eq(batches.id, batch.id));
      return { id: batch?.id ?? null, filename: file.filename, rows };
    });
  }
}
