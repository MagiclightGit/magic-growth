import { load } from 'cheerio';
import { webUrl } from '@guangmo/contracts';
import { fetchSource, normalizeSourceDate } from './source-times.js';

function feedDate(value: string) {
  const iso = normalizeSourceDate(value);
  if (iso) return iso;
  // RSS permits RFC 822 dates; require an explicit zone when deriving an instant.
  if (
    !/\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC|[+-]\d{4})$/i.test(
      value,
    )
  )
    return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}

function plain(value: string) {
  const html = load(value, {}, false);
  html('script, style, iframe').remove();
  return html.root().text().replace(/\s+/g, ' ').trim();
}

export function parseFeed(xml: string, feedUrl: string) {
  const $ = load(xml, { xml: true });
  const atom = $(':root').is('feed');
  if (!atom && !$('rss > channel').length)
    throw new Error('Invalid feed document');
  const entries = atom ? $('feed > entry') : $('rss > channel > item');
  const items = entries
    .slice(0, 50)
    .toArray()
    .flatMap((entry) => {
      const node = $(entry);
      const title = plain(node.children('title').first().text()).slice(0, 200);
      const link = atom
        ? node
            .children('link')
            .filter(
              (_i, tag) =>
                !$(tag).attr('rel') || $(tag).attr('rel') === 'alternate',
            )
            .first()
            .attr('href')
        : node.children('link').first().text();
      if (!link?.trim() || title.length < 2) return [];
      let url: URL;
      try {
        url = new URL(link.trim(), feedUrl);
      } catch {
        return [];
      }
      if (
        url.username ||
        url.password ||
        !webUrl.safeParse(url.href).success ||
        url.href.length > 2048
      )
        return [];
      const evidence = plain(
        node
          .children(atom ? 'summary' : 'description')
          .first()
          .text(),
      ).slice(0, 480);
      const publishedAt = feedDate(
        node
          .children(atom ? 'published' : 'pubDate')
          .first()
          .text()
          .trim(),
      );
      return [{ title, url: url.href, evidence, publishedAt }];
    });
  return {
    items,
    discovered: entries.length,
    inspected: Math.min(entries.length, 50),
  };
}

export async function collectFeed(url: string, signal: AbortSignal) {
  return parseFeed(await fetchSource(url, signal, 'feed'), url);
}
