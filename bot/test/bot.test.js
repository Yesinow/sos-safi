// Tests deterministes : aucun acces reseau, aucune dependance.
//   node --test bot/test/
// Ils couvrent surtout les bugs reels rencontres en production de ce bot :
// suffixe Google News double, liens de redirection, faux positifs de tendance,
// accord du pluriel arabe, et la porte virale.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseFeed, parseTrends, parseOpenGraph, stripTags } from '../src/rss.js';
import { normalize, tokenSet, similarity, originalTerms } from '../src/normalize.js';
import { clusterArticles } from '../src/cluster.js';
import { scoreCluster, categorize, arPlural } from '../src/score.js';
import { composeBrief, composePost } from '../src/compose.js';
import { normalizePhone, waConfig } from '../src/whatsapp.js';
import { resolveChannel, CHANNELS } from '../src/channels.js';
import { passesGate } from '../src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const HOUR = 3600 * 1000;

const article = (o = {}) => ({
  title: 'عنوان', link: 'https://exemple.ma/a', date: Date.now(), summary: '',
  source: 'Exemple', feed: 'Exemple', via: 'feed', cat: 'general', trust: 0.9,
  categories: [], image: '', ...o,
});

// ── config ────────────────────────────────────────────────────────────────
test('config.json contient les cles attendues', () => {
  for (const k of ['runtime', 'weights', 'viralGate', 'delivery', 'feeds', 'lexicon']) {
    assert.ok(cfg[k], `cle manquante : ${k}`);
  }
  const total = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
  assert.ok(total >= 100, `les poids doivent pouvoir atteindre 100, obtenu ${total}`);
});

test('aucun secret ni numero de telephone dans la config', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
  assert.equal(cfg.whatsapp?.to ?? '', '', 'whatsapp.to doit rester vide');
  assert.ok(!/\b(212|0)[5-7]\d{8}\b/.test(raw), 'un numero de telephone est commite');
});

// ── parsing ───────────────────────────────────────────────────────────────
test('parseFeed lit titre, lien, date et image', () => {
  const xml = `<rss><channel><item>
    <title><![CDATA[خبر &amp; تجربة]]></title>
    <link>https://hespress.com/x-1.html</link>
    <pubDate>Fri, 25 Sep 2026 18:00:00 +0100</pubDate>
    <description>وصف قصير</description>
    <media:content url="https://img.ma/a.jpg"/>
  </item></channel></rss>`;
  const [it] = parseFeed(xml);
  assert.equal(it.title, 'خبر & تجربة');
  assert.equal(it.link, 'https://hespress.com/x-1.html');
  assert.equal(it.image, 'https://img.ma/a.jpg');
  assert.ok(Number.isFinite(it.date));
});

test('parseTrends extrait le volume de recherche', () => {
  const xml = `<rss><channel><item>
    <title>المنتخب المغربي</title>
    <ht:approx_traffic>5,000+</ht:approx_traffic>
    <ht:news_item><ht:news_item_title>المغرب يفوز</ht:news_item_title></ht:news_item>
  </item></channel></rss>`;
  const [t] = parseTrends(xml);
  assert.equal(t.query, 'المنتخب المغربي');
  assert.equal(t.traffic, 5000);
  assert.equal(t.news.length, 1);
});

test('parseOpenGraph recupere og:image dans les deux ordres d attributs', () => {
  assert.equal(parseOpenGraph('<meta property="og:image" content="https://i.ma/1.jpg">').image, 'https://i.ma/1.jpg');
  assert.equal(parseOpenGraph('<meta content="https://i.ma/2.jpg" property="og:image">').image, 'https://i.ma/2.jpg');
});

test('stripTags neutralise le HTML', () => {
  assert.equal(stripTags('<p>نص <b>مهم</b></p>'), 'نص مهم');
});

// ── normalisation arabe ───────────────────────────────────────────────────
test('normalize unifie alef, ya et ta marbuta', () => {
  assert.equal(normalize('أحمد'), normalize('احمد'));
  assert.equal(normalize('مدرسة'), normalize('مدرسه'));
  assert.equal(normalize('علي'), normalize('على'));
});

test('similarity reconnait deux formulations du meme titre', () => {
  const a = tokenSet('المنتخب المغربي يفوز على الغابون بهدفين في تصفيات كأس إفريقيا');
  const b = tokenSet('الأسود الأطلس يتغلبون على الغابون في تصفيات الكان بهدفين');
  assert.ok(similarity(a, b) > 0.34, 'devrait depasser le seuil de regroupement');
});

test('similarity separe deux sujets differents', () => {
  const a = tokenSet('المنتخب المغربي يفوز على الغابون');
  const b = tokenSet('ارتفاع أسعار المحروقات في المغرب');
  assert.ok(similarity(a, b) < 0.34);
});

test('originalTerms rend les mots d origine sans mots outils', () => {
  const terms = originalTerms('المنتخب المغربي يفوز على الغابون بهدفين');
  assert.ok(terms.includes('المنتخب'));
  assert.ok(!terms.includes('على'));
});

// ── regroupement ──────────────────────────────────────────────────────────
test('clusterArticles regroupe la meme histoire et separe les autres', () => {
  const now = Date.now();
  const clusters = clusterArticles([
    article({ title: 'المنتخب المغربي يفوز على الغابون بهدفين نظيفين', source: 'Hespress', link: 'https://hespress.com/1', date: now }),
    article({ title: 'الأسود الأطلس يتغلبون على الغابون بهدفين', source: 'Le360', link: 'https://le360.ma/2', date: now - HOUR }),
    article({ title: 'ارتفاع أسعار المحروقات في المغرب هذا الأسبوع', source: 'Medias24', link: 'https://medias24.com/3', date: now }),
  ]);
  assert.equal(clusters.length, 2);
  const match = clusters.find((c) => c.sourceCount === 2);
  assert.ok(match, 'les deux depeches du match doivent fusionner');
  assert.deepEqual([...match.sources].sort(), ['Hespress', 'Le360']);
});

test('le representant evite les liens de redirection Google News', () => {
  const now = Date.now();
  const [c] = clusterArticles([
    article({ title: 'المغرب يتأهل إلى نهائي كأس إفريقيا للأمم', link: 'https://news.google.com/rss/articles/CBMiABC', source: 'GNews', trust: 1.0 }),
    article({ title: 'المغرب يتأهل إلى نهائي كأس إفريقيا', link: 'https://hespress.com/vrai.html', source: 'Hespress', trust: 0.8, date: now - 60000 }),
  ]);
  assert.equal(c.link, 'https://hespress.com/vrai.html');
  assert.equal(c.linkIsRedirect, false);
});

test('le titre et le lien viennent du meme article', () => {
  const [c] = clusterArticles([
    article({ title: 'المغرب يهزم الغابون بهدفين في التصفيات', link: 'https://a.ma/1', source: 'A', trust: 0.9 }),
    article({ title: 'المغرب يهزم الغابون في التصفيات الإفريقية', link: 'https://b.ma/2', source: 'B', trust: 0.9 }),
  ]);
  const rep = c.members.find((m) => m.link === c.link);
  assert.ok(rep, 'le lien doit appartenir a un article du cluster');
  assert.equal(rep.title, c.title, 'titre et lien doivent provenir du meme article');
});

// ── notation ──────────────────────────────────────────────────────────────
const buildCluster = (ageH, sources) => {
  const now = Date.now();
  const arts = Array.from({ length: sources }, (_, i) => article({
    title: 'المنتخب المغربي يفوز على الغابون بهدفين في التصفيات الإفريقية',
    link: `https://site${i}.ma/a`, source: `Site${i}`, cat: 'sport',
    date: now - ageH * HOUR - i * 60000,
  }));
  return clusterArticles(arts)[0];
};

test('un sujet frais marque plus que le meme sujet ancien', () => {
  const ctx = { cfg, trends: [], pageProfile: null, history: [], now: Date.now() };
  const fresh = scoreCluster(buildCluster(0.5, 6), ctx).score;
  const stale = scoreCluster(buildCluster(20, 6), ctx).score;
  assert.ok(fresh > stale, `frais ${fresh} devrait depasser ancien ${stale}`);
});

test('une large reprise marque plus qu une source unique', () => {
  const ctx = { cfg, trends: [], pageProfile: null, history: [], now: Date.now() };
  const wide = scoreCluster(buildCluster(1, 10), ctx).score;
  const narrow = scoreCluster(buildCluster(1, 1), ctx).score;
  assert.ok(wide > narrow, `large ${wide} devrait depasser etroit ${narrow}`);
});

test('une tendance sans rapport ne doit pas matcher (faux positif corrige)', () => {
  const cluster = clusterArticles([
    article({ title: 'أرمينيا تدعم مبادرة الحكم الذاتي في الصحراء المغربية', cat: 'politique' }),
  ])[0];
  const trends = [{ query: 'classement equipe algerie football equipe zambie football', traffic: 5000, news: [] }];
  const s = scoreCluster(cluster, { cfg, trends, pageProfile: null, history: [], now: Date.now() });
  assert.equal(s.signals.trendQuery, null, 'aucun mot commun : ne doit pas matcher');
});

test('une tendance pertinente matche', () => {
  const cluster = clusterArticles([
    article({ title: 'المنتخب المغربي يفوز على الغابون بهدفين', cat: 'sport' }),
  ])[0];
  const trends = [{ query: 'المنتخب المغربي الغابون', traffic: 5000, news: [] }];
  const s = scoreCluster(cluster, { cfg, trends, pageProfile: null, history: [], now: Date.now() });
  assert.equal(s.signals.trendQuery, 'المنتخب المغربي الغابون');
});

test('un sujet deja publie est fortement penalise', () => {
  const cluster = buildCluster(1, 6);
  const base = { cfg, trends: [], pageProfile: null, now: Date.now() };
  const plain = scoreCluster(cluster, { ...base, history: [] }).score;
  const repeat = scoreCluster(cluster, { ...base, history: [{ title: cluster.title, at: Date.now() - HOUR }] }).score;
  assert.ok(repeat < plain / 2, `repete ${repeat} devrait chuter sous la moitie de ${plain}`);
});

test('categorize detecte le sport a partir du texte', () => {
  const c = clusterArticles([article({ title: 'مباراة كرة القدم بين الرجاء والوداد في البطولة' })])[0];
  assert.equal(categorize(c, cfg), 'sport');
});

// ── accord du pluriel arabe ───────────────────────────────────────────────
test('arPlural respecte l accord arabe', () => {
  const sites = { one: 'موقع', two: 'موقعان', few: 'مواقع', many: 'موقعًا' };
  assert.equal(arPlural(1, sites), 'موقع');
  assert.equal(arPlural(2, sites), 'موقعان');
  assert.equal(arPlural(5, sites), '5 مواقع');
  assert.equal(arPlural(44, sites), '44 موقعًا');
});

// ── redaction ─────────────────────────────────────────────────────────────
const sample = () => {
  const cluster = buildCluster(1, 5);
  cluster.summary = 'فاز المنتخب الوطني المغربي على نظيره الغابوني بهدفين دون رد مساء اليوم في الرباط ضمن التصفيات الإفريقية.';
  const scored = scoreCluster(cluster, { cfg, trends: [], pageProfile: null, history: [], now: Date.now() });
  return { cluster, scored, post: composePost(cluster, scored) };
};

test('composeBrief applique le gras propre a chaque destination', () => {
  const { cluster, scored, post } = sample();
  assert.match(composeBrief(cluster, scored, post, { format: 'whatsapp' }), /\*رياضة\*/);
  assert.match(composeBrief(cluster, scored, post, { format: 'html' }), /<b>رياضة<\/b>/);
  assert.match(composeBrief(cluster, scored, post, { format: 'markdown' }), /\*\*رياضة\*\*/);
  const plain = composeBrief(cluster, scored, post, { format: 'plain' });
  assert.ok(!plain.includes('<b>') && !plain.includes('**'));
});

test('le brief tient dans une legende WhatsApp/Telegram et porte le lien', () => {
  const { cluster, scored, post } = sample();
  const text = composeBrief(cluster, scored, post, { format: 'html' });
  assert.ok(text.length <= 1024, `legende trop longue : ${text.length}`);
  assert.ok(text.includes(cluster.link));
  assert.ok(text.includes(`${scored.score}/100`));
});

test('le format html echappe les chevrons', () => {
  const { cluster, scored, post } = sample();
  cluster.title = 'خبر <script>alert(1)</script> مهم';
  const text = composeBrief(cluster, scored, post, { format: 'html' });
  assert.ok(!text.includes('<script>'), 'le HTML brut doit etre echappe');
});

test('composePost produit un texte Facebook avec hashtags', () => {
  const { post } = sample();
  assert.ok(post.text.includes('#المغرب'));
  assert.ok(post.text.length > 50);
  assert.ok(post.angle.note);
});

// ── porte virale ──────────────────────────────────────────────────────────
const gate = { minScore: 80, minSources: 3, maxAgeHours: 3, maxStoryAgeHours: 6, rejectRedirectLinks: true };
const item = (o = {}) => ({
  score: 85, link: 'https://hespress.com/a', image: 'https://i.ma/a.jpg',
  publishedAt: Date.now() - HOUR, firstSeenAt: Date.now() - 2 * HOUR,
  signals: { sourceCount: 5, medianAgeHours: 2 }, ...o,
});

test('la porte laisse passer un sujet qualifie', () => {
  assert.equal(passesGate(item(), gate).pass, true);
});

test('la porte rejette score bas, trop peu de sources, trop vieux, lien de redirection', () => {
  assert.equal(passesGate(item({ score: 70 }), gate).pass, false);
  assert.equal(passesGate(item({ signals: { sourceCount: 2, medianAgeHours: 2 } }), gate).pass, false);
  assert.equal(passesGate(item({ publishedAt: Date.now() - 9 * HOUR }), gate).pass, false);
  assert.equal(passesGate(item({ signals: { sourceCount: 5, medianAgeHours: 20 } }), gate).pass, false);
  assert.equal(passesGate(item({ link: 'https://news.google.com/rss/articles/CBMiX' }), gate).pass, false);
});

test('la porte explique chaque rejet', () => {
  const r = passesGate(item({ score: 40 }), gate);
  assert.equal(r.pass, false);
  assert.ok(r.fails.length > 0 && r.fails[0].includes('40'));
});

test('l age du sujet suit la mediane, pas l article le plus ancien', () => {
  // Un article d'hier, mais l'essentiel de la couverture date de 2h : ca passe.
  const r = passesGate(item({ firstSeenAt: Date.now() - 22 * HOUR, signals: { sourceCount: 5, medianAgeHours: 2 } }), gate);
  assert.equal(r.pass, true);
});

// ── canaux ────────────────────────────────────────────────────────────────
test('normalizePhone gere les formats marocains', () => {
  for (const raw of ['0612345678', '+212 612-345-678', '00212612345678', '212612345678']) {
    assert.equal(normalizePhone(raw), '212612345678');
  }
});

test('resolveChannel signale precisement les variables manquantes', () => {
  const clean = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^(WA_|TELEGRAM|NTFY|DISCORD|GREENAPI|ULTRAMSG|TWILIO|CALLMEBOT|BUZZ_)/.test(k)) delete process.env[k];
  try {
    process.env.BUZZ_CHANNEL = 'telegram';
    const ch = resolveChannel(cfg);
    assert.equal(ch.ready, false);
    assert.deepEqual(ch.missing, ['TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID']);

    process.env.BUZZ_CHANNEL = 'inexistant';
    assert.equal(resolveChannel(cfg).unknown, true);

    process.env.BUZZ_CHANNEL = 'whatsapp';
    assert.ok(waConfig(cfg).missing.includes('WA_TO'));
  } finally {
    process.env = clean;
  }
});

test('le canal par defaut de la config existe', () => {
  assert.ok(CHANNELS[cfg.delivery.channel], `canal inconnu : ${cfg.delivery.channel}`);
});
