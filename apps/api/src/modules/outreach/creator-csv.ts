import {
  creatorInput,
  normalizeCreatorLink,
  type CsvRow,
} from '@guangmo/contracts';
import type { z } from 'zod';

type CreatorInput = z.infer<typeof creatorInput>;
type ParsedRow = { line: number; cells: string[]; malformed: boolean };
export type ImportRow = {
  result: CsvRow;
  input?: CreatorInput & { normalizedLink: string };
};

export function readCreatorCsv(csv: string): ImportRow[] {
  const records = readRecords(
    csv.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'),
  );
  const header = records.shift();
  const columns = header?.cells.map((cell) => cell.trim().toLowerCase()) ?? [];
  if (
    header?.malformed ||
    !columns.includes('link') ||
    new Set(columns).size !== columns.length ||
    columns.some((column) => !['link', 'name', 'email'].includes(column))
  )
    throw new Error(
      'CSV 表头须包含 link，可附加 name 和 email，每列只能出现一次',
    );
  if (!records.length || records.length > 500)
    throw new Error('CSV 须包含 1 至 500 条数据行');

  return records.map(({ line, cells, malformed }) => {
    const link = cells[columns.indexOf('link')]?.trim() ?? '';
    const result = { line, link };
    if (malformed || cells.length !== columns.length)
      return {
        result: {
          ...result,
          status: 'failed',
          reason: malformed ? 'CSV 引号格式无效' : '列数与表头不一致',
        },
      };
    const parsed = creatorInput.safeParse({
      link,
      name: cells[columns.indexOf('name')]?.trim(),
      email: cells[columns.indexOf('email')]?.trim(),
    });
    if (!parsed.success)
      return {
        result: {
          ...result,
          status: 'failed',
          reason: parsed.error.issues
            .map((issue) =>
              issue.path[0] === 'email' ? '邮箱格式无效' : issue.message,
            )
            .join('；'),
        },
      };
    return {
      result: { ...result, status: 'valid' },
      input: { ...parsed.data, normalizedLink: normalizeCreatorLink(link)! },
    };
  });
}

function readRecords(csv: string) {
  const records: ParsedRow[] = [];
  let cells: string[] = [];
  let field = '';
  let state: 'field' | 'quoted' | 'closed' = 'field';
  let malformed = false;
  let line = 1;
  let start = 1;
  for (let index = 0; index <= csv.length; index++) {
    const char = csv[index];
    if (state === 'quoted' && char !== undefined) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') state = 'closed';
      else field += char;
      if (char === '\n') line++;
    } else if (char === '\n' || char === undefined) {
      if (cells.length || field.trim() || malformed || state !== 'field')
        records.push({
          line: start,
          cells: [...cells, field],
          malformed: malformed || state === 'quoted',
        });
      cells = [];
      field = '';
      state = 'field';
      malformed = false;
      start = ++line;
    } else if (char === ',') {
      cells.push(field);
      field = '';
      state = 'field';
    } else if (char === '"' && !field && state === 'field') {
      state = 'quoted';
    } else {
      if (state === 'closed' || char === '"') malformed = true;
      field += char;
    }
  }
  return records;
}
