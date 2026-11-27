import { describe, expect, it } from 'vitest';
import { readCreatorCsv } from './creator-csv.js';

describe('creator CSV parsing', () => {
  it('validates mixed rows, handles UTF-8 BOM and quoted fields, and preserves line numbers', () => {
    const rows = readCreatorCsv(
      [
        '\uFEFFlink,name,email',
        'http://EXAMPLE.com/creator/?utm_medium=csv,"名称,',
        '""第二行""",CONTACT@example.com',
        'https://example.com/creator#profile,,',
        'invalid,,',
        'https://example.com/second,,wrong',
        'https://example.com/third,short',
      ].join('\r\n'),
    );
    expect(rows.map(({ result }) => [result.line, result.status])).toEqual([
      [2, 'valid'],
      [4, 'valid'],
      [5, 'failed'],
      [6, 'failed'],
      [7, 'failed'],
    ]);
    expect(rows[0]?.input).toMatchObject({
      link: 'http://EXAMPLE.com/creator/?utm_medium=csv',
      normalizedLink: 'https://example.com/creator',
      email: 'contact@example.com',
      name: '名称,\n"第二行"',
    });
    expect(rows[1]?.input?.normalizedLink).toBe(rows[0]?.input?.normalizedLink);
    expect(rows[3]?.result.reason).toBe('邮箱格式无效');
    expect(rows[4]?.result.reason).toBe('列数与表头不一致');
  });

  it('reports malformed quotes without treating the affected row as a creator', () => {
    const rows = readCreatorCsv(
      'link,name\nhttps://example.com/one,"closed"junk\nhttps://example.com/two,"unclosed',
    );
    expect(rows.map(({ result }) => result.reason)).toEqual([
      'CSV 引号格式无效',
      'CSV 引号格式无效',
    ]);
  });

  it('rejects duplicate, unknown or missing headers', () => {
    for (const csv of [
      'link,link\n1,2',
      'link,unknown\n1,2',
      'email\na@example.com',
    ])
      expect(() => readCreatorCsv(csv)).toThrow('CSV 表头');
  });
});
