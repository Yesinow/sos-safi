// score.js — moteur de score « potentiel de buzz » (0-100), avec explication de chaque point.

import { normalize, tokenSet, similarity, hasWord } from './normalize.js';

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

/**
 * Nerf du projet : un sujet qui FAIT PARLER, pas seulement un sujet repris.
 *
 * La reprise mediatique mesure l'interet des redactions ; le debat mesure
 * l'envie de commenter. Un communique officiel repris par trente sites ne
 * declenche aucun commentaire, une facture d'eau qui augmente en declenche
 * trois cents. On note donc trois choses :
 *
 *   - les AXES qui divisent reellement l'opinion marocaine (pouvoir d'achat,
 *     ecole, sante, rente, identite, Sahara…) ; toucher deux axes vaut plus
 *     que marteler le meme ;
 *   - les MARQUEURS de dispute (جدل، انتقاد، يرد على) et de mise en cause ;
 *   - la FORME : une question ouverte et un chiffre donnent prise au debat,
 *     un verbe au passif administratif n'en donne aucune.
 */
function debateScore(cluster, cfg) {
  const text = `${cluster.title || ''} ${cluster.summary || ''}`;
  const hay = normalize(text);
  const title = normalize(cluster.title || '');

  // 1. Axes de fracture.
  //
  // Un seul mot croise au fil du resume ne fait pas un sujet : « رمضان » dans
  // un article sur la guerre de 1973, « المدرسة » dans un dossier sur le
  // handicap. On exige donc le mot DANS LE TITRE — ce dont parle vraiment le
  // sujet — ou, a defaut, deux mots distincts de l'axe dans le corps, et cet
  // axe-la ne compte alors que pour moitie.
  const axes = [];
  for (const [name, def] of Object.entries(cfg.debateAxes || {})) {
    if (name.startsWith('_') || !def.words) continue;
    const inTitle = def.words.find((w) => hasWord(title, w));
    const inBody = def.words.filter((w) => hasWord(hay, w));
    if (inTitle) axes.push({ name, weight: def.weight ?? 1, word: inTitle, where: 'title' });
    else if (inBody.length >= 2) {
      axes.push({ name, weight: (def.weight ?? 1) * 0.5, word: inBody[0], where: 'body' });
    }
  }
  const axisWeight = axes.reduce((a, x) => a + x.weight, 0);
  const axisPart = axes.length ? Math.sqrt(axisWeight) / Math.sqrt(3) : 0;
  const strongAxes = axes.filter((a) => a.where === 'title');

  // 2. Marqueurs de dispute.
  const markers = [];
  let markerWeight = 0;
  for (const [band, def] of Object.entries(cfg.debateMarkers || {})) {
    if (band.startsWith('_') || !def.words) continue;
    const hit = def.words.find((w) => hasWord(hay, w));
    if (hit) { markers.push({ band, word: hit }); markerWeight += def.weight ?? 1; }
  }
  const markerPart = Math.tanh(markerWeight / 1.6);

  // 3. Forme du titre : une question appelle une reponse, un chiffre appelle
  // une contestation. Les deux ensemble sont le format le plus commente.
  const asksQuestion = /[?؟]/.test(cluster.title || '');
  const hasFigure = /\d/.test(cluster.title || '') || /بالمئة|المرتبة|نسبة/.test(title);
  const namesSomeone = /\b(وزير|وزيرة|رئيس|مدير|عامل|رئيسة)\b/.test(cluster.title || '')
    || /(وزير|وزيرة|رئيس|رئيسة|مدير)/.test(title);
  const shapePart = (asksQuestion ? 0.5 : 0) + (hasFigure ? 0.3 : 0) + (namesSomeone ? 0.2 : 0);

  const raw = 0.5 * axisPart + 0.32 * markerPart + 0.18 * Math.min(1, shapePart);
  return {
    score: Math.min(1, raw),
    axes: axes.map((a) => a.name),
    strongAxes: strongAxes.map((a) => a.name),
    axisWords: axes.map((a) => a.word).slice(0, 3),
    markers: markers.map((m) => m.word).slice(0, 4),
    asksQuestion,
    hasFigure,
  };
}

/**
 * La ligne editoriale. Le but est la page qui vit du debat, pas du caniveau :
 * on paie le sujet qui divise, on ne paie pas le fait divers sordide, la
 * rumeur ni l'accusation sans corroboration. La penalite est multiplicative
 * et plancheee : elle fait reculer un sujet, elle ne l'efface pas — sauf les
 * mots bloques, ou l'on sort completement.
 */
function editorialGuard(cluster, cfg) {
  const g = cfg.editorialGuard || {};
  const hay = normalize(`${cluster.title || ''} ${cluster.summary || ''}`);
  const has = (list) => (list || []).find((w) => hasWord(hay, w));

  const blocked = has(g.blockWords);
  if (blocked) return { factor: 0, blocked, reasons: [`خارج الخط التحريري: «${blocked}»`] };

  let factor = 1;
  const reasons = [];

  const cheap = has(g.cheapWords);
  if (cheap) { factor *= g.cheapPenalty ?? 0.8; reasons.push(`صيغة رخيصة: «${cheap}»`); }

  const rumor = has(g.rumorWords);
  if (rumor) { factor *= g.rumorPenalty ?? 0.85; reasons.push(`صيغة إشاعة: «${rumor}»`); }

  // Une accusation nominative tenue par un seul site n'est pas une info :
  // c'est un risque. On la garde visible, on la fait reculer.
  const accusation = has(g.accusationWords);
  const minSrc = g.minSourcesForAccusation ?? 2;
  if (accusation && (cluster.sourceCount || 1) < minSrc) {
    factor *= 0.7;
    reasons.push(`اتهام بمصدر واحد («${accusation}») — خاصو تأكيد`);
  }

  return { factor: Math.max(g.floor ?? 0.55, factor), blocked: null, reasons };
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

  // 5. Fraicheur : demi-vie reglable (courte = on privilegie le tout frais)
  const halfLife = cfg.runtime.freshnessHalfLifeHours || 5;
  const ageH = Math.max(0, (now - cluster.lastDate) / HOUR);
  const freshness = Math.pow(0.5, ageH / halfLife);

  // 6. Affinite avec ta page
  const fit = pageFitScore(cluster, pageProfile);

  // 7. Potentiel de debat — le signal qui decide ce qui fait commenter.
  const debate = debateScore(cluster, cfg);
  const guard = editorialGuard(cluster, cfg);

  // Age median des articles du cluster : un sujet dont 40 articles sur 43 sont
  // parus dans les deux dernieres heures est « en train de sortir », meme si un
  // article annexe date d'hier. C'est plus juste que la premiere parution.
  const ages = cluster.members.map((m) => (now - m.date) / HOUR).sort((a, b) => a - b);
  const medianAgeH = ages.length ? ages[Math.floor(ages.length / 2)] : ageH;

  const parts = {
    trend: trend.score * W.trend,
    spread: spread * W.spread,
    velocity: velocity * W.velocity,
    emotion: emotion * W.emotion,
    freshness: freshness * W.freshness,
    pageFit: fit.score * W.pageFit,
    debate: debate.score * (W.debate ?? 0),
  };

  const cat = categorize(cluster, cfg);
  const boost = (cfg.categoryBoost || {})[cat] ?? 1;
  const trustFactor = 0.9 + 0.1 * (cluster.trust ?? 0.8);

  let total = Object.values(parts).reduce((a, b) => a + b, 0) * boost * trustFactor * guard.factor;

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
      medianAgeHours: Math.round(medianAgeH * 10) / 10,
      hotWords: lex.hits.filter((h) => h.band !== 'cold').map((h) => h.word).slice(0, 6),
      coldWords: lex.hits.filter((h) => h.band === 'cold').map((h) => h.word).slice(0, 3),
      pageTerms: fit.matched,
      repeated: repeated ? repeated.title : null,
      debateAxes: debate.axes,
      debateStrongAxes: debate.strongAxes,
      debateMarkers: debate.markers,
      asksQuestion: debate.asksQuestion,
      guardFactor: Math.round(guard.factor * 100) / 100,
      guardReasons: guard.reasons,
    },
    blocked: guard.blocked,
    why: explain({ trend, spread, velocity, emotion, freshness, fit, cluster, lex, repeated, ageH, debate, guard }),
  };
}

const AXIS_LABEL = {
  'معيشة': 'القدرة الشرائية', 'تعليم': 'التعليم', 'صحة': 'الصحة', 'فساد': 'الفساد والريع',
  'عدالة': 'العدالة', 'هوية': 'الهوية واللغة', 'دين': 'الدين والحريات', 'نساء': 'قضايا النساء',
  'هجرة': 'الهجرة', 'سيادة': 'الوحدة الترابية', 'رياضة_جدل': 'جدل رياضي', 'مرفق_عام': 'الخدمات العمومية',
};

function explain({ trend, spread, velocity, emotion, freshness, fit, cluster, lex, repeated, ageH, debate, guard }) {
  const r = [];
  if (debate && debate.axes.length) {
    const labels = debate.axes.map((a) => (AXIS_LABEL[a] || a) + (debate.strongAxes.includes(a) ? '' : ' (خلفية)'));
    const splits = debate.strongAxes.length > 1 ? ' — موضوع كيقسم' : '';
    r.push(`محور جدل: ${labels.join(' + ')}${splits}`);
  }
  if (debate && debate.markers.length) r.push(`خصومة فالخبر: ${debate.markers.join('، ')}`);
  if (debate && debate.asksQuestion) r.push('العنوان سؤال مفتوح — كيجر التعليقات');
  if (guard && guard.reasons.length) r.push(`⚖️ الحارس التحريري: ${guard.reasons.join(' · ')}`);
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
