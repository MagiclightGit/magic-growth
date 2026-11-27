import { describe, expect, it } from 'vitest';
import { parseFeed } from './feed.js';

describe('feed parsing', () => {
  it('keeps RSS evidence and the publisher date, and filters non-web links', () => {
    const feed = parseFeed(
      `<rss><channel>
      <item><title>First story</title><link>/story</link>
        <pubDate>Mon, 23 Nov 2026 08:00:30 +0000</pubDate>
        <description><![CDATA[<p>Published excerpt</p><script>ignored</script>]]></description>
      </item>
      <item><title>Rejected link</title><link>javascript:alert(1)</link></item>
    </channel></rss>`,
      'https://example.org/feed',
    );
    expect(feed.items).toEqual([
      {
        title: 'First story',
        url: 'https://example.org/story',
        publishedAt: '2026-11-23T08:00:30.000Z',
        evidence: 'Published excerpt',
      },
    ]);
    expect(feed.discovered).toBe(2);
  });

  it('does not use an Atom update date as a publication date', () => {
    const feed = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>Second story</title>
      <updated>2026-11-23T08:00:00Z</updated>
      <link rel="self" href="/api/story"/><link rel="alternate" href="/story"/>
    </entry></feed>`,
      'https://example.org/feed',
    );
    expect(feed.items).toEqual([
      {
        title: 'Second story',
        url: 'https://example.org/story',
        publishedAt: null,
        evidence: '',
      },
    ]);
    expect(() =>
      parseFeed('<html>Access denied</html>', 'https://example.org'),
    ).toThrow();
  });
});
