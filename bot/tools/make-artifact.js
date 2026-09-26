#!/usr/bin/env node
// make-artifact.js — transforme out/buzz.json en une page prete a publier
// comme Artifact (contenu seul : pas de doctype/html/head/body, images
// distantes en lien car la CSP de l'Artifact les bloque).
//
//   node tools/make-artifact.js [chemin/buzz.json] [sortie.html]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inFile = process.argv[2] || path.join(ROOT, 'out', 'buzz.json');
const outFile = process.argv[3] || path.join(ROOT, 'out', 'radar.html');

const p = JSON.parse(fs.readFileSync(inFile, 'utf8'));

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CAT = {
  sport: 'رياضة', politique: 'سياسة', economie: 'اقتصاد', societe: 'مجتمع',
  'faits-divers': 'حوادث', culture: 'ثقافة وفن', monde: 'دولي', general: 'عام',
};

// Chaque signal a sa couleur : la barre de score se lit comme sa composition.
const SIGNALS = [
  ['trend', 'بحث Google'],
  ['spread', 'انتشار'],
  ['velocity', 'سرعة'],
  ['emotion', 'حرارة'],
  ['freshness', 'طزاجة'],
  ['pageFit', 'ملاءمة صفحتك'],
];

const stamp = new Date(p.generatedAt).toLocaleString('ar-MA', {
  timeZone: 'Africa/Casablanca', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit',
});

const ago = (ts) => {
  const h = (p.generatedAt - ts) / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} د`;
  if (h < 24) return `${Math.round(h)} س`;
  return `${Math.round(h / 24)} يوم`;
};

function meter(item) {
  const total = SIGNALS.reduce((a, [k]) => a + (item.parts[k] || 0), 0) || 1;
  const segs = SIGNALS
    .filter(([k]) => (item.parts[k] || 0) > 0.4)
    .map(([k]) => `<span class="seg s-${k}" style="flex:${(item.parts[k] / total * item.score).toFixed(2)}"></span>`)
    .join('');
  return `<div class="meter" role="img" aria-label="نقطة البوز ${item.score} من 100">
        <div class="bar">${segs}<span class="rest" style="flex:${(100 - item.score).toFixed(2)}"></span></div>
        <b class="score">${item.score}</b>
      </div>`;
}

const legend = SIGNALS.map(([k, label]) =>
  `<span class="key"><i class="dot s-${k}"></i>${label}</span>`).join('');

const trends = (p.trends || []).filter((t) => t.traffic > 0).slice(0, 8);
const maxTraffic = Math.max(...trends.map((t) => t.traffic), 1);
const trendRows = trends.map((t) => `<li>
        <span class="q">${esc(t.query)}</span>
        <span class="vol"><i style="width:${(t.traffic / maxTraffic * 100).toFixed(1)}%"></i></span>
        <span class="num">${t.traffic.toLocaleString('en')}+</span>
      </li>`).join('');

const cards = p.items.map((it, i) => {
  const gate = it.score >= 80;
  return `<article class="card${gate ? ' hot' : ''}">
      <div class="head">
        <span class="rank">${i + 1}</span>
        ${meter(it)}
        <span class="cat">${esc(CAT[it.category] || it.category)}</span>
      </div>
      <h2><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></h2>
      ${it.summary && it.summary.length > 50 ? `<p class="sum">${esc(it.summary.slice(0, 260))}${it.summary.length > 260 ? '…' : ''}</p>` : ''}
      <ul class="why">${it.why.slice(0, 3).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <div class="facts">
        <span><b>${it.signals.sourceCount}</b> مصدر</span>
        <span><b>${ago(it.publishedAt)}</b> من آخر نشرة</span>
        ${it.signals.trendTraffic ? `<span><b>${it.signals.trendTraffic.toLocaleString('en')}+</b> بحث</span>` : ''}
        ${it.image ? `<a href="${esc(it.image)}" target="_blank" rel="noopener">الصورة ↗</a>` : ''}
      </div>
      <details>
        <summary>منشور فايسبوك جاهز</summary>
        <pre id="post${i}">${esc(it.post.text)}</pre>
        <p class="angle">${esc(it.post.angle.note)}</p>
        <button type="button" data-copy="post${i}">نسخ المنشور</button>
      </details>
    </article>`;
}).join('');

const passed = p.items.filter((it) => it.score >= 80).length;

const html = `<title>رادار البوز المغربي</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Noto+Kufi+Arabic:wght@600;700&display=swap">
<style>
  :root{
    color-scheme: light;
    --bg:#f2f4f2; --panel:#fff; --ink:#12161c; --muted:#5d6b66; --line:#dde3df;
    --accent:#0e7a5f; --heat:#c26512; --madder:#a8262c;
    --s-trend:#0e7a5f; --s-spread:#2f6fb0; --s-velocity:#c26512;
    --s-emotion:#a8262c; --s-freshness:#7a5cb5; --s-pageFit:#6b7a4f;
    --rest:#e4e9e5;
    --display:"Noto Kufi Arabic",system-ui,sans-serif;
    --body:"IBM Plex Sans Arabic",system-ui,"Segoe UI",Tahoma,sans-serif;
  }
  @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
    color-scheme: dark;
    --bg:#0d1114; --panel:#151b1f; --ink:#e8eeea; --muted:#95a49d; --line:#26302d;
    --accent:#3fb08c; --heat:#e8963f; --madder:#e06a6f;
    --s-trend:#3fb08c; --s-spread:#6aa5de; --s-velocity:#e8963f;
    --s-emotion:#e06a6f; --s-freshness:#a98ee0; --s-pageFit:#a3b37c;
    --rest:#232c29;
  }}
  :root[data-theme="dark"]{
    color-scheme: dark;
    --bg:#0d1114; --panel:#151b1f; --ink:#e8eeea; --muted:#95a49d; --line:#26302d;
    --accent:#3fb08c; --heat:#e8963f; --madder:#e06a6f;
    --s-trend:#3fb08c; --s-spread:#6aa5de; --s-velocity:#e8963f;
    --s-emotion:#e06a6f; --s-freshness:#a98ee0; --s-pageFit:#a3b37c;
    --rest:#232c29;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);
       font-size:15px;line-height:1.7;padding-block:0 56px;padding-inline:16px}
  .wrap{max-width:760px;margin:0 auto;direction:rtl}
  h1{font-family:var(--display);font-size:clamp(1.5rem,5vw,2rem);margin:0 0 6px;text-wrap:balance}
  .top{padding-block:28px 18px;border-bottom:2px solid var(--line);margin-bottom:20px}
  .meta{color:var(--muted);font-size:.85rem;margin:0;font-variant-numeric:tabular-nums}
  .meta b{color:var(--ink);font-weight:600}
  .verdict{margin:14px 0 0;padding:10px 14px;border-radius:10px;font-size:.88rem;
           background:color-mix(in srgb,var(--heat) 12%,transparent);
           border:1px solid color-mix(in srgb,var(--heat) 35%,transparent)}
  section.trends{background:var(--panel);border:1px solid var(--line);border-radius:14px;
                 padding:16px 18px;margin-bottom:26px}
  section.trends h3{font-family:var(--display);font-size:.95rem;margin:0 0 12px;color:var(--muted);
                    letter-spacing:.02em}
  section.trends ol{list-style:none;margin:0;padding:0;display:grid;gap:7px}
  section.trends li{display:grid;grid-template-columns:minmax(0,1fr) 88px auto;align-items:center;gap:10px;font-size:.87rem}
  .q{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .vol{height:7px;background:var(--rest);border-radius:4px;overflow:hidden}
  .vol i{display:block;height:100%;background:var(--accent)}
  .num{color:var(--heat);font-size:.78rem;font-variant-numeric:tabular-nums}
  .legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:18px;font-size:.76rem;color:var(--muted)}
  .key{display:inline-flex;align-items:center;gap:5px}
  .dot{width:9px;height:9px;border-radius:2px;display:inline-block}
  .s-trend{background:var(--s-trend)} .s-spread{background:var(--s-spread)}
  .s-velocity{background:var(--s-velocity)} .s-emotion{background:var(--s-emotion)}
  .s-freshness{background:var(--s-freshness)} .s-pageFit{background:var(--s-pageFit)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;
        padding:16px 18px;margin-bottom:14px}
  .card.hot{border-color:var(--madder);box-shadow:0 0 0 1px var(--madder)}
  .head{display:flex;align-items:center;gap:12px;margin-bottom:11px}
  .rank{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:50%;
        background:var(--ink);color:var(--panel);font-size:.78rem;font-weight:600;
        font-variant-numeric:tabular-nums}
  .meter{flex:1;display:flex;align-items:center;gap:9px;min-width:0}
  .bar{flex:1;display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--rest);min-width:0}
  .seg{display:block}
  .rest{background:var(--rest)}
  .score{flex:none;font-size:.9rem;font-weight:600;font-variant-numeric:tabular-nums}
  .cat{flex:none;font-size:.73rem;color:var(--muted);border:1px solid var(--line);
       border-radius:999px;padding:1px 9px}
  .card h2{font-family:var(--display);font-size:1.02rem;line-height:1.55;margin:0 0 8px;text-wrap:balance}
  .card h2 a{color:inherit;text-decoration:none}
  .card h2 a:hover{color:var(--accent);text-decoration:underline}
  .sum{margin:0 0 10px;color:var(--muted);font-size:.87rem}
  ul.why{margin:0 0 10px;padding-inline-start:17px;font-size:.82rem;color:var(--muted)}
  .facts{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.78rem;color:var(--muted);
         font-variant-numeric:tabular-nums}
  .facts b{color:var(--ink);font-weight:600}
  .facts a{color:var(--accent)}
  details{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}
  summary{cursor:pointer;font-size:.82rem;color:var(--accent);font-weight:500}
  summary:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  details pre{white-space:pre-wrap;font-family:var(--body);font-size:.84rem;background:var(--bg);
              border:1px solid var(--line);border-radius:9px;padding:12px;margin:10px 0}
  .angle{margin:0 0 10px;font-size:.8rem;color:var(--heat)}
  button{font:inherit;font-size:.82rem;padding:6px 14px;border-radius:8px;cursor:pointer;
         border:1px solid var(--line);background:var(--bg);color:var(--ink)}
  button:hover{border-color:var(--accent)}
  button.ok{background:var(--accent);color:#fff;border-color:transparent}
  footer{margin-top:28px;padding-top:16px;border-top:1px solid var(--line);
         color:var(--muted);font-size:.78rem}
  @media(max-width:460px){
    .head{flex-wrap:wrap}
    .meter{order:3;flex:1 0 100%}
    section.trends li{grid-template-columns:minmax(0,1fr) 56px auto}
  }
  @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>

<div class="wrap" lang="ar">
  <header class="top">
    <h1>رادار البوز المغربي</h1>
    <p class="meta">${esc(stamp)} · <b>${p.stats.articles}</b> خبر من <b>${p.stats.sourcesOk}</b> مصدر ·
       جُمّعت في <b>${p.stats.clusters}</b> موضوع · أُنجز في <b>${p.stats.durationSeconds}</b> ثانية</p>
    <p class="verdict">${passed
      ? `<b>${passed}</b> موضوع دار بوابة الـ80 — هادو هوما اللي كيتصيفطو.`
      : 'ما كاين حتى موضوع فاق 80 دابا — البوابة مسدودة، وما كيتصيفط والو. هادشي عادي فالأوقات الهادئة.'}</p>
  </header>

  ${trendRows ? `<section class="trends">
    <h3>الأكثر بحثًا في المغرب الآن</h3>
    <ol>${trendRows}</ol>
  </section>` : ''}

  <div class="legend">${legend}<span class="key">شريط النقطة كيوري تركيبتها</span></div>

  ${cards}

  <footer>
    كل نقطة مركّبة من ستة مؤشرات مقاسة: تطابق بحث Google المغرب بحجمه الحقيقي، عدد المواقع
    المختلفة اللي نقلات الخبر، سرعة النشر، حرارة الصياغة، الطزاجة، والتشابه مع مواضيع نجحات
    فصفحتك. الصور مربوطة كروابط حيت الصفحة ما كتحمّلش صور من مواقع خارجية.
  </footer>
</div>

<script>
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-copy]');
  if (!btn) return;
  const el = document.getElementById(btn.dataset.copy);
  if (!el) return;
  let done = false;
  try { await navigator.clipboard.writeText(el.textContent); done = true; }
  catch {
    try {
      const r = document.createRange(); r.selectNode(el);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      done = document.execCommand('copy'); s.removeAllRanges();
    } catch { done = false; }
  }
  const old = btn.textContent;
  btn.textContent = done ? 'تم النسخ' : 'حدّد النص ونسخو';
  btn.classList.toggle('ok', done);
  setTimeout(() => { btn.textContent = old; btn.classList.remove('ok'); }, 1800);
});
</script>`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');
console.log(`${outFile} · ${(html.length / 1024).toFixed(1)} KB · ${p.items.length} موضوع`);
