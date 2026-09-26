// compose.js — redaction du post Facebook pret a publier (arabe + touche darija).

import { originalTerms } from './normalize.js';
import { arPlural } from './score.js';

const CAT_LABEL = {
  sport: 'رياضة', politique: 'سياسة', economie: 'اقتصاد', societe: 'مجتمع',
  'faits-divers': 'حوادث', culture: 'ثقافة وفن', monde: 'دولي', general: 'عام',
};

const CAT_TAG = {
  sport: '#رياضة', politique: '#سياسة', economie: '#اقتصاد', societe: '#مجتمع',
  'faits-divers': '#حوادث', culture: '#ثقافة', monde: '#دولي', general: '#أخبار',
};

const HOOKS = {
  sport: ['🔥 خبر رياضي كيهز المغرب:', '⚽ الجديد فالساحة الرياضية:', '🏆 ها شنو وقع:'],
  politique: ['📌 قرار كيهم كل مغربي:', '🇲🇦 الجديد فالساحة السياسية:', '⚡ خبر سياسي مهم:'],
  economie: ['💸 كيمس جيبك مباشرة:', '📊 خبر اقتصادي مهم:', '⚠️ انتبه لهاد التغيير:'],
  societe: ['⚠️ خبر كيهم المغاربة:', '👥 هادشي كيوقع دابا:', '📣 موضوع كيشعل المواقع:'],
  'faits-divers': ['🚨 عاجل:', '⚡ واقعة هزّت المنطقة:', '🚔 تفاصيل مثيرة:'],
  culture: ['🎬 الجديد فعالم الفن:', '🎤 خبر كيشعل السوشيال:', '✨ ها شنو وقع:'],
  monde: ['🌍 خبر دولي كيهم المغرب:', '📡 من خارج الحدود:'],
  general: ['📰 خبر اليوم:', '🔔 هادشي كيتصدر المواقع:', '⚡ الجديد:'],
};

const CTA = {
  sport: ['شنو رأيك؟ 👇 علّق بتوقعاتك', 'واش تافق معانا؟ كتب رأيك فالتعليقات ⚽', 'شكون غادي يربح فنظرك؟ 👇'],
  politique: ['شنو رأيك فهاد القرار؟ 👇', 'واش هادشي غادي يبدّل شي حاجة؟ علّق 👇', 'كنتسناو رأيكم فالتعليقات 🇲🇦'],
  economie: ['واش حسّيتي بالفرق فجيبك؟ 👇', 'شنو رأيك؟ شاركنا تجربتك 💬', 'علّق بشحال كتصرف فالشهر 👇'],
  societe: ['واش عندك نفس المشكل فمدينتك؟ 👇', 'شاركنا تجربتك فالتعليقات 💬', 'شنو الحل فنظرك؟ 👇'],
  'faits-divers': ['شنو رأيك فهاد الواقعة؟ 👇', 'واش العقوبة كافية؟ علّق 💬', 'شاركو الخبر باش يوصل 🔁'],
  culture: ['واش عجبك؟ 👇', 'شنو رأيك؟ علّق 🎬', 'شاركنا رأيك فالتعليقات 💬'],
  monde: ['شنو رأيك؟ 👇', 'واش غادي يأثر علينا فالمغرب؟ علّق 💬'],
  general: ['شنو رأيك؟ علّق 👇', 'شاركنا رأيك فالتعليقات 💬', 'واش تافق؟ 👇'],
};

function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }

function trimSentence(text = '', max = 180) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('،'), cut.lastIndexOf('؛'), cut.lastIndexOf(' '));
  return `${cut.slice(0, stop > 60 ? stop : max)}…`;
}

function hashtags(cluster, cat) {
  const tags = new Set(['#المغرب']);
  const catTag = CAT_TAG[cat];
  if (catTag) tags.add(catTag);
  for (const term of originalTerms(cluster.title, 4)) {
    const t = term.replace(/[^\p{L}\p{N}]/gu, '');
    if (t.length >= 4 && t.length <= 18) tags.add(`#${t}`);
    if (tags.size >= 6) break;
  }
  return [...tags].join(' ');
}

/** Un « angle » de publication adapte au signal dominant. */
function angle(scored, cluster) {
  const s = scored.signals;
  const sites = arPlural(s.sourceCount, { one: 'موقع', two: 'موقعان', few: 'مواقع', many: 'موقعًا' });

  if (cluster.linkIsRedirect) {
    return { type: 'redirect', note: 'الرابط ديال Google News — حلّو وخُذ الرابط الأصلي ديال الموقع قبل ما تنشر' };
  }
  if (/فيديو|بالفيديو|شاهد|video/i.test(scored.rawTitle || '')) {
    return { type: 'video', note: 'فيه فيديو — حمّل الفيديو مباشرة ففايسبوك بدل الرابط، كيضاعف التفاعل' };
  }
  if (s.trendTraffic >= 5000) {
    return { type: 'trending', note: `من الأكثر بحثًا فالمغرب دابا (${s.trendTraffic.toLocaleString()}+ بحث) — انشر دابا` };
  }
  if (s.articlesPerHour >= 4) {
    return { type: 'fast', note: 'الخبر كينتشر بسرعة — نافذة النشر ضيقة، انشر فأقل من 30 دقيقة' };
  }
  if (s.sourceCount >= 5) {
    return { type: 'wide', note: `${sites} نشراتو — الخبر منتشر، زيد زاوية خاصة بك باش تميز` };
  }
  if (s.sourceCount === 1) {
    return { type: 'exclusive', note: 'مصدر وحيد — تأكد من الخبر قبل النشر، ويلا كان صحيح فهو سبق ديالك' };
  }
  return { type: 'normal', note: 'خبر عادي بإمكانية تفاعل متوسطة — حسّن العنوان بسؤال مباشر' };
}

export function composePost(cluster, scored) {
  const cat = scored.cat;
  const seed = cluster.id + cluster.count;
  const hook = pick(HOOKS[cat] || HOOKS.general, seed);
  const cta = pick(CTA[cat] || CTA.general, seed + 1);
  const title = cluster.title.replace(/\s+/g, ' ').trim();
  const body = trimSentence(cluster.summary, 200);
  const tags = hashtags(cluster, cat);

  const main = [
    `${hook} ${title}`,
    body && body.length > 40 && !title.includes(body.slice(0, 30)) ? `\n${body}` : '',
    `\n${cta}`,
    `\n${tags}`,
  ].filter(Boolean).join('\n');

  const alt = [
    `${title} 🤔`,
    `\n${cta}`,
    `\n${tags}`,
  ].join('\n');

  return {
    category: CAT_LABEL[cat] || cat,
    text: main.replace(/\n{3,}/g, '\n\n').trim(),
    altText: alt.replace(/\n{3,}/g, '\n\n').trim(),
    hashtags: tags,
    link: cluster.link,
    image: cluster.image || '',
    angle: angle({ ...scored, rawTitle: `${title} ${cluster.summary || ''}` }, cluster),
  };
}

const CAT_EMOJI = {
  sport: '⚽', politique: '🏛', economie: '💸', societe: '👥',
  'faits-divers': '🚨', culture: '🎬', monde: '🌍', general: '📰',
};

function ago(ts) {
  const h = (Date.now() - ts) / 3600000;
  if (h < 1) {
    const m = Math.max(1, Math.round(h * 60));
    return `منذ ${arPlural(m, { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة' })}`;
  }
  if (h < 24) {
    const n = Math.round(h);
    return `منذ ${arPlural(n, { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة' })}`;
  }
  const d = Math.round(h / 24);
  return `منذ ${arPlural(d, { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يومًا' })}`;
}

/**
 * Brief WhatsApp : titre + paragraphe court + pourquoi ca va reagir + lien.
 * Le gras WhatsApp s'ecrit *entre asterisques*. On reste sous 1024 caracteres
 * pour que le texte tienne en legende d'image.
 */
/** Mise en gras selon la destination : WhatsApp *gras*, Telegram <b>gras</b>. */
const FORMATS = {
  whatsapp: { bold: (t) => `*${t}*`, esc: (t) => t },
  html: {
    bold: (t) => `<b>${t}</b>`,
    esc: (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  },
  markdown: { bold: (t) => `**${t}**`, esc: (t) => String(t).replace(/([*_`~])/g, '\\$1') },
  plain: { bold: (t) => t, esc: (t) => t },
};

export function composeBrief(cluster, scored, post = null, { format = 'whatsapp' } = {}) {
  const fmt = FORMATS[format] || FORMATS.whatsapp;
  const emoji = CAT_EMOJI[scored.cat] || '📰';
  const label = CAT_LABEL[scored.cat] || scored.cat;
  const paragraph = trimSentence(cluster.summary || '', 300);
  const reasons = scored.why.slice(0, 2).join(' · ');

  const lines = [
    `${emoji} ${fmt.bold(label)} · نقطة البوز ${scored.score}/100`,
    '',
    fmt.bold(fmt.esc(cluster.title.trim())),
  ];
  if (paragraph && paragraph.length > 40) lines.push('', fmt.esc(paragraph));
  lines.push('', `📊 ${fmt.esc(reasons)}`);
  const sources = arPlural(scored.signals.sourceCount, { one: 'مصدر واحد', two: 'مصدران', few: 'مصادر', many: 'مصدرًا' });
  lines.push(`🕐 ${ago(cluster.lastDate)} · ${sources}`);
  if (post && post.angle && post.angle.note) lines.push(`💡 ${post.angle.note}`);
  if (cluster.link) lines.push('', `🔗 ${cluster.link}`);

  return lines.filter((l) => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
