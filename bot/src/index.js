#!/usr/bin/env node
// index.js — chef d'orchestre. Tout est borne par un budget de temps :
// le bot rend toujours un resultat, meme si une source traine.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Deadline, getText, pool } from './http.js';
import { parseOpenGraph } from './rss.js';
import { collectArticles, collectTrends } from './collect.js';
import { clusterArticles } from './cluster.js';
import { scoreCluster } from './score.js';
import { composePost, composeBrief } from './compose.js';
import { learnPageProfile, publishPost, fbCredentials } from './facebook.js';
import { waConfig, sendWhatsApp } from './whatsapp.js';
import { writeAll } from './report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { a[key] = next; i++; } else { a.flags.add(key); a[key] = true; }
  }
  return a;
}

const HELP = `
رادار البوز المغربي — جمع الأخبار وترتيبها حسب احتمال التفاعل

  node src/index.js [خيارات]

  --limit N         عدد المواضيع في التقرير (افتراضي 12)
  --budget S        سقف الوقت بالثواني (افتراضي 420 — أي أقل من 10 دقائق)
  --hours H         أقصى عمر للخبر بالساعات (افتراضي 24)
  --category X      تصفية: sport | politique | economie | societe | faits-divers | culture | monde
  --min-score N     تجاهل المواضيع تحت هذه النقطة
  --no-trends       بدون Google Trends (أسرع)
  --whatsapp        صيفط الأخبار اللي دازت من بوابة البوز لواتساب ديالك
  --dry-run         وريّ ليا شنو غادي يتصيفط، بلا ما تصيفطو فعلاً
  --gate-score N    عتبة البوز ديال واتساب (افتراضي من config.json)
  --all             تجاوز بوابة البوز وصيفط أحسن النتائج على أي حال
  --publish [mode]  النشر على الصفحة: draft (افتراضي) | schedule | live
  --mark            سجّل المواضيع المعروضة في السجل حتى لا تتكرر
  --out DIR         مجلد المخرجات (افتراضي bot/out)
  --config PATH     ملف إعدادات بديل
  --quiet           بدون تفاصيل في الطرفية
  --help            هذه المساعدة
`;

function makeLogger(quiet) {
  const t0 = Date.now();
  return (msg) => {
    if (quiet) return;
    const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
    process.stderr.write(`  [${s}s] ${msg}\n`);
  };
}

function loadConfig(args) {
  const file = args.config ? path.resolve(args.config) : path.join(ROOT, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (args.budget) cfg.runtime.budgetSeconds = Number(args.budget);
  if (args.limit) cfg.runtime.topLimit = Number(args.limit);
  if (args.hours) cfg.runtime.maxAgeHours = Number(args.hours);
  if (args.flags.has('no-trends')) cfg.trends.enabled = false;
  if (fbCredentials(cfg).ready) cfg.facebook.enabled = true;
  return cfg;
}

function loadHistory() {
  const f = path.join(ROOT, 'state', 'history.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function saveHistory(entries) {
  const f = path.join(ROOT, 'state', 'history.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const keep = entries.filter((e) => Date.now() - e.at < 14 * 24 * 3600 * 1000).slice(-500);
  fs.writeFileSync(f, JSON.stringify(keep, null, 2), 'utf8');
}

/** Recupere l'image og: des meilleurs sujets, tant qu'il reste du temps. */
async function enrichImages(items, cfg, deadline, log) {
  const need = items.filter((it) => !it.cluster.image && it.cluster.link).slice(0, cfg.runtime.enrichTop);
  if (!need.length || deadline.expired(20000)) return;
  log(`جلب صور المعاينة لـ ${need.length} موضوع…`);
  await pool(need, Math.min(4, cfg.runtime.concurrency), async (it) => {
    if (deadline.expired(8000)) return;
    const res = await getText(it.cluster.link, { timeoutMs: 7000, userAgent: cfg.runtime.userAgent, deadline });
    if (!res.ok) return;
    const og = parseOpenGraph(res.body.slice(0, 120000));
    if (og.image) it.cluster.image = og.image;
    if (og.description && og.description.length > (it.cluster.summary || '').length) {
      it.cluster.summary = og.description.slice(0, 400);
    }
  });
}


/**
 * Porte virale : un sujet n'est envoye que s'il franchit TOUS les seuils.
 * Mieux vaut ne rien recevoir qu'un fil d'actualite ordinaire.
 */
export function passesGate(item, gate, now = Date.now()) {
  const ageH = (now - item.publishedAt) / 3600000;
  const fails = [];
  if (item.score < gate.minScore) fails.push(`النقطة ${item.score} < ${gate.minScore}`);
  if (item.signals.sourceCount < gate.minSources) fails.push(`${item.signals.sourceCount} مصدر < ${gate.minSources}`);
  if (ageH > gate.maxAgeHours) fails.push(`عمره ${Math.round(ageH)}س > ${gate.maxAgeHours}س`);
  if (gate.requireImage && !item.image) fails.push('بلا صورة');
  if (gate.rejectRedirectLinks && /news\.google\.com/.test(item.link || '')) fails.push('رابط Google News');
  return { pass: fails.length === 0, fails };
}

async function deliverWhatsApp({ cfg, args, payload, history, log, now }) {
  const gate = { ...cfg.viralGate };
  if (args['gate-score']) gate.minScore = Number(args['gate-score']);

  const alreadySent = new Set(history.filter((h) => h.sent).map((h) => h.link));
  const checked = payload.items.map((item) => ({ item, ...passesGate(item, gate, now) }));

  let selected = args.flags.has('all')
    ? checked.map((c) => c.item)
    : checked.filter((c) => c.pass).map((c) => c.item);

  selected = selected.filter((it) => !alreadySent.has(it.link)).slice(0, gate.maxPerRun);

  if (!selected.length) {
    const best = checked[0];
    log('ما كاين حتى خبر دار البوابة — ما تصيفط والو');
    if (best) log(`أقرب واحد: «${best.item.title.slice(0, 50)}…» (${best.fails.join('، ')})`);
    console.log('\n🔕 ما كاين حتى خبر مرشح للفيرال دابا. جرّب --all باش تشوف أحسن النتائج على أي حال.\n');
    return;
  }

  const wa = waConfig(cfg);
  const dry = args.flags.has('dry-run');

  if (!dry && !wa.ready) {
    console.error(`\n❌ إعدادات واتساب ناقصة (${wa.provider}): ${wa.missing.join('، ')}`);
    console.error('   شوف bot/README.md — قسم "ربط واتساب".\n');
    process.exitCode = 1;
    return;
  }

  log(`${selected.length} خبر دار البوابة${dry ? ' (تجربة بلا إرسال)' : ` — كنصيفط عبر ${wa.provider}`}`);

  for (const item of selected) {
    const text = composeBrief(
      { title: item.title, summary: item.summary, link: item.link, lastDate: item.publishedAt },
      { score: item.score, cat: item.category, why: item.why, signals: item.signals },
      item.post,
    );
    const imageUrl = cfg.whatsapp.sendImage ? item.image : '';

    if (dry) {
      console.log(`\n${'═'.repeat(54)}`);
      console.log(text);
      if (imageUrl) console.log(`\n🖼 ${imageUrl}`);
      continue;
    }

    const res = await sendWhatsApp(wa, { text, imageUrl });
    if (res.ok) {
      log(`✅ تصيفط: «${item.title.slice(0, 46)}…»${res.withImage ? ' (بالصورة)' : ''}`);
      history.push({ title: item.title, link: item.link, score: item.score, at: now, sent: true });
    } else {
      log(`❌ فشل الإرسال: ${res.error}`);
      process.exitCode = 1;
    }
  }

  if (dry) console.log(`\n${'═'.repeat(54)}\n🧪 تجربة فقط — ما تصيفط والو.\n`);
  else saveHistory(history);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help') || args.flags.has('h')) { console.log(HELP); return; }

  const cfg = loadConfig(args);
  const quiet = args.flags.has('quiet');
  const log = makeLogger(quiet);
  const deadline = new Deadline(cfg.runtime.budgetSeconds);

  if (!quiet) process.stderr.write(`\n🔥 رادار البوز المغربي — سقف الوقت ${cfg.runtime.budgetSeconds}s\n`);

  // 1. Collecte en parallele : rien ne bloque rien.
  const [trends, collected, pageProfile] = await Promise.all([
    collectTrends(cfg, deadline, log),
    collectArticles(cfg, deadline, log),
    learnPageProfile(cfg, deadline, log),
  ]);

  const { articles, diag } = collected;
  if (!articles.length) {
    console.error('\n❌ لم يُجلب أي خبر. تحقق من الاتصال بالإنترنت أو من ملف config.json.');
    process.exitCode = 1;
    return;
  }

  // 2. Regroupement par histoire
  const clusters = clusterArticles(articles);
  log(`تجميع: ${clusters.length} موضوع متمايز من ${articles.length} خبر`);

  // 3. Notation
  const history = loadHistory();
  const now = Date.now();
  let items = clusters.map((cluster) => {
    const scored = scoreCluster(cluster, { cfg, trends, pageProfile, history, now });
    return { cluster, ...scored };
  });

  if (args.category) items = items.filter((it) => it.cat === args.category);
  if (args['min-score']) items = items.filter((it) => it.score >= Number(args['min-score']));

  items.sort((a, b) => b.score - a.score);
  items = items.slice(0, cfg.runtime.topLimit);
  log(`ترتيب: أعلى نقطة ${items[0] ? items[0].score : 0}/100`);

  // 4. Enrichissement puis redaction
  await enrichImages(items, cfg, deadline, log);
  const payload = {
    generatedAt: now,
    stats: {
      articles: articles.length,
      clusters: clusters.length,
      sourcesOk: diag.ok,
      durationSeconds: Number(deadline.elapsedS),
    },
    trends: trends.map((t) => ({ query: t.query, traffic: t.traffic })),
    pageProfile: pageProfile ? { sampled: pageProfile.sampled, topTerms: pageProfile.topTerms } : null,
    diag: { failed: diag.failed },
    items: items.map((it) => ({
      score: it.score,
      category: it.cat,
      title: it.cluster.title,
      link: it.cluster.link,
      image: it.cluster.image,
      summary: it.cluster.summary,
      sources: it.cluster.sources,
      publishedAt: it.cluster.lastDate,
      parts: it.parts,
      signals: it.signals,
      why: it.why,
      post: composePost(it.cluster, it),
    })),
  };

  // 5. Sorties
  const outDir = args.out ? path.resolve(args.out) : path.join(ROOT, 'out');
  const files = writeAll(outDir, payload);
  payload.stats.durationSeconds = Number(deadline.elapsedS);

  // 6. Porte virale + envoi WhatsApp
  if (args.whatsapp || args.flags.has('dry-run')) {
    await deliverWhatsApp({ cfg, args, payload, history, log, now });
  }

  // 7. Publication optionnelle sur la page
  if (args.publish) {
    const mode = typeof args.publish === 'string' ? args.publish : (cfg.facebook.publishMode || 'draft');
    const top = payload.items[0];
    if (!top) log('لا يوجد موضوع للنشر');
    else {
      const res = await publishPost(cfg, top.post, { mode });
      if (res.ok) {
        log(`✅ نُشر بوضع "${mode}" — المعرّف ${res.id}`);
        history.push({ title: top.title, link: top.link, score: top.score, at: now });
        saveHistory(history);
      } else {
        log(`❌ فشل النشر: ${res.error}`);
        process.exitCode = 1;
      }
    }
  }

  if (args.flags.has('mark')) {
    payload.items.forEach((it) => history.push({ title: it.title, link: it.link, score: it.score, at: now }));
    saveHistory(history);
    log(`سُجّل ${payload.items.length} موضوع في السجل`);
  }

  // 8. Resume terminal
  if (args.flags.has('json')) { console.log(JSON.stringify(payload, null, 2)); return; }
  if (quiet) { console.log(files.html); return; }

  console.log(`\n${'─'.repeat(64)}`);
  payload.items.forEach((it, i) => {
    const bar = '█'.repeat(Math.round(it.score / 5)).padEnd(20, '·');
    console.log(`\n${String(i + 1).padStart(2)}. ${bar} ${String(it.score).padStart(3)}/100  [${it.category}]`);
    console.log(`    ${it.title}`);
    console.log(`    ${it.why.slice(0, 2).join(' · ')}`);
    console.log(`    💡 ${it.post.angle.note}`);
    console.log(`    🔗 ${it.link}`);
  });
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`⏱  ${payload.stats.durationSeconds}s · ${payload.stats.articles} خبر · ${payload.stats.clusters} موضوع`);
  console.log(`📄 ${files.html}`);
  console.log(`📝 ${files.md}\n`);
}

main().catch((e) => {
  console.error('\n❌ خطأ غير متوقع:', e && e.stack || e);
  process.exitCode = 1;
});
