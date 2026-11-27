import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { load } from 'cheerio';
import {
  canonicalizeUrl,
  informationDate,
  type CandidateInput,
  type SourceTime,
} from '@guangmo/contracts';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('3fff::', 20, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return (
    family === 6 &&
    globalV6.check(address, 'ipv6') &&
    !blocked.check(address, 'ipv6')
  );
}

async function resolveSource(hostname: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([lookup(hostname, { all: true }), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// DNS is resolved and checked before each hop; the checked address is pinned to
// the socket lookup so redirects and DNS rebinding cannot reach internal hosts.
export function fetchHtml(raw: string, signal: AbortSignal) {
  return fetchSource(raw, signal, 'html');
}

export async function fetchSource(
  raw: string,
  signal: AbortSignal,
  format: 'html' | 'feed',
  redirects = 0,
): Promise<string> {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))
  )
    throw new Error('Unsupported source URL');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolveSource(hostname, signal);
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error('Source address is not public');
  signal.throwIfAborted();
  const pinned = addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        signal,
        headers: {
          'user-agent': 'GuangmoGrowth/1.0 (source metadata)',
          accept:
            format === 'html'
              ? 'text/html,application/xhtml+xml'
              : 'application/rss+xml,application/atom+xml,application/xml,text/xml',
          'accept-encoding': 'identity',
        },
        lookup: (_hostname, options, callback) => {
          if (options.all)
            callback(null, [
              { address: pinned.address, family: pinned.family },
            ]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          response.resume();
          if (!response.headers.location || redirects >= 3)
            return reject(new Error('Too many redirects'));
          void fetchSource(
            new URL(response.headers.location, url).href,
            signal,
            format,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        const contentType = response.headers['content-type'] ?? '';
        const supported =
          format === 'html'
            ? /text\/html|application\/xhtml\+xml/i.test(contentType)
            : /^(?:application\/(?:rss\+xml|atom\+xml|xml)|text\/xml)(?:;|$)/i.test(
                contentType,
              );
        if (response.statusCode !== 200 || !supported) {
          response.resume();
          reject(
            new Error(
              response.statusCode !== 200
                ? `Source HTTP ${response.statusCode ?? 'unknown'}`
                : 'Unexpected source content type',
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_500_000)
            response.destroy(new Error('Source response too large'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf8')),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

export function normalizeSourceDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (informationDate.safeParse(raw).success) return raw;
  // A timezone-free timestamp only establishes a calendar date.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw))
    return informationDate.safeParse(raw.slice(0, 10)).success
      ? raw.slice(0, 10)
      : null;
  return null;
}
type Node = Record<string, unknown>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  const node = value as Node;
  return [node, ...nodes(node['@graph']), ...nodes(node.mainEntity)];
}
export function parseSourceTimes(html: string) {
  const $ = load(html);
  const data: Node[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      data.push(...nodes(JSON.parse($(element).text())));
    } catch {
      /* malformed metadata is not evidence */
    }
  });
  const types = (node: Node) => [node['@type']].flat().map(String);
  const articles = data.filter((node) =>
    types(node).some((type) =>
      /^(Article|NewsArticle|BlogPosting|WebPage|Event|\w+Event)$/.test(type),
    ),
  );
  const meta = (names: string[]) => {
    for (const name of names) {
      const date = normalizeSourceDate(
        $(
          `meta[property="${name}"],meta[name="${name}"],meta[itemprop="${name}"]`,
        )
          .first()
          .attr('content'),
      );
      if (date) return date;
    }
    return null;
  };
  const field = (key: string) =>
    articles.map((node) => normalizeSourceDate(node[key])).find(Boolean) ??
    null;
  const events = data.filter((node) =>
    types(node).some((type) => /^(Event|\w+Event)$/.test(type)),
  );
  // A list of multiple events is ambiguous; never attach a random event date.
  const event = events.length === 1 ? events[0] : undefined;
  const eventStartsAt = normalizeSourceDate(event?.startDate);
  const end = normalizeSourceDate(event?.endDate);
  return {
    publishedAt:
      meta(['article:published_time', 'datePublished']) ??
      field('datePublished'),
    modifiedAt:
      meta(['article:modified_time', 'dateModified']) ?? field('dateModified'),
    eventStartsAt,
    eventEndsAt:
      end && (!eventStartsAt || end.slice(0, 10) >= eventStartsAt.slice(0, 10))
        ? end
        : null,
  };
}
export async function collectSourceTime(url: string): Promise<SourceTime> {
  const fetchedAt = new Date().toISOString();
  try {
    const html = await fetchHtml(url, AbortSignal.timeout(12_000));
    return { url, fetchedAt, status: 'ok', ...parseSourceTimes(html) };
  } catch {
    return {
      url,
      fetchedAt,
      status: 'unavailable',
      publishedAt: null,
      modifiedAt: null,
      eventStartsAt: null,
      eventEndsAt: null,
    };
  }
}
export async function enrichCandidateTimes(
  candidates: CandidateInput[],
): Promise<CandidateInput[]> {
  const urls = [
    ...new Map(
      candidates
        .flatMap((candidate) => candidate.sources)
        .map(({ url }) => [canonicalizeUrl(url), url]),
    ).values(),
  ].slice(0, 10);
  const times = new Map<string, SourceTime>();
  for (let i = 0; i < urls.length; i += 3) {
    const batch = await Promise.all(
      urls.slice(i, i + 3).map(collectSourceTime),
    );
    for (const value of batch) times.set(canonicalizeUrl(value.url), value);
  }
  return candidates.map((candidate) => {
    const sourceTimes = candidate.sources
      .map(({ url }) => times.get(canonicalizeUrl(url)))
      .filter((value): value is SourceTime => !!value);
    // Primary source metadata must not be borrowed from an unrelated secondary page.
    const primary = times.get(canonicalizeUrl(candidate.sources[0]!.url));
    return {
      ...candidate,
      sourceTimes,
      publishedAt: primary?.publishedAt ?? candidate.publishedAt,
      eventStartsAt: candidate.eventStartsAt ?? primary?.eventStartsAt ?? null,
      eventEndsAt: candidate.eventEndsAt ?? primary?.eventEndsAt ?? null,
    };
  });
}
