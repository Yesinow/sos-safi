// watch.js — mots-cles sous surveillance : un sujet de la liste passe AVANT tout,
// quelle que soit sa note, et saute la porte virale. Pour le remaniement
// gouvernemental on tente en plus d'extraire les couples nom / portefeuille.

import { normalize } from './normalize.js';
import { getText, pool } from './http.js';

const HOUR = 3600 * 1000;

/** Un sujet correspond-il a une entree de la liste ? */
function matchEntry(text, entry) {
  const hay = normalize(text);
  const hit = (list) => (list || []).filter((k) => hay.includes(normalize(k)));
  const keywords = hit(entry.keywords);
  if (!keywords.length) return null;
  return { keywords, confirms: hit(entry.confirmKeywords) };
}

/**
 * Les deux formes d'un sujet traversent le pipeline : l'objet interne
 * `{ cluster, score, signals }` avant la mise en forme, et l'objet aplati du
 * rapport. La veille doit fonctionner sur les deux, d'ou cet accesseur.
 */
function fieldsOf(item) {
  const c = item.cluster || item;
  return {
    text: `${c.title || ''} ${c.summary || ''}`,
    publishedAt: c.lastDate ?? item.publishedAt ?? 0,
    sourceCount: item.signals?.sourceCount ?? c.sourceCount ?? 0,
  };
}

const linkOf = (item) => (item.cluster || item).link || '';
const isRedirect = (url) => /news\.google\.com/.test(url);

/**
 * Marque les sujets surveilles, en deux etages.
 *
 * Un sujet « confirme » contient en plus un mot de confirmation
 * (« التشكيلة النهائية », « تعيين أعضاء الحكومة », « أدى اليمين »…) : c'est
 * l'annonce elle-meme, elle part tout de suite et saute la porte virale.
 * Un sujet seulement surveille (les tractations, les analyses) passe devant
 * les autres dans le classement mais reste soumis a la porte : sinon une
 * journee de negociations suffit a remplir le telephone de dix depeches.
 */
export function applyWatchlist(items, cfg, now = Date.now()) {
  const list = (cfg.watchlist || []).filter((e) => e.enabled !== false);
  if (!list.length) return [];

  const matched = [];
  for (const item of items) {
    const f = fieldsOf(item);
    for (const entry of list) {
      const m = matchEntry(f.text, entry);
      if (!m) continue;
      if (entry.maxAgeHours && (now - f.publishedAt) / HOUR > entry.maxAgeHours) continue;
      if (entry.minSources && f.sourceCount < entry.minSources) continue;

      item.watch = {
        id: entry.id,
        label: entry.label || entry.id,
        keywords: m.keywords,
        confirmed: m.confirms.length > 0,
        confirms: m.confirms,
        promoted: false,
        bypassGate: false,
        extractMinisters: Boolean(entry.extractMinisters),
      };
      matched.push({ item, entry, f });
      break;
    }
  }

  // Les meilleurs d'abord : annonce confirmee, lien direct, large couverture.
  const rank = (a, b) => (Number(b.item.watch.confirmed) - Number(a.item.watch.confirmed))
    || (Number(isRedirect(linkOf(a.item))) - Number(isRedirect(linkOf(b.item))))
    || (b.f.sourceCount - a.f.sourceCount)
    || (b.item.score - a.item.score);

  const alerts = [];
  for (const entry of list) {
    const mine = matched.filter((x) => x.entry === entry).sort(rank);
    const maxPromoted = entry.maxPromoted ?? 3;
    const maxAlerts = entry.maxAlertsPerRun ?? 2;
    let alertCount = 0;

    mine.forEach((x, i) => {
      const w = x.item.watch;
      w.promoted = i < maxPromoted;
      // Une liste « fuitee » par un seul site n'est pas une annonce : tant que
      // la nouvelle n'est pas reprise ailleurs, elle reste un sujet surveille.
      const enoughSources = x.f.sourceCount >= (entry.minSourcesConfirmed ?? 2);
      if (w.confirmed && enoughSources && entry.bypassGate !== false && alertCount < maxAlerts) {
        w.bypassGate = true;
        alertCount++;
        // Seule l'annonce confirmee merite le plancher de note : gonfler la
        // note des tractations fausserait tout le classement du jour.
        if (entry.scoreFloor && x.item.score < entry.scoreFloor) {
          x.item.scoreBeforeWatch = x.item.score;
          x.item.score = entry.scoreFloor;
        }
        alerts.push(x.item);
      }
    });
  }
  return alerts;
}

// ── extraction nom / portefeuille ────────────────────────────────────────────

const PORTFOLIOS = [
  'الداخلية', 'الشؤون الخارجية', 'الخارجية', 'التعاون الإفريقي', 'العدل', 'الأوقاف والشؤون الإسلامية',
  'الاقتصاد والمالية', 'المالية', 'الميزانية', 'التربية الوطنية', 'التعليم الأولي والرياضة',
  'التعليم العالي', 'البحث العلمي', 'الصحة والحماية الاجتماعية', 'الصحة',
  'الفلاحة والصيد البحري', 'الفلاحة', 'التنمية القروية', 'المياه والغابات',
  'التجهيز والماء', 'التجهيز', 'النقل واللوجستيك', 'النقل',
  'الصناعة والتجارة', 'الصناعة', 'التجارة', 'الانتقال الطاقي والتنمية المستدامة', 'الطاقة',
  'الانتقال الرقمي وإصلاح الإدارة', 'الانتقال الرقمي', 'إعداد التراب الوطني',
  'التعمير والإسكان', 'الإسكان', 'سياسة المدينة', 'السياحة والصناعة التقليدية', 'السياحة',
  'الصناعة التقليدية', 'الاقتصاد الاجتماعي', 'الشباب والثقافة والتواصل', 'الشباب والرياضة',
  'الثقافة', 'التواصل', 'الاتصال', 'التضامن والإدماج الاجتماعي', 'الأسرة',
  'الإدماج الاقتصادي والمقاولة الصغرى', 'التشغيل', 'الكفاءات', 'التكوين المهني',
  'الاستثمار والالتقائية', 'الاستثمار', 'تقييم السياسات العمومية',
  'العلاقات مع البرلمان', 'الأمانة العامة للحكومة', 'حقوق الإنسان',
  'المغاربة المقيمين بالخارج', 'الشؤون القنصلية',
];

// Un nom de personne : 2 a 4 mots arabes. On rejette ce qui ressemble a une
// institution ou a du remplissage administratif.
const NAME = '([\\u0621-\\u064A]{2,}(?:\\s+[\\u0621-\\u064A]{2,}){1,3})';
const NAME_STOP = [
  'وزير', 'وزيرة', 'الوزير', 'الوزيرة', 'الحكومة', 'الحكومية', 'الملك', 'جلالة', 'المغرب', 'المغربية',
  'الجديد', 'الجديدة', 'الوطني', 'الوطنية', 'العام', 'العامة', 'رئيس', 'رئيسة', 'حزب', 'الحزب',
  'المجلس', 'البرلمان', 'الديوان', 'اليوم', 'أمس', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء',
  'الخميس', 'الجمعة', 'السبت', 'قطاع', 'القطاع', 'كتابة', 'الدولة', 'لدى', 'منتدب', 'منتدبة',
  'التي', 'الذي', 'هذا', 'هذه', 'كما', 'بعد', 'قبل', 'حول', 'بشأن', 'مصادر', 'تعيين', 'تشكيل',
  // Faux couples rencontres en production : « الصحة — ملفات نقابية تنتظر ».
  'ملفات', 'ملف', 'نقابية', 'نقابي', 'تنتظر', 'ينتظر', 'مشاورات', 'اجتماع', 'لقاء', 'تقرير',
  'مشروع', 'قانون', 'ميزانية', 'أزمة', 'قرار', 'بلاغ', 'إصلاح', 'حصيلة', 'أولويات', 'رهانات',
  'تحديات', 'سياسة', 'برنامج', 'لائحة', 'موعد', 'نسبة', 'أرقام', 'سؤال', 'جدل', 'خلاف',
];

// Du plus long au plus court : « الصحة والحماية الاجتماعية » doit etre teste
// avant « الصحة », sinon le portefeuille court avale un bout du nom.
PORTFOLIOS.sort((a, b) => b.length - a.length);

// Mots qui precedent souvent le nom dans une phrase et n'en font pas partie.
const TRIM_LEAD = [
  'و', 'كما', 'ثم', 'وقد', 'قد', 'حيث', 'بينما', 'أما', 'وأما',
  'جاء', 'جاءت', 'وجاء', 'وجاءت', 'عين', 'عُين', 'وعين', 'وعُين', 'تعيين',
  'أعلن', 'وأعلن', 'قال', 'وقال', 'أضاف', 'وأضاف', 'يتولى', 'ويتولى', 'تتولى',
  'السيد', 'السيدة', 'الأستاذ', 'الأستاذة', 'الدكتور', 'الدكتورة', 'المهندس',
  'في', 'لدى', 'مع', 'عن', 'إلى', 'من', 'هو', 'هي', 'كان', 'كانت',
];

/** Retire les mots de liaison en tete du nom capture. */
function trimName(raw) {
  let words = String(raw).trim().split(/\s+/);
  while (words.length > 2 && TRIM_LEAD.some((t) => normalize(t) === normalize(words[0]))) {
    words = words.slice(1);
  }
  return words.join(' ');
}

function plausibleName(raw) {
  const words = String(raw).trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  const norm = words.map(normalize);
  if (norm.some((w) => NAME_STOP.some((s) => w === normalize(s)))) return false;
  if (PORTFOLIOS.some((p) => normalize(raw).includes(normalize(p)))) return false;
  return words.every((w) => w.length >= 2);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AR = '\\u0621-\\u064A';

/**
 * Construit le motif d'un portefeuille. Deux pieges de l'arabe :
 *   - `\b` de JavaScript ne connait que l'ASCII : sur « الداخلية » il echoue.
 *     On borne donc avec des lookaround sur la plage des lettres arabes.
 *   - l'article se contracte apres la preposition : « الإسكان » devient
 *     « للإسكان », qui ne contient pas la chaine « الإسكان ». On accepte
 *     donc les prefixes ال / لل / ل devant le corps du mot.
 */
function portfolioPattern(p) {
  const body = esc(p.replace(/^ال/, ''));
  return `(?<![${AR}])(?:ال|لل|ل)?${body}(?![${AR}])`;
}

/**
 * Trois formes reellement utilisees par la presse marocaine :
 *   « وزير الداخلية عبد الوافي لفتيت »   (portefeuille puis nom)
 *   « عبد الوافي لفتيت وزيرا للداخلية »  (nom puis portefeuille)
 *   « الداخلية: عبد الوافي لفتيت »        (liste a deux colonnes)
 */
export function extractMinisters(text) {
  if (!text) return [];
  const clean = String(text).replace(/\s+/g, ' ');
  const found = new Map();
  const TITLE = '(?:وزير|وزيرة|كاتب الدولة|كاتبة الدولة)';
  // « الصحة: ملفات نقابية تنتظر » ressemble a un couple nom/poste alors que
  // c'est un chapeau d'article. La forme a deux-points n'est donc retenue que
  // lorsqu'elle se repete : une vraie liste gouvernementale aligne les postes.
  const listPairs = PORTFOLIOS.filter((p) =>
    new RegExp(`${portfolioPattern(p)}\\s*[:：–—]\\s*${NAME}`).test(clean)).length;
  const listForm = listPairs >= 2;

  for (const p of PORTFOLIOS) {
    const P = portfolioPattern(p);
    const patterns = [
      new RegExp(`${TITLE}[\\u064Bاة]?\\s+(?:منتدب[ةا]?\\s+)?(?:في|لدى)?\\s*${P}[^${AR}]{1,6}${NAME}`, 'g'),
      new RegExp(`${NAME}\\s+${TITLE}[\\u064Bاة]?\\s+(?:في|لدى)?\\s*${P}`, 'g'),
      ...(listForm ? [new RegExp(`${P}\\s*[:：–—]\\s*${NAME}`, 'g')] : []),
    ];
    for (const re of patterns) {
      for (const m of clean.matchAll(re)) {
        const name = trimName(m[1] || '');
        if (!plausibleName(name)) continue;
        const key = normalize(name);
        // Le portefeuille le plus long gagne : « الصحة والحماية الاجتماعية »
        // plutot que « الصحة ».
        const prev = found.get(key);
        if (!prev || p.length > prev.portfolio.length) found.set(key, { name, portfolio: p });
      }
    }
  }
  // Un portefeuille court peut avoir capture « والحماية الاجتماعية أمينة بنخضرا »
  // alors qu'une autre entree porte deja « أمينة بنخضرا » : on garde la courte.
  const all = [...found.values()];
  return all.filter((a) => !all.some((b) => b !== a
    && a.name.length > b.name.length
    && normalize(a.name).includes(normalize(b.name))));
}

/** Recupere le texte des articles du sujet et en extrait les noms. */
export async function harvestMinisters(item, cfg, deadline, log, articles = []) {
  const cluster = item.cluster || item;
  // Les titres suffisent rarement : la liste nom/portefeuille est dans le
  // corps de l'article. On lit donc plusieurs membres du sujet, en evitant
  // les liens de redirection Google, qui servent une page vide de texte.
  const own = [cluster.link, ...(cluster.members || []).map((m) => m.link), ...(item.extraLinks || [])];

  // Un sujet venu uniquement de Google News n'a aucun corps lisible. On va
  // alors chercher le meme sujet dans les flux directs deja collectes :
  // Hespress, Al3omk et les autres servent leur texte, eux.
  const keys = (item.watch?.keywords || []).map(normalize);
  const sameStory = keys.length
    ? articles.filter((a) => a.link && !isRedirect(a.link)
        && keys.some((k) => normalize(`${a.title} ${a.summary || ''}`).includes(k)))
      .map((a) => a.link)
    : [];

  const urls = [...new Set([...own, ...sameStory].filter((u) => u && !isRedirect(u)))].slice(0, 6);

  const found = new Map();
  const add = (list) => list.forEach((m) => found.set(normalize(m.name), m));

  add(extractMinisters(fieldsOf(item).text));
  if (!urls.length) return [...found.values()];

  await pool(urls, 3, async (url) => {
    if (deadline.expired(8000)) return;
    const res = await getText(url, { timeoutMs: 9000, userAgent: cfg.runtime.userAgent, deadline });
    if (!res.ok) return;
    const body = res.body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    add(extractMinisters(body.slice(0, 60000)));
  });

  const list = [...found.values()];
  if (log && list.length) log(`استُخرج ${list.length} اسم/منصب من نص المقالات`);
  return list;
}
