// report.js — sorties : JSON (machine), Markdown (terminal/notes), HTML (tableau de bord RTL).

import fs from 'fs';
import path from 'path';

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtTime = (ts) => new Date(ts).toLocaleString('ar-MA', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

export function writeAll(outDir, payload) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const files = {
    json: path.join(outDir, 'buzz.json'),
    md: path.join(outDir, 'buzz.md'),
    html: path.join(outDir, 'buzz.html'),
    archive: path.join(outDir, `buzz-${stamp}.json`),
  };
  fs.writeFileSync(files.json, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(files.archive, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(files.md, renderMarkdown(payload), 'utf8');
  fs.writeFileSync(files.html, renderHtml(payload), 'utf8');
  return files;
}

export function renderMarkdown(p) {
  const lines = [
    `# 🔥 رادار البوز المغربي`,
    ``,
    `**${fmtTime(p.generatedAt)}** · ${p.stats.articles} خبر · ${p.stats.clusters} موضوع · ${p.stats.durationSeconds}s`,
    ``,
  ];
  if (p.trends?.length) {
    lines.push(`## 📈 الأكثر بحثًا في المغرب الآن`, ``);
    for (const t of p.trends.slice(0, 8)) lines.push(`- **${t.query}** — ${t.traffic.toLocaleString()}+ بحث`);
    lines.push(``);
  }
  lines.push(`## 🎯 المواضيع المرشحة للنشر`, ``);
  p.items.forEach((it, i) => {
    lines.push(`### ${i + 1}. [${it.score}/100] ${it.title}`);
    lines.push(``);
    lines.push(`\`${it.category}\` · ${it.signals.sourceCount} مصدر · منذ ${it.signals.ageHours} ساعة · [الرابط](${it.link})`);
    lines.push(``);
    it.why.forEach((w) => lines.push(`- ${w}`));
    lines.push(``, `**💡 ${it.post.angle.note}**`, ``);
    lines.push('```', it.post.text, '```', ``);
  });
  if (p.diag?.failed?.length) {
    lines.push(`---`, ``, `<details><summary>مصادر لم تستجب (${p.diag.failed.length})</summary>`, ``);
    p.diag.failed.forEach((f) => lines.push(`- ${f.name}: ${f.error}`));
    lines.push(``, `</details>`);
  }
  return lines.join('\n');
}

export function renderHtml(p) {
  const cards = p.items.map((it, i) => `
    <article class="card" style="--rank:${i}">
      <header>
        <span class="rank">${i + 1}</span>
        <div class="meter" title="نقطة البوز ${it.score}/100">
          <div class="bar" style="width:${it.score}%"></div>
          <span class="val">${it.score}</span>
        </div>
        <span class="cat">${esc(it.category)}</span>
      </header>
      <h2><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></h2>
      <ul class="why">${it.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p class="angle">💡 ${esc(it.post.angle.note)}</p>
      <div class="postbox">
        <pre id="p${i}">${esc(it.post.text)}</pre>
        <div class="actions">
          <button data-copy="p${i}">📋 نسخ المنشور</button>
          <button data-copy="a${i}">📋 نسخ النسخة القصيرة</button>
          <a class="btn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(it.link)}" target="_blank" rel="noopener">↗ مشاركة</a>
        </div>
        <pre id="a${i}" hidden>${esc(it.post.altText)}</pre>
      </div>
      <footer>
        <span>${esc(it.sources.slice(0, 4).join(' · '))}</span>
        <span>${it.signals.sourceCount} مصدر · ${it.signals.ageHours}س</span>
      </footer>
    </article>`).join('');

  const trends = (p.trends || []).slice(0, 10).map((t) =>
    `<li><b>${esc(t.query)}</b><span>${t.traffic.toLocaleString()}+</span></li>`).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>رادار البوز المغربي</title>
<style>
  :root{
    --bg:#f6f7f9; --panel:#fff; --ink:#15181d; --muted:#697283; --line:#e3e7ee;
    --accent:#c1272d; --accent-2:#006233; --hot:#e8590c;
  }
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    --bg:#0e1116; --panel:#161b22; --ink:#e9edf3; --muted:#9aa4b2; --line:#252c37;
    --accent:#ff5a5f; --accent-2:#2ea36b; --hot:#ff9f43;
  }}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,"Segoe UI",Tahoma,Arial,sans-serif;padding:0 16px 48px}
  .wrap{max-width:820px;margin:0 auto}
  header.top{padding:28px 0 18px;border-bottom:1px solid var(--line);margin-bottom:22px}
  h1{margin:0 0 6px;font-size:1.6rem}
  .meta{color:var(--muted);font-size:.9rem}
  .trends{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin-bottom:24px}
  .trends h3{margin:0 0 10px;font-size:1rem;color:var(--muted);font-weight:600}
  .trends ol{margin:0;padding:0 18px 0 0}
  .trends li{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px dashed var(--line)}
  .trends li:last-child{border:0}
  .trends span{color:var(--hot);font-variant-numeric:tabular-nums;font-size:.85rem}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:18px}
  .card header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .rank{width:28px;height:28px;flex:none;display:grid;place-items:center;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;font-size:.85rem}
  .meter{position:relative;flex:1;height:22px;background:var(--bg);border-radius:11px;overflow:hidden;border:1px solid var(--line)}
  .bar{height:100%;background:linear-gradient(90deg,var(--accent-2),var(--hot),var(--accent))}
  .val{position:absolute;inset:0;display:grid;place-items:center;font-size:.78rem;font-weight:700}
  .cat{flex:none;font-size:.78rem;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 10px}
  .card h2{margin:0 0 10px;font-size:1.12rem;line-height:1.5}
  .card h2 a{color:inherit;text-decoration:none}
  .card h2 a:hover{text-decoration:underline}
  ul.why{margin:0 0 10px;padding:0 18px 0 0;color:var(--muted);font-size:.88rem}
  .angle{margin:0 0 12px;font-size:.9rem;color:var(--hot)}
  .postbox pre{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 10px;font:inherit}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  button,.btn{font:inherit;font-size:.86rem;padding:7px 14px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer;text-decoration:none}
  button:hover,.btn:hover{border-color:var(--accent)}
  button.done{background:var(--accent-2);color:#fff;border-color:transparent}
  .card footer{display:flex;justify-content:space-between;gap:12px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);color:var(--muted);font-size:.8rem;flex-wrap:wrap}
  @media(max-width:520px){.card header{flex-wrap:wrap}.meter{order:3;width:100%;flex:1 0 100%}}
</style>
<div class="wrap">
  <header class="top">
    <h1>🔥 رادار البوز المغربي</h1>
    <p class="meta">${fmtTime(p.generatedAt)} · ${p.stats.articles} خبر من ${p.stats.sourcesOk} مصدر · ${p.stats.clusters} موضوع · أُنجز في ${p.stats.durationSeconds} ثانية</p>
  </header>
  ${trends ? `<section class="trends"><h3>📈 الأكثر بحثًا في المغرب الآن</h3><ol>${trends}</ol></section>` : ''}
  ${cards}
</div>
<script>
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-copy]');
  if (!btn) return;
  const el = document.getElementById(btn.dataset.copy);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
  } catch {
    const r = document.createRange(); r.selectNode(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand('copy'); s.removeAllRanges();
  }
  const old = btn.textContent;
  btn.textContent = '✅ تم النسخ';
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1600);
});
</script>
</html>`;
}
