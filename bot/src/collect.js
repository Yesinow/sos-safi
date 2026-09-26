// collect.js — collecte parallele : flux directs + Google News + Google Trends Maroc.

import { getText, pool } from './http.js';
import { parseFeed, parseTrends } from './rss.js';

const GNEWS_SEARCH = 'https://news.google.com/rss/search';
const GNEWS_GEO = 'https://news.google.com/rss/headlines/section/geo';
const TRENDS = 'https://trends.google.com/trending/rss';

/**
 * Google News suffixe les titres par « - Nom du media », parfois EN DOUBLE
 * (« ... - Telexpresse - Telexpresse »). On retire toutes les occurrences.
 */
function splitGoogleTitle(title) {
  let text = String(title).trim();
  let source = null;
  for (let i = 0; i < 3; i++) {
    const m = text.match(/^(.*[^\s])\s+-\s+([^-]{2,40})$/);
    if (!m) break;
    const candidate = m[2].trim();
    // On ne coupe que si le suffixe ressemble a un nom de media (pas a la fin d'une phrase).
    if (candidate.split(/\s+/).length > 5) break;
    source = source || candidate;
    text = m[1].trim();
    if (candidate !== source) break; // suffixe different : on s'arrete apres le premier
  }
  return { title: text, source };
}

function cleanUrl(u = '') {
  try {
    const url = new URL(u);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'oc', 'amp'].forEach((p) => url.searchParams.delete(p));
    return url.toString();
  } catch { return u; }
}

function buildGoogleNewsUrls(cfg) {
  const g = cfg.googleNews;
  if (!g || !g.enabled) return [];
  const urls = [];
  if (g.geoSection) {
    urls.push({
      kind: 'gnews', name: 'Google News Maroc', cat: 'general', trust: 0.8,
      url: `${GNEWS_GEO}/${encodeURIComponent(g.geoSection)}?hl=${g.hl}&gl=${g.gl}&ceid=${encodeURIComponent(g.ceid)}`,
    });
  }
  for (const q of g.queries || []) {
    const hl = q.hl || g.hl;
    const ceid = q.ceid || g.ceid;
    urls.push({
      kind: 'gnews', name: `Google News: ${q.q.slice(0, 28)}`, cat: q.cat || 'general', trust: 0.8,
      url: `${GNEWS_SEARCH}?q=${encodeURIComponent(`${q.q} when:1d`)}&hl=${hl}&gl=${g.gl}&ceid=${encodeURIComponent(ceid)}`,
    });
  }
  return urls;
}

/** Recupere tous les flux en parallele. Les sources en echec sont signalees, jamais bloquantes. */
export async function collectArticles(cfg, deadline, log) {
  const rt = cfg.runtime;
  const direct = (cfg.feeds || []).map((f) => ({ ...f, kind: 'feed' }));
  const targets = [...direct, ...buildGoogleNewsUrls(cfg)];

  const maxAgeMs = rt.maxAgeHours * 3600 * 1000;
  const now = Date.now();
  const articles = [];
  const diag = { ok: 0, failed: [], totalRaw: 0 };

  await pool(targets, rt.concurrency, async (t) => {
    const res = await getText(t.url, { timeoutMs: rt.fetchTimeoutMs, userAgent: rt.userAgent, deadline });
    if (!res.ok) {
      diag.failed.push({ name: t.name, error: res.error, optional: !!t.optional });
      return;
    }
    const items = parseFeed(res.body);
    if (!items.length) {
      diag.failed.push({ name: t.name, error: 'flux vide', optional: !!t.optional });
      return;
    }
    diag.ok++;
    diag.totalRaw += items.length;

    for (const it of items) {
      const date = it.date ?? now;
      if (now - date > maxAgeMs) continue;
      if (date > now + 6 * 3600 * 1000) continue; // date manifestement fausse
      const split = t.kind === 'gnews' ? splitGoogleTitle(it.title) : { title: it.title, source: null };
      articles.push({
        title: split.title,
        link: cleanUrl(it.link),
        date,
        summary: it.summary,
        image: it.image,
        source: split.source || it.sourceHint || t.name,
        feed: t.name,
        via: t.kind,
        cat: t.cat || 'general',
        trust: t.trust ?? 0.8,
        categories: it.categories || [],
      });
    }
  });

  log(`المصادر: ${diag.ok}/${targets.length} نجحت · ${articles.length} خبر ضمن آخر ${rt.maxAgeHours} ساعة`);
  const blocking = diag.failed.filter((f) => !f.optional);
  if (blocking.length) log(`تعذّر الوصول: ${blocking.map((f) => `${f.name} (${f.error})`).join(' · ')}`);
  return { articles, diag };
}

/** Google Trends Maroc : le vrai pouls de ce que les gens cherchent maintenant. */
export async function collectTrends(cfg, deadline, log) {
  if (!cfg.trends || !cfg.trends.enabled) return [];
  const rt = cfg.runtime;
  const url = `${TRENDS}?geo=${encodeURIComponent(cfg.trends.geo || 'MA')}`;
  const res = await getText(url, { timeoutMs: rt.fetchTimeoutMs, userAgent: rt.userAgent, deadline });
  if (!res.ok) {
    log(`Google Trends غير متاح (${res.error}) — سيتم الاعتماد على باقي المؤشرات`);
    return [];
  }
  const trends = parseTrends(res.body);
  log(`Google Trends المغرب: ${trends.length} موضوع رائج (أعلى بحث: ${trends[0] ? trends[0].traffic.toLocaleString() : 0})`);
  return trends;
}
