// whatsapp.js — envoi du brief (titre + paragraphe + image) sur TON WhatsApp.
// Quatre fournisseurs au choix, selectionnes par WA_PROVIDER. Les identifiants
// viennent toujours de l'environnement, jamais du depot.
//
//   cloud     (recommande) API officielle Meta — image + legende, gratuit
//             WA_PHONE_ID, WA_TOKEN, WA_TO
//   twilio    Twilio WhatsApp — image + legende
//             TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, WA_TO
//   ultramsg  UltraMsg — image + legende
//             ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN, WA_TO
//   greenapi  Green API — image + legende, connexion par QR une seule fois,
//             pas de fenetre de 24h : convient a un envoi automatique 24/24
//             GREENAPI_ID, GREENAPI_TOKEN, WA_TO
//   callmebot CallMeBot — texte seul, mise en route immediate
//             CALLMEBOT_APIKEY, WA_TO

import { post, postJson, postForm } from './http.js';

const CAPTION_LIMIT = 1024;   // limite d'une legende d'image WhatsApp
const TEXT_LIMIT = 4096;

const env = (k) => (process.env[k] || '').trim();

/** Normalise un numero en format international sans « + » ni espaces. */
export function normalizePhone(raw = '') {
  let n = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = `212${n.slice(1)}`;   // 06.. / 07.. -> 2126.. / 2127..
  return n;
}

const PROVIDERS = {
  cloud:     { vars: { phoneId: 'WA_PHONE_ID', token: 'WA_TOKEN' }, image: true },
  twilio:    { vars: { sid: 'TWILIO_SID', token: 'TWILIO_TOKEN', from: 'TWILIO_FROM' }, image: true },
  ultramsg:  { vars: { instance: 'ULTRAMSG_INSTANCE', token: 'ULTRAMSG_TOKEN' }, image: true },
  greenapi:  { vars: { id: 'GREENAPI_ID', token: 'GREENAPI_TOKEN' }, image: true },
  callmebot: { vars: { apikey: 'CALLMEBOT_APIKEY' }, image: false },
};

export function waConfig(cfg = {}) {
  const wa = cfg.whatsapp || {};
  const provider = (env('WA_PROVIDER') || wa.provider || 'cloud').toLowerCase();
  const spec = PROVIDERS[provider];
  const to = normalizePhone(env('WA_TO') || wa.to || '');

  if (!spec) {
    return { provider, to, creds: {}, ready: false, supportsImage: false, missing: [], unknown: true };
  }

  const creds = {};
  const missing = [];
  if (!to) missing.push('WA_TO');
  for (const [key, varName] of Object.entries(spec.vars)) {
    const value = env(varName);
    creds[key] = key === 'from' ? normalizePhone(value || '14155238886') : value;
    if (!creds[key]) missing.push(varName);
  }

  return {
    provider,
    to,
    creds,
    graphVersion: wa.graphVersion || 'v21.0',
    supportsImage: spec.image,
    ready: missing.length === 0,
    missing,
  };
}

const trim = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Envoie un message (avec image si le fournisseur et l'URL le permettent). */
export async function sendWhatsApp(wa, { text, imageUrl }) {
  if (!wa.ready) return { ok: false, error: `متغيرات ناقصة: ${wa.missing.join(', ')}` };
  const useImage = Boolean(imageUrl) && wa.supportsImage;
  const body = trim(text, useImage ? CAPTION_LIMIT : TEXT_LIMIT);

  switch (wa.provider) {
    case 'cloud': {
      const url = `https://graph.facebook.com/${wa.graphVersion}/${wa.creds.phoneId}/messages`;
      const payload = useImage
        ? { messaging_product: 'whatsapp', to: wa.to, type: 'image', image: { link: imageUrl, caption: body } }
        : { messaging_product: 'whatsapp', to: wa.to, type: 'text', text: { preview_url: true, body } };
      const res = await postJson(url, payload, { headers: { Authorization: `Bearer ${wa.creds.token}` } });
      return { ok: res.ok, id: res.data?.messages?.[0]?.id || null, error: res.error, withImage: useImage };
    }

    case 'twilio': {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${wa.creds.sid}/Messages.json`;
      const params = { From: `whatsapp:+${wa.creds.from}`, To: `whatsapp:+${wa.to}`, Body: body };
      if (useImage) params.MediaUrl = imageUrl;
      const auth = Buffer.from(`${wa.creds.sid}:${wa.creds.token}`).toString('base64');
      const res = await postForm(url, params, { headers: { Authorization: `Basic ${auth}` } });
      return { ok: res.ok, id: res.data?.sid || null, error: res.error, withImage: useImage };
    }

    case 'ultramsg': {
      const base = `https://api.ultramsg.com/${wa.creds.instance}`;
      const res = useImage
        ? await postForm(`${base}/messages/image`, { token: wa.creds.token, to: wa.to, image: imageUrl, caption: body })
        : await postForm(`${base}/messages/chat`, { token: wa.creds.token, to: wa.to, body });
      const sent = res.ok && !/error/i.test(res.data?.sent === false ? 'error' : '');
      return { ok: sent, id: res.data?.id || null, error: sent ? null : (res.error || res.text?.slice(0, 120)), withImage: useImage };
    }

    case 'greenapi': {
      const host = env('GREENAPI_HOST') || 'https://api.green-api.com';
      const base = `${host}/waInstance${wa.creds.id}`;
      const chatId = `${wa.to}@c.us`;
      const res = useImage
        ? await postJson(`${base}/sendFileByUrl/${wa.creds.token}`, { chatId, urlFile: imageUrl, fileName: 'news.jpg', caption: body })
        : await postJson(`${base}/sendMessage/${wa.creds.token}`, { chatId, message: body });
      return { ok: res.ok, id: res.data?.idMessage || null, error: res.error, withImage: useImage };
    }

    case 'callmebot': {
      // CallMeBot n'accepte que du texte : on ajoute l'image en lien.
      const full = imageUrl ? `${body}\n\n🖼 ${imageUrl}` : body;
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(wa.to)}`
        + `&apikey=${encodeURIComponent(wa.creds.apikey)}&text=${encodeURIComponent(trim(full, TEXT_LIMIT))}`;
      const res = await post(url, { body: '', contentType: 'text/plain' });
      const failed = !res.ok || /APIKey is invalid|error/i.test(res.text || '');
      return { ok: !failed, id: null, error: failed ? (res.error || res.text?.slice(0, 120)) : null, withImage: false };
    }

    default:
      return { ok: false, error: `مزوّد غير معروف: ${wa.provider}` };
  }
}
