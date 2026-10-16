// http.js — récupération réseau avec timeout, budget global et pool de concurrence.
// Aucune dépendance externe : on utilise le fetch natif de Node >= 18.

export class Deadline {
  constructor(seconds) {
    this.start = Date.now();
    this.end = this.start + seconds * 1000;
  }
  get remainingMs() { return Math.max(0, this.end - Date.now()); }
  get elapsedS() { return ((Date.now() - this.start) / 1000).toFixed(1); }
  expired(marginMs = 0) { return this.remainingMs <= marginMs; }
}

/** GET texte avec timeout dur. Ne jette jamais : renvoie {ok, body, status, error}. */
export async function getText(url, { timeoutMs = 12000, userAgent, deadline, headers = {} } = {}) {
  const budget = deadline ? Math.min(timeoutMs, deadline.remainingMs) : timeoutMs;
  if (budget <= 200) return { ok: false, status: 0, body: '', error: 'budget epuise' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': userAgent || 'Mozilla/5.0 (compatible; BuzzMarocBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/json, text/html;q=0.8',
        'Accept-Language': 'ar,fr;q=0.8,en;q=0.5',
        ...headers,
      },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson(url, opts = {}) {
  const r = await getText(url, opts);
  if (!r.ok) return { ok: false, data: null, error: r.error, status: r.status };
  try {
    return { ok: true, data: JSON.parse(r.body), error: null, status: r.status };
  } catch (e) {
    return { ok: false, data: null, error: 'json invalide', status: r.status };
  }
}

/** Exécute `worker` sur chaque item avec au plus `limit` tâches en parallèle. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { error: String(e && e.message || e) };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/** POST generique. Ne jette jamais : renvoie {ok, status, data, text, error}. */
export async function post(url, { body, contentType, headers = {}, timeoutMs = 15000, userAgent } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': contentType || 'application/json',
        'User-Agent': userAgent || 'Mozilla/5.0 (compatible; BuzzMarocBot/1.0)',
        ...headers,
      },
      body,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* reponse non JSON */ }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      return { ok: false, status: res.status, data, text, error: msg };
    }
    return { ok: true, status: res.status, data, text, error: null };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: '', error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

export const postJson = (url, obj, opts = {}) =>
  post(url, { ...opts, body: JSON.stringify(obj), contentType: 'application/json' });

export const postForm = (url, params, opts = {}) =>
  post(url, { ...opts, body: new URLSearchParams(params).toString(), contentType: 'application/x-www-form-urlencoded' });
