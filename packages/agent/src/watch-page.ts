import { load } from 'cheerio';
import { fetchHtml } from './source-times.js';
export function watchPageText(html: string) {
  const $ = load(html);
  $('script,style,noscript,svg,nav,footer,header,form').remove();
  const root = $('main').first().length ? $('main').first() : $('body');
  root.find('br').replaceWith('\n');
  root.find('p,div,section,article,li,h1,h2,h3,h4,tr').append('\n');
  const text = root
    .text()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 30000);
  if (
    text.length < 40 ||
    /^(access denied|just a moment|verify you are human|enable javascript)/i.test(
      text,
    )
  )
    throw new Error('网页正文不可用，可能需要登录或动态加载；请手工补录');
  return text;
}
export async function collectWatchPage(url: string) {
  const html = await fetchHtml(url, AbortSignal.timeout(20000));
  return watchPageText(html);
}
