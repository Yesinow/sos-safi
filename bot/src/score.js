// score.js — moteur de score « potentiel de buzz » (0-100), avec explication de chaque point.

import { normalize, tokenSet, similarity } from './normalize.js';

const HOUR = 3600 * 1000;
const MIN_SHARED_TERMS = 2;   // deux mots en commun minimum pour parler de « meme sujet »
const MIN_TREND_SIM = 0.28;

/** Accord arabe du pluriel : 1 موقع · 2 موقعان · 3-10 مواقع · 11+ موقعا */
export function arPlural(n, { one, two, few, many }) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** Affine la categorie quand la source ne la donne pas. */
export function categorize(cluster, cfg) {
  if (cluster.cat && cluster.cat !== 'general') return cluster.cat;
  const hay = normalize(`${cluster.title} ${cluster.summary}`);
  let best = 'general', bestHits = 0;
  for (const [cat, words] of Object.entries(cfg.categoryKeywords || {})) {
    let hits = 0;
    for (const w of words) if (hay.includes(normalize(w))) hits++;
    if (hits > bestHits) { bestHits = hits; best = cat; }
  }
  return bestHits ? best : 'general';
}

function lexiconScore(text, lexicon) {
  const hay = normalize(text);
  let raw = 0;
  const hits = [];
  for (const [band, def] of Object.entries(lexicon || {})) {
    for (const w of def.words || []) {
      const n = normalize(w);
      if (n && hay.includes(n)) { raw += def.weight; hits.push({ word: w, band, weight: def.weight }); }
    }
  }
  return { raw, hits };
}

function sharedCount(a, b) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Correspondance avec ce que les Marocains cherchent MAINTENANT sur Google.
 * On compare au TITRE representatif, pas a l'union des titres du cluster :
 * un gros cluster finit sinon par contenir n'importe quel mot et matche tout.
 * On exige aussi au moins deux mots en commun.
 */
function trendScore(cluster, trends) {
  if (!trends || !trends.length) return { score: 0, matched: null };
  const base = cluster.repTokens && cluster.repTokens.size ? cluster.repTokens : cluster.tokens;
  const maxTraffic = Math.max(...trends.map((t) => t.traffic), 1);
  let best = 0, matched = null;

  for (const t of trends) {
    let sim = 0;
    const candidates = [tokenSet(t.query), ...(t.news || []).slice(0, 4).map((n) => tokenSet(n.title))];
    for (let i = 0; i < candidates.length; i++) {
      const set = candidates[i];
      if (sharedCount(base, set) < MIN_SHARED_TERMS) continue;
      const raw = similarity(base, set) * (i === 0 ? 1 : 0.9);
      if (raw > sim) sim = raw;
    }
    if (sim < MIN_TREND_SIM) continue;
    const volume = Math.log10(t.traffic + 10) / Math.log10(maxTraffic + 10);
    const s = sim * (0.45 + 0.55 * volume);
    if (s > best) { best = s; matched = t; }
  }
  return { score: Math.min(1, best * 1.35), matched };
}

/** Apprentissage depuis la page Facebook : les mots qui ont deja fait reagir TON audience. */
function pageFitScore(cluster, pageProfile) {
  if (!pageProfile || !pageProfile.terms || !pageProfile.terms.size) return { score: 0, matched: [] };
  const matched = [];
  let sum = 0;
  for (const t of cluster.tokens) {
    const w = pageProfile.terms.get(t);
    if (w) { sum += w; matched.push(t); }
  }
  if (!sum) return { score: 0, matched: [] };
  return { score: Math.min(1, sum / (pageProfile.scale || 1)), matched: matched.slice(0, 5) };
}

export function scoreCluster(cluster, ctx) {
  const { cfg, trends, pageProfile, history, now = Date.now() } = ctx;
  const W = cfg.weights;

  // 1. Tendance de recherche reelle
  const trend = trendScore(cluster, trends);

  // 2. Propagation : combien de medias distincts reprennent l'histoire
  const spread = 1 - Math.exp(-(Math.max(1, cluster.sourceCount) - 1) / 2.5);

  // 3. Vitesse : articles par heure depuis la premiere publication
  const spanH = Math.max(0.5, (cluster.lastDate - cluster.firstDate) / HOUR);
  const perHour = cluster.count / spanH;
  const velocity = 1 - Math.exp(-perHour / 3);

  // 4. Charge emotionnelle du titre
  const lex = lexiconScore(`${cluster.title} ${cluster.summary}`, cfg.lexicon);
  const emotion = Math.max(0, Math.tanh(lex.raw / 5));

  // 5. Fraicheur (demi-vie 5h)
  const ageH = Math.max(0, (now - cluster.lastDate) / HOUR);
  const freshness = Math.pow(0.5, ageH / 5);

  // 6. Affinite avec ta page
  const fit = pageFitScore(cluster, pageProfile);

  const parts = {
    trend: trend.score * W.trend,
    spread: spread * W.spread,
    velocity: velocity * W.velocity,
    emotion: emotion * W.emotion,
    freshness: freshness * W.freshness,
    pageFit: fit.score * W.pageFit,
  };

  const cat = categorize(cluster, cfg);
  const boost = (cfg.categoryBoost || {})[cat] ?? 1;
  const trustFactor = 0.9 + 0.1 * (cluster.trust ?? 0.8);

  let total = Object.values(parts).reduce((a, b) => a + b, 0) * boost * trustFactor;

  // Penalite : sujet deja publie recemment
  let repeated = null;
  if (history && history.length) {
    const limit = now - (cfg.repeatPenaltyHours || 48) * HOUR;
    for (const h of history) {
      if (h.at < limit) continue;
      const s = similarity(cluster.tokens, tokenSet(h.title));
      if (s >= 0.45) { repeated = h; total *= 0.25; break; }
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(total)));

  return {
    score,
    cat,
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    signals: {
      trendQuery: trend.matched ? trend.matched.query : null,
      trendTraffic: trend.matched ? trend.matched.traffic : 0,
      sourceCount: cluster.sourceCount,
      articlesPerHour: Math.round(perHour * 10) / 10,
      ageHours: Math.round(ageH * 10) / 10,
      hotWords: lex.hits.filter((h) => h.band !== 'cold').map((h) => h.word).slice(0, 6),
      coldWords: lex.hits.filter((h) => h.band === 'cold').map((h) => h.word).slice(0, 3),
      pageTerms: fit.matched,
      repeated: repeated ? repeated.title : null,
    },
    why: explain({ trend, spread, velocity, emotion, freshness, fit, cluster, lex, repeated, ageH }),
  };
}

function explain({ trend, spread, velocity, emotion, freshness, fit, cluster, lex, repeated, ageH }) {
  const r = [];
  if (trend.score > 0.25 && trend.matched) {
    r.push(`رائج في بحث Google المغرب: «${trend.matched.query}» (${trend.matched.traffic.toLocaleString()}+ بحث)`);
  }
  if (cluster.sourceCount >= 3) {
    r.push(`${arPlural(cluster.sourceCount, { one: 'موقع', two: 'موقعان', few: 'مواقع', many: 'موقعًا' })} نشرت نفس الخبر — إشارة انتشار قوية`);
  } else if (cluster.sourceCount === 2) r.push('موقعان نشرا الخبر');
  else r.push('مصدر واحد فقط — تحقّق قبل النشر');
  if (velocity > 0.5) r.push(`إيقاع سريع: ${Math.round(cluster.count / Math.max(0.5, (cluster.lastDate - cluster.firstDate) / 3600000) * 10) / 10} مقال/ساعة`);
  const hot = lex.hits.filter((h) => h.band !== 'cold').map((h) => h.word).slice(0, 4);
  if (hot.length) r.push(`كلمات تثير التفاعل: ${hot.join('، ')}`);
  const cold = lex.hits.filter((h) => h.band === 'cold').map((h) => h.word);
  if (cold.length) r.push(`تحذير: صيغة إدارية باردة (${cold.join('، ')})`);
  if (ageH < 2) r.push('طازج (أقل من ساعتين)');
  else if (ageH > 10) r.push(`قديم نسبيًا (${Math.round(ageH)} ساعة)`);
  if (fit.score > 0.2) r.push(`يشبه مواضيع نجحت سابقًا في صفحتك (${fit.matched.join('، ')})`);
  if (repeated) r.push(`سبق أن نشرت موضوعًا مشابهًا: «${repeated.title.slice(0, 50)}…» — النقطة مخفّضة`);
  return r;
}
