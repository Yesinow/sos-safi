// facebook.js — boucle de retour depuis TA page (ce qui a deja fait reagir) + publication.
// Le jeton et l'ID de page viennent de l'environnement : jamais du depot.
//   FB_PAGE_ID    = identifiant numerique de la page
//   FB_PAGE_TOKEN = Page Access Token (permissions pages_read_engagement, pages_manage_posts)

import { getJson } from './http.js';
import { tokens } from './normalize.js';

const graph = (cfg) => `https://graph.facebook.com/${cfg.facebook.graphVersion || 'v21.0'}`;

export function fbCredentials(cfg) {
  const pageId = process.env.FB_PAGE_ID || cfg.facebook.pageId || '';
  const token = process.env.FB_PAGE_TOKEN || '';
  return { pageId, token, ready: Boolean(pageId && token) };
}

/**
 * Lit les publications recentes de TA page et en deduit les mots qui marchent
 * sur TON audience. C'est le seul « pouls de page » que l'API Graph autorise
 * encore : Meta ne donne plus les statistiques des pages que tu n'administres pas.
 */
export async function learnPageProfile(cfg, deadline, log) {
  const { pageId, token, ready } = fbCredentials(cfg);
  if (!cfg.facebook.enabled || !ready) return null;

  const limit = cfg.facebook.learnFromLastPosts || 50;
  const fields = 'message,created_time,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)';
  const url = `${graph(cfg)}/${pageId}/posts?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(token)}`;

  const res = await getJson(url, { timeoutMs: cfg.runtime.fetchTimeoutMs, userAgent: cfg.runtime.userAgent, deadline });
  if (!res.ok || !res.data || !Array.isArray(res.data.data)) {
    log(`تعذّر قراءة أداء صفحتك (${res.error || 'رد غير متوقع'}) — البوت غادي يخدم بلا هاد الإشارة`);
    return null;
  }

  const posts = res.data.data.filter((p) => p.message);
  if (posts.length < 5) {
    log('عدد المنشورات السابقة قليل — إشارة "ملاءمة الصفحة" غير مفعّلة');
    return null;
  }

  const engagement = posts.map((p) => ({
    message: p.message,
    score: (p.reactions?.summary?.total_count || 0)
         + 3 * (p.comments?.summary?.total_count || 0)
         + 5 * (p.shares?.count || 0),
  }));

  const median = [...engagement].sort((a, b) => a.score - b.score)[Math.floor(engagement.length / 2)].score || 1;
  const terms = new Map();
  for (const p of engagement) {
    const lift = p.score / Math.max(1, median);
    if (lift <= 1) continue; // on n'apprend que des posts au-dessus de la mediane
    for (const t of new Set(tokens(p.message))) {
      terms.set(t, (terms.get(t) || 0) + (lift - 1));
    }
  }
  const scale = Math.max(1, [...terms.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0));

  const top = [...terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  log(`تعلّم من ${posts.length} منشور سابق · المواضيع الأقوى عندك: ${top.join('، ') || '—'}`);
  return { terms, scale, sampled: posts.length, topTerms: top, median };
}

/** Publie (ou prepare) un post sur la page. Renvoie {ok, id, error}. */
export async function publishPost(cfg, post, { mode }) {
  const { pageId, token, ready } = fbCredentials(cfg);
  if (!ready) return { ok: false, error: 'FB_PAGE_ID / FB_PAGE_TOKEN غير متوفرين' };

  const body = new URLSearchParams({ message: post.text, access_token: token });
  if (post.link) body.set('link', post.link);

  if (mode === 'draft') body.set('published', 'false');
  else if (mode === 'schedule') {
    body.set('published', 'false');
    body.set('scheduled_publish_time', String(Math.floor(Date.now() / 1000) + 20 * 60));
  }

  return postForm(`${graph(cfg)}/${pageId}/feed`, body, cfg);
}

async function postForm(url, body, cfg) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': cfg.runtime.userAgent },
      body,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* reponse non JSON */ }
    if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    return { ok: true, id: data?.id || null };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}
