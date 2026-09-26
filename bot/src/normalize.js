// normalize.js — normalisation arabe/latine, tokenisation et similarite de titres.

const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalize(text = '') {
  return String(text)
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ -> ا
    .replace(/ى/g, 'ي')                     // ى -> ي
    .replace(/ة/g, 'ه')                     // ة -> ه
    .replace(/ؤ/g, 'و')                     // ؤ -> و
    .replace(/ئ/g, 'ي')                     // ئ -> ي
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents latins
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(`
من في على عن الى الي مع هذا هذه ذلك التي الذي ما لا ان اذا كما بعد قبل بين خلال حول ضد او و ثم كل بعض غير عند لدى منذ حتى قد لقد هو هي هم انه انها كان كانت يكون تكون له لها بها به فيه فيها هناك ايضا بسبب اجل نحو دون سوى لكن بل اي اية مقابل عبر وفق حسب رغم بشان بخصوص جدا الان امس اليوم غدا
le la les des du de un une et ou mais donc or ni car pour par sur sous dans avec sans chez vers entre apres avant depuis pendant contre selon que qui quoi dont ou est sont etait etaient ete a au aux ce cet cette ces son sa ses leur leurs plus moins tres tout tous toute toutes il elle ils elles on nous vous je tu ne pas
the and for with from that this you are was were has have will not but its his her they them
`.trim().split(/\s+/));

export function tokens(text = '', { minLen = 3 } = {}) {
  return normalize(text)
    .split(' ')
    .map((w) => w.replace(/^(?:ال|لل)/, ''))   // article défini
    .filter((w) => w.length >= minLen && !STOP.has(w) && !/^\d+$/.test(w));
}

export function tokenSet(text) { return new Set(tokens(text)); }

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Recouvrement rapporte au plus petit ensemble : attrape « meme sujet, titre plus long ». */
export function containment(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

export function similarity(a, b) {
  return Math.max(jaccard(a, b), containment(a, b) * 0.9);
}

/** Mots « rares » du titre : candidats naturels pour les hashtags. */
export function keyTerms(text, limit = 6) {
  const seen = new Set();
  const out = [];
  for (const t of tokens(text, { minLen: 4 })) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** Retrouve les mots d'origine (non normalises) pour un affichage propre. */
export function originalTerms(text, limit = 5) {
  const raw = String(text).replace(/[«»"'“”.,:;!?()\[\]…–—]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const w of raw) {
    const n = normalize(w).replace(/^(?:ال|لل)/, '');
    if (n.length < 4 || STOP.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(w.replace(/^[«"']|[»"']$/g, ''));
    if (out.length >= limit) break;
  }
  return out;
}
