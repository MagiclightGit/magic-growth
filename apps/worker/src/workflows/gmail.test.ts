import { describe, expect, it } from 'vitest';
import { gmailRaw, isUnsubscribe, replyAddress } from './gmail.js';

describe('Gmail pilot message encoding', () => {
  it('keeps a fixed Message-ID and supplies the original threading headers for follow-ups', () => {
    const subject = '回访😀'.repeat(20);
    const raw = gmailRaw(
      {
        mailbox: 'pilot@example.com',
        recipient: 'recipient@example.com',
        subject,
        body: '正文\nsecond line',
      },
      '<followup@example.com>',
      '<original@example.com>',
    );
    const [headers, body] = Buffer.from(raw, 'base64url')
      .toString()
      .split('\r\n\r\n');
    expect(headers).toContain('\r\nMessage-ID: <followup@example.com>\r\n');
    expect(headers).toContain(
      '\r\nIn-Reply-To: <original@example.com>\r\nReferences: <original@example.com>\r\n',
    );
    const encodedWords = [...headers!.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
    expect(encodedWords.every(([word]) => word.length <= 75)).toBe(true);
    expect(
      encodedWords
        .map(([, word]) => Buffer.from(word!, 'base64').toString())
        .join(''),
    ).toBe(subject);
    expect(Buffer.from(body!, 'base64').toString()).toBe('正文\r\nsecond line');
  });

  it('matches the recipient address and recognizes explicit opt-out replies', () => {
    expect(replyAddress('"Test Recipient" <RECIPIENT@example.com>')).toBe(
      'recipient@example.com',
    );
    expect(isUnsubscribe('Please stop emailing me.')).toBe(true);
    expect(isUnsubscribe('退订！')).toBe(true);
    expect(isUnsubscribe('Can you explain how I can unsubscribe?')).toBe(false);
  });
});
