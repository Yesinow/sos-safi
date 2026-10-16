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
// Pour chaque axe de fracture, l'angle qui fait commenter — formule la
// question que le lecteur marocain a deja en tete, au lieu de resumer.
const AXIS_ANGLE = {
  'معيشة': 'اربط الخبر بجيب المغربي: شحال غادي يخسر/يربح فالشهر؟ سول الناس بشحال وليت كتخلص',
  'تعليم': 'سول الأولياء: واش هاد القرار غادي ينفع ولادكم ولا لا؟ التعليم كيجيب شهادات شخصية',
  'صحة': 'سول على التجربة: شكون دخل للمستعجلات هاد العام وشنو لقا؟',
  'فساد': 'ركّز على الرقم والمسؤولية: شحال ضاع وشكون خاصو يجاوب — بلا ما تسمي حد بلا دليل',
  'عدالة': 'حط السؤال المبدئي: واش القانون كيتطبق بحال بحال على الجميع؟',
  'هوية': 'موضوع كيقسم بزاف — خلي السؤال محايد وخلي التعليقات هوما اللي يدويو',
  'دين': 'موضوع حساس — صيغة السؤال أحسن من صيغة الرأي، وحيّد أي حكم على الناس',
  'نساء': 'عطي الوجهين بإنصاف فالبوست نفسه، وسول: فين كاين الحق؟',
  'هجرة': 'اربطو بالقصة الإنسانية ماشي بالأرقام وحدها',
  'سيادة': 'زاوية وطنية — كتجيب تفاعل كبير، ولكن تأكد من المصدر الرسمي قبل النشر',
  'رياضة_جدل': 'الجمهور كيحب يحكم بنفسو: حط اللقطة والسؤال، وخليه يقرر',
  'مرفق_عام': 'سول: فين كاين هاد المشكل فحيكم؟ الناس كتعلق بالصور ديال حومتها',
};

const AXIS_LABEL_AR = {
  'معيشة': 'القدرة الشرائية', 'تعليم': 'التعليم', 'صحة': 'الصحة', 'فساد': 'الفساد والريع',
  'عدالة': 'العدالة', 'هوية': 'الهوية واللغة', 'دين': 'الدين والحريات', 'نساء': 'قضايا النساء',
  'هجرة': 'الهجرة', 'سيادة': 'الوحدة الترابية', 'رياضة_جدل': 'جدل رياضي', 'مرفق_عام': 'الخدمات العمومية',
};

function angle(scored, cluster) {
  const s = scored.signals;
  const sites = arPlural(s.sourceCount, { one: 'موقع', two: 'موقعان', few: 'مواقع', many: 'موقعًا' });

  // La ligne editoriale passe avant le trafic : si la garde a retenu quelque
  // chose, c'est la premiere chose que tu dois lire.
  if (s.guardReasons && s.guardReasons.length) {
    return { type: 'guard', note: `⚖️ ${s.guardReasons.join(' · ')} — صلّح الصيغة ولا حيّد الخبر` };
  }
  // L'axe de debat prime sur la mecanique de diffusion : c'est lui qui
  // transforme une reprise en conversation.
  const axes = s.debateAxes || [];
  if (axes.length) {
    const label = axes.map((a) => AXIS_LABEL_AR[a] || a).join(' + ');
    const tip = AXIS_ANGLE[axes[0]] || 'حط السؤال المباشر فآخر البوست';
    const split = axes.length > 1 ? ' (موضوع كيقسم — التعليقات غادي تكثر)' : '';
    return { type: 'debate', axes, note: `🔥 جدل: ${label}${split} — ${tip}` };
  }

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

/**
 * Bloc nom / portefeuille d'une alerte de remaniement. On plafonne la liste :
 * la legende d'une image WhatsApp/Telegram ne depasse pas 1024 caracteres.
 */
function ministersBlock(ministers, fmt, max = 12) {
  if (!ministers || !ministers.length) return [];
  const lines = ['', fmt.bold('🏛 الأسماء والمناصب:')];
  for (const m of ministers.slice(0, max)) {
    lines.push(`• ${fmt.esc(m.portfolio)} — ${fmt.bold(fmt.esc(m.name))}`);
  }
  const rest = ministers.length - max;
  if (rest > 0) lines.push(`• و${arPlural(rest, { one: 'منصب آخر', two: 'منصبان آخران', few: 'مناصب أخرى', many: 'منصبًا آخر' })}`);
  // Honnete : ces couples sont lus automatiquement dans le corps des articles,
  // qui citent aussi l'ancienne equipe. On le dit au lieu de faire semblant.
  lines.push('⚠️ الأسماء مستخرجة آليًا من نص المقالات — تأكد منها قبل النشر');
  return lines;
}

export function composeBrief(cluster, scored, post = null, { format = 'whatsapp', watch = null, ministers = null } = {}) {
  const fmt = FORMATS[format] || FORMATS.whatsapp;
  const emoji = CAT_EMOJI[scored.cat] || '📰';
  const label = CAT_LABEL[scored.cat] || scored.cat;
  const paragraph = trimSentence(cluster.summary || '', 300);
  const reasons = scored.why.slice(0, 2).join(' · ');

  const lines = [];
  // Sujet sous surveillance : l'entete dit pourquoi il arrive hors porte virale.
  if (watch) {
    lines.push(fmt.bold(fmt.esc(`${watch.label} — أولوية قصوى`)));
    lines.push(watch.confirmed
      ? fmt.esc(`✅ مؤكد: ${watch.confirms.slice(0, 2).join(' · ')}`)
      : fmt.esc('⏳ لحظة بلحظة — الموضوع مازال فمرحلة المشاورات'));
    lines.push('');
  }
  lines.push(
    `${emoji} ${fmt.bold(label)} · نقطة البوز ${scored.score}/100`,
    '',
    fmt.bold(fmt.esc(cluster.title.trim())),
  );
  if (paragraph && paragraph.length > 40) lines.push('', fmt.esc(paragraph));
  lines.push(...ministersBlock(ministers, fmt));
  lines.push('', `📊 ${fmt.esc(reasons)}`);
  const sources = arPlural(scored.signals.sourceCount, { one: 'مصدر واحد', two: 'مصدران', few: 'مصادر', many: 'مصدرًا' });
  lines.push(`🕐 ${ago(cluster.lastDate)} · ${sources}`);
  if (post && post.angle && post.angle.note) lines.push(`💡 ${post.angle.note}`);
  if (cluster.link) lines.push('', `🔗 ${cluster.link}`);

  return lines.filter((l) => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
