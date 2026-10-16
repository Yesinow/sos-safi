// cluster.js — regroupe les articles qui racontent la MEME histoire.
// Le nombre de medias distincts dans un cluster est le signal de propagation le plus fiable.

import { tokenSet, similarity } from './normalize.js';

const isRedirect = (url = '') => /news\.google\.com/.test(url);

const SIM_THRESHOLD = 0.34;

function hostOf(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function majority(values) {
  const count = new Map();
  for (const v of values) count.set(v, (count.get(v) || 0) + 1);
  let best = values[0], bestN = 0;
  for (const [v, n] of count) if (n > bestN && v !== 'general') { best = v; bestN = n; }
  return bestN ? best : (values[0] || 'general');
}

export function clusterArticles(articles) {
  const prepared = articles
    .map((a) => ({ ...a, tokens: tokenSet(`${a.title} ${a.summary || ''}`.slice(0, 220)), titleTokens: tokenSet(a.title) }))
    .filter((a) => a.titleTokens.size >= 2)
    .sort((a, b) => b.date - a.date);

  const clusters = [];
  const index = new Map(); // token -> Set(indices de clusters)

  for (const art of prepared) {
    const candidates = new Set();
    for (const t of art.titleTokens) {
      const ids = index.get(t);
      if (ids) for (const id of ids) candidates.add(id);
    }

    let bestId = -1, bestScore = 0;
    for (const id of candidates) {
      const s = similarity(art.titleTokens, clusters[id].tokens);
      if (s > bestScore) { bestScore = s; bestId = id; }
    }

    if (bestId >= 0 && bestScore >= SIM_THRESHOLD) {
      const c = clusters[bestId];
      c.members.push(art);
      for (const t of art.titleTokens) c.tokens.add(t);
    } else {
      const id = clusters.length;
      clusters.push({ id, tokens: new Set(art.titleTokens), members: [art] });
      for (const t of art.titleTokens) {
        if (!index.has(t)) index.set(t, new Set());
        index.get(t).add(id);
      }
    }
  }

  return clusters.map(finalize).sort((a, b) => b.lastDate - a.lastDate);
}

function finalize(c) {
  const members = c.members;
  // Article representatif : titre, lien et resume viennent du MEME article, sinon le
  // post renvoie vers autre chose que ce qu'il annonce. On privilegie un lien direct
  // (les redirections news.google.com sont inutilisables dans une publication), puis
  // le media le plus fiable, puis le titre le plus informatif.
  const rep = [...members].sort((a, b) =>
    (Number(Boolean(b.link) && !isRedirect(b.link)) - Number(Boolean(a.link) && !isRedirect(a.link)))
    || (b.trust - a.trust)
    || (b.title.length - a.title.length))[0];
  const link = rep.link || '';

  const sources = new Set();
  const hosts = new Set();
  for (const m of members) {
    if (m.source) sources.add(String(m.source).trim());
    const h = hostOf(m.link);
    if (h && !h.includes('news.google')) hosts.add(h);
  }

  const dates = members.map((m) => m.date);
  const image = rep.image || (members.find((m) => m.image) || {}).image || '';

  return {
    id: c.id,
    title: rep.title,
    link,
    linkIsRedirect: isRedirect(link),
    image,
    summary: rep.summary || (members.find((m) => m.summary && m.summary.length > 60) || rep).summary || '',
    cat: majority(members.map((m) => m.cat)),
    sources: [...sources],
    hosts: [...hosts],
    sourceCount: Math.max(sources.size, hosts.size, 1),
    members,
    count: members.length,
    firstDate: Math.min(...dates),
    lastDate: Math.max(...dates),
    tokens: c.tokens,                    // union de tous les titres : sert au regroupement
    repTokens: tokenSet(rep.title),      // titre representatif seul : sert aux comparaisons fines
    trust: Math.max(...members.map((m) => m.trust)),
  };
}
