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
import { normalize, tokenSet, similarity, originalTerms, hasWord } from '../src/normalize.js';
import { clusterArticles } from '../src/cluster.js';
import { scoreCluster, categorize, arPlural } from '../src/score.js';
import { composeBrief, composePost } from '../src/compose.js';
import { normalizePhone, waConfig } from '../src/whatsapp.js';
import { resolveChannel, CHANNELS } from '../src/channels.js';
import { passesGate } from '../src/index.js';
import { applyWatchlist, extractMinisters } from '../src/watch.js';

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

// ── moteur de debat et ligne editoriale ───────────────────────────────────
const one = (title, extra = {}) => clusterArticles([
  article({ title, cat: extra.cat || 'politique', ...extra }),
])[0];
const noteOf = (title, extra = {}) => scoreCluster(one(title, extra),
  { cfg, trends: [], pageProfile: null, history: [], now: Date.now() });

test('un sujet qui divise bat un communique repris par tout le monde', () => {
  // Le coeur du projet : la reprise mesure l'interet des redactions, le debat
  // mesure l'envie de commenter. Trente reprises d'un communique ne valent pas
  // une facture d'eau qui augmente.
  const communique = noteOf('وزارة التجهيز تعلن عن اجتماع تنسيقي حول البرنامج السنوي');
  const facture = noteOf('غلاء فاتورة الماء والكهرباء يثير غضب الأسر.. من المسؤول عن الزيادة؟');
  assert.ok(facture.score > communique.score,
    `debat ${facture.score} devrait depasser communique ${communique.score}`);
  assert.ok(facture.signals.debateAxes.length >= 1, 'les axes doivent etre reconnus');
});

test('toucher deux axes de fracture vaut plus qu un seul', () => {
  // Le second axe est choisi SANS mot d'accusation : sinon la ligne
  // editoriale penalise la source unique et masque le gain mesure ici.
  const un = noteOf('ارتفاع أسعار المحروقات يثير انتقادات');
  const deux = noteOf('ارتفاع أسعار المحروقات يثير انتقادات ومطالب بدعم نقل التلاميذ إلى المدرسة');
  assert.ok(deux.signals.debateAxes.length > un.signals.debateAxes.length,
    `axes: ${JSON.stringify(deux.signals.debateAxes)} vs ${JSON.stringify(un.signals.debateAxes)}`);
  assert.ok(deux.score > un.score, `deux axes ${deux.score} > un axe ${un.score}`);
});

test('un axe double d une accusation non corroboree ne profite pas du gain', () => {
  // Cas reel du reglage : « الفساد » est a la fois un axe de debat et un mot
  // d'accusation. Le gain de debat ne doit pas annuler la prudence.
  const s = noteOf('ارتفاع أسعار المحروقات ومطالب بكشف تقرير الفساد في الصفقات العمومية');
  assert.ok(s.signals.debateAxes.includes('فساد'));
  assert.ok(s.signals.guardFactor < 1, 'la prudence reste appliquee');
});

test('un axe ne se declenche pas sur une sous-chaine', () => {
  // Cas reel : « حكمة كندية تقود مواجهة المغرب » (une ARBITRE) etait classee
  // axe JUSTICE parce que « الحكم » se trouve dans « حكمة ».
  const arbitre = noteOf('حكمة كندية تقود مواجهة المغرب ونيوزيلندا في مونديال أقل من 17 سنة', { cat: 'sport' });
  assert.ok(!arbitre.signals.debateAxes.includes('عدالة'), 'une arbitre n est pas un sujet judiciaire');

  assert.equal(hasWord(normalize('حكمة كندية'), 'الحكم'), false);
  assert.equal(hasWord(normalize('قرر الحكم إلغاء الهدف'), 'الحكم'), true);
  assert.equal(hasWord(normalize('بالحكم القضائي'), 'الحكم'), true, 'les proclitiques restent acceptes');
});

test('un mot croise au fil du resume ne cree pas un axe plein', () => {
  // Cas reels : « رمضان » dans un article sur la guerre de 1973, « المدرسة »
  // dans un dossier sur le handicap. Le sujet n'est ni religieux ni scolaire.
  const guerre = scoreCluster(clusterArticles([article({
    title: 'حرب تشرين 1973 ومشاركة الجيش العربي الأردني',
    summary: 'وقعت المعارك في شهر رمضان من ذلك العام',
    cat: 'monde',
  })])[0], { cfg, trends: [], pageProfile: null, history: [], now: Date.now() });
  assert.deepEqual(guerre.signals.debateStrongAxes, [], 'aucun axe central');

  // Deux mots du meme axe dans le corps : l'axe compte, mais en arriere-plan.
  const dossier = scoreCluster(clusterArticles([article({
    title: 'سلسلة مغرب الحضارة: الإعاقة مسؤولية الدولة والمجتمع',
    summary: 'يتناول الملف وضعية التلاميذ في المدرسة العمومية وشروط التعليم الدامج',
    cat: 'societe',
  })])[0], { cfg, trends: [], pageProfile: null, history: [], now: Date.now() });
  assert.ok(dossier.signals.debateAxes.includes('تعليم'));
  assert.ok(!dossier.signals.debateStrongAxes.includes('تعليم'), 'arriere-plan, pas axe central');
  assert.ok(dossier.why.some((w) => w.includes('خلفية')), 'et c est dit dans l explication');
});

test('un axe dans le titre pese plus que le meme axe dans le corps', () => {
  const titre = scoreCluster(clusterArticles([article({
    title: 'غلاء أسعار المواد الغذائية يثير غضب الأسر',
    summary: 'تقرير جديد', cat: 'societe',
  })])[0], { cfg, trends: [], pageProfile: null, history: [], now: Date.now() });
  const corps = scoreCluster(clusterArticles([article({
    title: 'ندوة حول الاقتصاد الوطني بالرباط',
    summary: 'تناولت الندوة غلاء الأسعار وتراجع القدرة الشرائية', cat: 'societe',
  })])[0], { cfg, trends: [], pageProfile: null, history: [], now: Date.now() });
  assert.ok(titre.parts.debate > corps.parts.debate,
    `titre ${titre.parts.debate} devrait depasser corps ${corps.parts.debate}`);
});

test('un titre-question est reconnu comme appel au commentaire', () => {
  const s = noteOf('هل ستنجح حكومة المنصوري في خفض أسعار المواد الغذائية؟');
  assert.equal(s.signals.asksQuestion, true);
  assert.ok(s.why.some((w) => w.includes('سؤال مفتوح')));
});

test('la ligne editoriale ecarte le sordide', () => {
  const s = noteOf('العثور على جثة مقطعة بحي شعبي');
  assert.equal(s.blocked, 'جثة مقطعة', 'doit etre marque bloque');
  assert.equal(s.score, 0, 'et tomber a zero');
});

test('une formule racoleuse est penalisee sans etre effacee', () => {
  const propre = noteOf('ارتفاع أسعار الخضر يثير غضب المستهلكين');
  const racoleur = noteOf('لن تصدق ارتفاع أسعار الخضر يثير غضب المستهلكين');
  assert.ok(racoleur.score < propre.score, 'le racolage doit couter');
  assert.ok(racoleur.score > 0, 'mais le sujet reste visible');
  assert.ok(racoleur.signals.guardReasons.some((r) => r.includes('رخيصة')));
});

test('une accusation tenue par un seul site recule', () => {
  const titre = 'تقرير يتهم مسؤولا باختلاس المال العام في صفقة عمومية';
  const seul = noteOf(titre);
  const corrobore = scoreCluster(clusterArticles([
    article({ title: titre, link: 'https://a.ma/1', source: 'A', cat: 'politique' }),
    article({ title: titre, link: 'https://b.ma/1', source: 'B', cat: 'politique' }),
  ])[0], { cfg, trends: [], pageProfile: null, history: [], now: Date.now() });
  assert.ok(seul.signals.guardFactor < 1, 'un seul site : penalite');
  assert.equal(corrobore.signals.guardFactor, 1, 'deux sites : plus de penalite');
});

test('la penalite editoriale a un plancher', () => {
  const s = noteOf('لن تصدق صدمة مصادر مطلعة تتهم مسؤولا بالرشوة في فضيحة خطير جدا');
  assert.ok(s.signals.guardFactor >= (cfg.editorialGuard.floor - 1e-9),
    `plancher respecte, obtenu ${s.signals.guardFactor}`);
});

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

test('stripTags nettoie le HTML double-encode de Google News', () => {
  // Google News echappe son resume : apres decodage le `<a href>` reapparait.
  assert.equal(stripTags('&lt;a href="https://x.ma"&gt;خبر مهم&lt;/a&gt; وتفاصيل'), 'خبر مهم وتفاصيل');
  // Mais une comparaison litterale ne doit pas etre mangee.
  assert.equal(stripTags('قال 5 &lt; 7 و 9 &gt; 2'), 'قال 5 < 7 و 9 > 2');
});

// ── liste de surveillance (priorite absolue) ──────────────────────────────
const watchCfg = {
  watchlist: [{
    id: 'gov', label: '🚨 الحكومة', keywords: ['تشكيل الحكومة', 'الحقائب الوزارية'],
    confirmKeywords: ['تعيين أعضاء الحكومة', 'أدى اليمين', 'عين الملك'],
    pendingKeywords: ['يرتقب', 'تترقب', 'من المنتظر'],
    bypassGate: true, maxAlertsPerRun: 2, maxPromoted: 3,
    scoreFloor: 95, extractMinisters: true, maxAgeHours: 24, minSources: 1,
  }],
};
const watchItem = (o = {}) => ({
  score: 34, link: 'https://hespress.com/g', title: 'خبر', summary: '',
  publishedAt: Date.now() - HOUR, signals: { sourceCount: 2 }, ...o,
});

test('les tractations sont promues mais ne sautent pas la porte', () => {
  // Une journee de negociations ne doit pas remplir le telephone : priorite
  // au classement, oui ; envoi immediat, non.
  const it = watchItem({ title: 'تسريع تشكيل الحكومة الجديدة' });
  assert.deepEqual(applyWatchlist([it], watchCfg), []);
  assert.equal(it.watch.confirmed, false);
  assert.equal(it.watch.promoted, true);
  assert.equal(it.watch.bypassGate, false);
  assert.equal(it.score, 34, 'la note des tractations ne doit pas etre gonflee');
});

test('un mot de confirmation declenche l alerte immediate', () => {
  const it = watchItem({
    title: 'تعيين أعضاء الحكومة الجديدة', summary: 'تشكيل الحكومة انتهى',
    signals: { sourceCount: 4 },
  });
  const alerts = applyWatchlist([it], watchCfg);
  assert.deepEqual(alerts, [it]);
  assert.equal(it.watch.confirmed, true);
  assert.equal(it.watch.bypassGate, true);
  assert.equal(it.score, 95);
  assert.equal(it.scoreBeforeWatch, 34);
  assert.ok(it.watch.confirms.length >= 1);
});

test('le futur « يعين الملك » ne vaut pas le passe « عين الملك »', () => {
  // Cas reel du 16 octobre : « يرتقب أن يعين الملك … أعضاء الحكومة الجديدة »
  // annoncait une nomination A VENIR. L'ancienne recherche par sous-chaine
  // trouvait « عين الملك » dans « يعين الملك » et criait l'alerte.
  const futur = watchItem({
    title: 'المنصوري تترقب التعيين الملكي لحكومتها اليوم الجمعة',
    summary: 'يرتقب أن يعين الملك محمد السادس أعضاء الحكومة الجديدة بعد صلاة الجمعة، بعد استكمال تشكيل الحكومة',
    signals: { sourceCount: 10 },
  });
  assert.deepEqual(applyWatchlist([futur], watchCfg), [], 'aucune alerte');
  assert.equal(futur.watch.confirmed, false);
  assert.equal(futur.watch.promoted, true, 'le sujet reste prioritaire au classement');
  assert.equal(futur.score, 34, 'et garde sa vraie note');
});

test('un proclitique ne casse pas un mot de confirmation', () => {
  const it = watchItem({
    title: 'بتعيين أعضاء الحكومة الجديدة', summary: 'تشكيل الحكومة انتهى',
    signals: { sourceCount: 4 },
  });
  assert.deepEqual(applyWatchlist([it], watchCfg), [it]);
  assert.equal(it.watch.confirmed, true);
});

test('un mot d anticipation dans le titre suspend l alerte', () => {
  const it = watchItem({
    title: 'من المنتظر تعيين أعضاء الحكومة', summary: 'تشكيل الحكومة',
    signals: { sourceCount: 8 },
  });
  assert.deepEqual(applyWatchlist([it], watchCfg), []);
  assert.equal(it.watch.confirmed, false);
  assert.deepEqual(it.watch.pending, ['من المنتظر']);
});

test('un titre d annonce garde l alerte meme avec un « ومن المنتظر » apres', () => {
  // Le titre reel attendu : « الملك يعين أعضاء الحكومة … ومن المنتظر عقد مجلس
  // وزاري السبت ». La suspension ne doit pas avaler la vraie annonce.
  const it = watchItem({
    title: 'عين الملك أعضاء الحكومة الجديدة ومن المنتظر عقد مجلس وزاري السبت',
    summary: 'تشكيل الحكومة',
    signals: { sourceCount: 7 },
  });
  assert.deepEqual(applyWatchlist([it], watchCfg), [it]);
  assert.equal(it.watch.confirmed, true);
});

test('l annonce passee declenche bien l alerte malgre un corps bavard', () => {
  const it = watchItem({
    title: 'عين الملك محمد السادس أعضاء الحكومة الجديدة',
    summary: 'تشكيل الحكومة: أدى اليمين أمام الملك. وكان التعيين مرتقبا منذ أيام',
    signals: { sourceCount: 6 },
  });
  assert.deepEqual(applyWatchlist([it], watchCfg), [it], 'le mot d anticipation est dans le corps, pas le titre');
  assert.equal(it.watch.confirmed, true);
});

test('un bout de phrase n est jamais un nom de ministre', () => {
  // Faux couples reellement extraits le 16 octobre d'un article sur Wahbi :
  // « العدل — كيف ستتصرف المنصوري مع », « العدل — للبقاء في منصب »…
  const bruit = 'وهبي مرشح فوق العادة للبقاء وزيرا للعدل.. كيف ستتصرف المنصوري مع غضب المحامين؟'
    + ' ومنذ تعيينه وزيرا للعدل، إذ ظل يدافع عن مشروعه، وخلال السنوات اللاحقة في العدل'
    + ' واصل الدفاع عن رغبته للبقاء في منصب وزير العدل.';
  assert.deepEqual(extractMinisters(bruit), []);
});

test('un portefeuille attribue a deux noms est jete', () => {
  const ambigu = 'وزير الداخلية عبد الوافي لفتيت. وزير الداخلية محمد حصاد.'
    + ' وزير الخارجية ناصر بوريطة.';
  const out = extractMinisters(ambigu);
  assert.deepEqual(out.map((m) => m.portfolio), ['الخارجية'], 'الداخلية est ambigu, on le jette');
  assert.equal(out[0].name, 'ناصر بوريطة');
});

test('une liste fuitee par un seul site ne declenche pas d alerte', () => {
  // Le cas reel : « لائحة بأسماء أعضاء الحكومة الجديدة » publie par un seul
  // site, repris par personne. C'est une rumeur, pas une annonce.
  const lone = watchItem({
    title: 'تعيين أعضاء الحكومة الجديدة', summary: 'تشكيل الحكومة',
    signals: { sourceCount: 1 },
  });
  assert.deepEqual(applyWatchlist([lone], watchCfg), []);
  assert.equal(lone.watch.confirmed, true, 'le sujet reste marque comme confirme');
  assert.equal(lone.watch.bypassGate, false, 'mais il ne saute pas la porte');
});

test('le nombre d alertes par passage est plafonne', () => {
  const many = Array.from({ length: 6 }, (_, i) => watchItem({
    title: `تعيين أعضاء الحكومة الجديدة ${i}`, summary: 'تشكيل الحكومة',
    link: `https://hespress.com/g${i}`, signals: { sourceCount: 4 },
  }));
  const alerts = applyWatchlist(many, watchCfg);
  assert.equal(alerts.length, watchCfg.watchlist[0].maxAlertsPerRun);
  assert.equal(many.filter((x) => x.watch.promoted).length, watchCfg.watchlist[0].maxPromoted);
});

test('l alerte prefere un lien direct a une redirection Google News', () => {
  const announce = { title: 'تعيين أعضاء الحكومة', summary: 'تشكيل الحكومة', signals: { sourceCount: 4 } };
  const redirect = watchItem({ ...announce, link: 'https://news.google.com/rss/articles/xyz' });
  const direct = watchItem({ ...announce, link: 'https://hespress.com/direct' });
  const alerts = applyWatchlist([redirect, direct], { watchlist: [{ ...watchCfg.watchlist[0], maxAlertsPerRun: 1 }] });
  assert.deepEqual(alerts, [direct]);
});

test('la surveillance ignore un sujet hors fenetre et un sujet hors sujet', () => {
  const old = watchItem({ title: 'تشكيل الحكومة', publishedAt: Date.now() - 48 * HOUR });
  const other = watchItem({ title: 'الرجاء يفوز على الوداد' });
  assert.deepEqual(applyWatchlist([old, other], watchCfg), []);
  assert.equal(old.watch, undefined);
  assert.equal(other.score, 34);
});

test('la surveillance fonctionne aussi sur la forme interne { cluster }', () => {
  const it = {
    cluster: { title: 'أدى اليمين أعضاء الحكومة الجديدة بعد توزيع الحقائب الوزارية', summary: '', lastDate: Date.now() },
    score: 20, signals: { sourceCount: 3 },
  };
  assert.equal(applyWatchlist([it], watchCfg).length, 1);
  assert.equal(it.score, 95);
});

test('une alerte confirmee saute la porte virale', () => {
  // Meme logique que deliver() : bypassGate court-circuite passesGate.
  const it = watchItem({
    title: 'تعيين أعضاء الحكومة الجديدة', summary: 'تشكيل الحكومة',
    signals: { sourceCount: 3 }, publishedAt: Date.now() - 20 * HOUR,
  });
  applyWatchlist([it], watchCfg);
  assert.equal(passesGate({ ...it, signals: { sourceCount: 1, medianAgeHours: 20 } }, gate).pass, false);
  assert.equal(it.watch.bypassGate, true, 'la liste de surveillance doit court-circuiter la porte');
});

// ── extraction nom / portefeuille ─────────────────────────────────────────
test('extractMinisters lit les trois formes de la presse marocaine', () => {
  const byPortfolio = extractMinisters('وعين الملك وزير الداخلية عبد الوافي لفتيت ووزيرة الصحة والحماية الاجتماعية أمينة بنخضرا');
  assert.ok(byPortfolio.some((m) => m.name.includes('لفتيت') && m.portfolio.includes('الداخلية')));
  assert.ok(byPortfolio.some((m) => m.portfolio === 'الصحة والحماية الاجتماعية'));

  const byName = extractMinisters('وجاءت فاطمة الزهراء المنصوري وزيرة للإسكان');
  assert.ok(byName.some((m) => m.name.includes('المنصوري') && m.portfolio.includes('الإسكان')));

  const asList = extractMinisters('الداخلية: عبد الوافي لفتيت — العدل: عبد اللطيف وهبي');
  assert.equal(asList.length, 2);
});

test('extractMinisters ne rend aucun nom sur une histoire de tractations', () => {
  const none = extractMinisters('تتواصل المشاورات بين الأحزاب حول تشكيل الحكومة الجديدة ولم يتم الاتفاق بعد');
  assert.deepEqual(none, []);
});

test('extractMinisters ne confond pas un portefeuille avec un nom', () => {
  for (const m of extractMinisters('وزير الصحة والحماية الاجتماعية أمينة بنخضرا')) {
    assert.ok(!m.name.includes('الحماية'), `nom pollue : ${m.name}`);
    assert.ok(m.name.split(/\s+/).length <= 4);
  }
});

// ── mise en forme de l alerte ─────────────────────────────────────────────
test('le brief d une alerte porte l entete et le tableau nom/poste', () => {
  const text = composeBrief(
    { title: 'التشكيلة الحكومية الجديدة', summary: 'x'.repeat(60), link: 'https://hespress.com/g', lastDate: Date.now() },
    { score: 95, cat: 'politique', why: ['سبب'], signals: { sourceCount: 4 } },
    null,
    {
      format: 'whatsapp',
      watch: { label: '🚨 التشكيل الحكومي', confirmed: true, confirms: ['تعيين'] },
      ministers: [{ portfolio: 'الداخلية', name: 'عبد الوافي لفتيت' }],
    },
  );
  assert.ok(text.includes('أولوية قصوى'));
  assert.ok(text.includes('الأسماء والمناصب'));
  assert.ok(text.includes('الداخلية — *عبد الوافي لفتيت*'));
});

test('la liste des ministres reste bornee pour tenir en legende', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ portfolio: `قطاع ${i}`, name: `اسم فلان ${i}` }));
  const text = composeBrief(
    { title: 'الحكومة', summary: '', link: '', lastDate: Date.now() },
    { score: 95, cat: 'politique', why: [], signals: { sourceCount: 4 } },
    null,
    { format: 'whatsapp', watch: { label: 'ح', confirmed: true, confirms: [] }, ministers: many },
  );
  assert.ok(text.length <= 1024, `legende trop longue : ${text.length}`);
});

test('la config embarque la veille gouvernementale active', () => {
  const entry = (cfg.watchlist || []).find((w) => w.id === 'gov-formation');
  assert.ok(entry, 'watchlist gov-formation absente de config.json');
  assert.notEqual(entry.enabled, false);
  assert.equal(entry.bypassGate, true);
  assert.equal(entry.extractMinisters, true);
  assert.ok(entry.keywords.length >= 5 && entry.confirmKeywords.length >= 5);
});
