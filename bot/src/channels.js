// channels.js — ou envoyer les briefs. Trois canaux sans WhatsApp, tous en
// « colle une valeur, c'est fini » : aucun QR, aucune validation, aucun compte
// business. WhatsApp reste disponible via le module dedie.
//
//   telegram  (recommande) bot cree en 1 minute avec @BotFather — image + legende
//             TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
//   ntfy      le plus simple du monde : aucun compte, juste un nom de sujet
//             NTFY_TOPIC  (+ NTFY_SERVER si tu heberges le tien)
//   discord   une URL de webhook collee depuis les reglages du salon
//             DISCORD_WEBHOOK
//   whatsapp  voir whatsapp.js
//   console   rien n'est envoye : tout s'affiche dans le terminal

import { postJson } from './http.js';
import { waConfig, sendWhatsApp } from './whatsapp.js';

const env = (k) => (process.env[k] || '').trim();

const TG_CAPTION_LIMIT = 1024;
const TG_TEXT_LIMIT = 4096;
const trim = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export const CHANNELS = {
  telegram: { vars: ['TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID'], format: 'html', image: true },
  ntfy:     { vars: ['NTFY_TOPIC'], format: 'plain', image: true },
  discord:  { vars: ['DISCORD_WEBHOOK'], format: 'markdown', image: true },
  whatsapp: { vars: [], format: 'whatsapp', image: true },
  console:  { vars: [], format: 'plain', image: true },
};

/** Determine le canal actif et verifie que ses variables sont presentes. */
export function resolveChannel(cfg = {}) {
  const name = (env('BUZZ_CHANNEL') || cfg.delivery?.channel || 'telegram').toLowerCase();
  const spec = CHANNELS[name];
  if (!spec) return { name, ready: false, unknown: true, missing: [], format: 'plain' };

  if (name === 'whatsapp') {
    const wa = waConfig(cfg);
    return { name, ready: wa.ready, missing: wa.missing, format: 'whatsapp', supportsImage: wa.supportsImage, wa };
  }

  const missing = spec.vars.filter((v) => !env(v));
  return { name, ready: missing.length === 0, missing, format: spec.format, supportsImage: spec.image };
}

/** Envoie un brief. Ne jette jamais : renvoie {ok, id, error, withImage}. */
export async function send(channel, { text, imageUrl, link }) {
  if (!channel.ready) return { ok: false, error: `متغيرات ناقصة: ${channel.missing.join(', ')}` };
  const useImage = Boolean(imageUrl) && channel.supportsImage !== false;

  switch (channel.name) {
    case 'telegram': {
      const token = env('TELEGRAM_TOKEN');
      const chatId = env('TELEGRAM_CHAT_ID');
      const base = `https://api.telegram.org/bot${token}`;
      const res = useImage
        ? await postJson(`${base}/sendPhoto`, {
            chat_id: chatId, photo: imageUrl,
            caption: trim(text, TG_CAPTION_LIMIT), parse_mode: 'HTML',
          })
        : await postJson(`${base}/sendMessage`, {
            chat_id: chatId, text: trim(text, TG_TEXT_LIMIT),
            parse_mode: 'HTML', disable_web_page_preview: false,
          });
      // Telegram repond 200 avec {ok:false} quand la photo distante est refusee :
      // on retombe alors sur un message texte plutot que de perdre le brief.
      if (res.ok && res.data?.ok === false && useImage) {
        const retry = await postJson(`${base}/sendMessage`, {
          chat_id: chatId, text: trim(text, TG_TEXT_LIMIT), parse_mode: 'HTML',
        });
        return { ok: Boolean(retry.ok && retry.data?.ok), id: retry.data?.result?.message_id || null, error: retry.data?.description || retry.error, withImage: false };
      }
      const ok = Boolean(res.ok && res.data?.ok);
      return { ok, id: res.data?.result?.message_id || null, error: ok ? null : (res.data?.description || res.error), withImage: useImage };
    }

    case 'ntfy': {
      // Publication en JSON (et non par en-tetes) : les en-tetes HTTP ne
      // transportent pas l'arabe, le corps JSON si.
      const server = env('NTFY_SERVER') || 'https://ntfy.sh';
      const payload = { topic: env('NTFY_TOPIC'), message: text, markdown: false };
      if (link) payload.click = link;
      if (useImage) payload.attach = imageUrl;
      const headers = {};
      const token = env('NTFY_TOKEN');
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await postJson(server, payload, { headers });
      return { ok: res.ok, id: res.data?.id || null, error: res.error, withImage: useImage };
    }

    case 'discord': {
      const embed = { description: trim(text, 4000) };
      if (link) embed.url = link;
      if (useImage) embed.image = { url: imageUrl };
      const res = await postJson(env('DISCORD_WEBHOOK'), { embeds: [embed] });
      return { ok: res.ok, id: null, error: res.error, withImage: useImage };
    }

    case 'whatsapp':
      return sendWhatsApp(channel.wa, { text, imageUrl });

    case 'console':
      console.log(`\n${'═'.repeat(54)}\n${text}${useImage ? `\n\n🖼 ${imageUrl}` : ''}`);
      return { ok: true, id: null, error: null, withImage: useImage };

    default:
      return { ok: false, error: `قناة غير معروفة: ${channel.name}` };
  }
}
