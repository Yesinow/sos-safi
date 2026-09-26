// rss.js — parseur RSS/Atom minimaliste (regex), suffisant pour des flux de presse.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–' };

export function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in NAMED ? NAMED[n] : m));
}
function safeChar(code) {
  try { return Number.isFinite(code) ? String.fromCodePoint(code) : ''; } catch { return ''; }
}

export function stripTags(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Contenu du premier <tag>…</tag> (namespace toléré). */
function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}
function attrOf(block, name, attr) {
  const re = new RegExp(`<${name}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : '';
}
function allTags(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi');
  return [...block.matchAll(re)].map((m) => m[1]);
}

function blocks(xml) {
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (items.length) return items;
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
}

function pickLink(b) {
  const plain = stripTags(tag(b, 'link'));
  if (plain && /^https?:/i.test(plain)) return plain;
  const href = attrOf(b, 'link', 'href');
  if (href) return href;
  const guid = stripTags(tag(b, 'guid'));
  return /^https?:/i.test(guid) ? guid : '';
}

function pickImage(b) {
  return attrOf(b, 'media:content', 'url')
    || attrOf(b, 'media:thumbnail', 'url')
    || attrOf(b, 'enclosure', 'url')
    || (stripTags(tag(b, 'description')) && (tag(b, 'description').match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1])
    || '';
}

function pickDate(b) {
  const raw = stripTags(tag(b, 'pubDate')) || stripTags(tag(b, 'published')) || stripTags(tag(b, 'updated')) || stripTags(tag(b, 'dc:date'));
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Parse un flux RSS/Atom -> [{title, link, date, summary, image, categories}] */
export function parseFeed(xml) {
  if (!xml || !/<(item|entry)\b/i.test(xml)) return [];
  return blocks(xml).map((b) => ({
    title: stripTags(tag(b, 'title')),
    link: pickLink(b),
    date: pickDate(b),
    summary: stripTags(tag(b, 'description') || tag(b, 'content:encoded') || tag(b, 'summary') || tag(b, 'content')).slice(0, 400),
    image: pickImage(b),
    categories: allTags(b, 'category').map(stripTags).filter(Boolean).slice(0, 5),
    sourceHint: stripTags(tag(b, 'source')),
  })).filter((it) => it.title);
}

/** Parse le flux Google Trends (contient ht:approx_traffic et ht:news_item_*). */
export function parseTrends(xml) {
  if (!xml) return [];
  return blocks(xml).map((b) => {
    const trafficRaw = stripTags(tag(b, 'ht:approx_traffic'));
    const traffic = parseInt(String(trafficRaw).replace(/[^\d]/g, ''), 10) || 0;
    return {
      query: stripTags(tag(b, 'title')),
      traffic,
      date: pickDate(b),
      picture: stripTags(tag(b, 'ht:picture')),
      news: allTags(b, 'ht:news_item').map((n) => ({
        title: stripTags(tag(n, 'ht:news_item_title')),
        url: stripTags(tag(n, 'ht:news_item_url')),
        source: stripTags(tag(n, 'ht:news_item_source')),
      })).filter((n) => n.title),
    };
  }).filter((t) => t.query);
}

/** Extrait og:image / og:title d'une page HTML (pour enrichir les posts). */
export function parseOpenGraph(html = '') {
  const grab = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
    const m = html.match(re) || html.match(re2);
    return m ? decodeEntities(m[1]) : '';
  };
  return {
    image: grab('og:image') || grab('twitter:image'),
    title: grab('og:title'),
    description: grab('og:description') || grab('description'),
    site: grab('og:site_name'),
  };
}
