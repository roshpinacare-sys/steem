/**
 * notificationTemplates.js — ECOS V137
 * ─────────────────────────────────────────────────────────────────────────────
 * [V137-NE] i18n Notification Templates
 *
 * Provides localised title + body strings for each notification type, using
 * {{placeholder}} interpolation. RTL awareness is preserved (matching the
 * LanguageBridge convention from V129).
 *
 * Strategy:
 *   - Templates are keyed by notification type → locale → { title, body }.
 *   - `resolve(type, locale, vars)` returns { title, body } or null.
 *   - Falls back to 'en' when the requested locale has no template.
 *   - Zero external dependencies.
 *
 * Sacred files: fiatLedger.js, auditLog.js — NOT touched.
 */

'use strict';

// RTL locales — mirrors SUPPORTED_LANGUAGES from lib/languageBridge.js
const RTL_LOCALES = new Set(['he', 'ar', 'fa']);

// ─────────────────────────────────────────────────────────────────────────────
// Template registry
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATES = {
  tier_promotion: {
    en: {
      title: 'Promoted to {{tier}} 🎉',
      body:  'Congratulations — you advanced from {{from}} to {{to}}. New privileges are now unlocked.',
    },
    he: {
      title: 'קודמת ל-{{tier}} 🎉',
      body:  'כל הכבוד — עלית מ-{{from}} ל-{{to}}. הרשאות חדשות נפתחו עבורך.',
    },
    ar: {
      title: 'ترقية إلى {{tier}} 🎉',
      body:  'تهانينا — لقد تقدمت من {{from}} إلى {{to}}. تم فتح امتيازات جديدة.',
    },
    es: {
      title: 'Ascendido a {{tier}} 🎉',
      body:  'Felicitaciones — avanzaste de {{from}} a {{to}}. Nuevos privilegios desbloqueados.',
    },
    fr: {
      title: 'Promu au rang {{tier}} 🎉',
      body:  'Félicitations — vous êtes passé de {{from}} à {{to}}. Nouveaux privilèges débloqués.',
    },
    de: {
      title: 'Beförderung zu {{tier}} 🎉',
      body:  'Herzlichen Glückwunsch — Sie stiegen von {{from}} auf {{to}} auf. Neue Privilegien wurden freigeschaltet.',
    },
    zh: {
      title: '晋升至 {{tier}} 🎉',
      body:  '恭喜！您从 {{from}} 晋升至 {{to}}，新权限已解锁。',
    },
    ru: {
      title: 'Повышен до {{tier}} 🎉',
      body:  'Поздравляем — вы продвинулись с {{from}} до {{to}}. Новые привилегии разблокированы.',
    },
  },

  tier_demotion: {
    en: {
      title: 'Rank changed to {{tier}}',
      body:  'Your rank moved from {{from}} to {{to}}.',
    },
    he: {
      title: 'הדרגה שונתה ל-{{tier}}',
      body:  'הדרגה שלך עברה מ-{{from}} ל-{{to}}.',
    },
    ar: {
      title: 'تغيير الرتبة إلى {{tier}}',
      body:  'انتقلت رتبتك من {{from}} إلى {{to}}.',
    },
    es: {
      title: 'Rango cambiado a {{tier}}',
      body:  'Tu rango pasó de {{from}} a {{to}}.',
    },
    fr: {
      title: 'Rang changé à {{tier}}',
      body:  'Votre rang est passé de {{from}} à {{to}}.',
    },
    de: {
      title: 'Rang geändert zu {{tier}}',
      body:  'Ihr Rang hat sich von {{from}} auf {{to}} geändert.',
    },
    zh: {
      title: '等级变更为 {{tier}}',
      body:  '您的等级从 {{from}} 变更为 {{to}}。',
    },
    ru: {
      title: 'Ранг изменён на {{tier}}',
      body:  'Ваш ранг изменился с {{from}} на {{to}}.',
    },
  },

  streak_reminder: {
    en: {
      title: "Don't break your {{streak}}-day streak! 🔥",
      body:  "You're on a {{streak}}-day streak but haven't been active today. Complete an action to keep it alive.",
    },
    he: {
      title: 'אל תשבר את הרצף של {{streak}} ימים! 🔥',
      body:  'אתה ברצף של {{streak}} ימים אך לא היית פעיל היום. בצע פעולה כדי לשמור עליו.',
    },
    ar: {
      title: 'لا تكسر تسلسل {{streak}} يوم! 🔥',
      body:  'أنت في تسلسل {{streak}} يوم لكنك لم تكن نشطًا اليوم. أكمل إجراءً للحفاظ عليه.',
    },
    es: {
      title: '¡No rompas tu racha de {{streak}} días! 🔥',
      body:  'Tienes una racha de {{streak}} días pero no has estado activo hoy. Completa una acción para mantenerla.',
    },
    fr: {
      title: 'Ne brisez pas votre série de {{streak}} jours ! 🔥',
      body:  'Vous êtes sur une série de {{streak}} jours mais vous n\'avez pas été actif aujourd\'hui.',
    },
    de: {
      title: 'Brechen Sie Ihre {{streak}}-Tage-Serie nicht! 🔥',
      body:  'Sie sind auf einer {{streak}}-Tage-Serie, waren aber heute nicht aktiv.',
    },
    zh: {
      title: '不要中断你的 {{streak}} 天连续记录！🔥',
      body:  '您有 {{streak}} 天的连续记录，但今天还未活跃。完成一项操作以保持记录。',
    },
    ru: {
      title: 'Не прерывайте серию {{streak}} дней! 🔥',
      body:  'Вы поддерживаете серию {{streak}} дней, но сегодня ещё не были активны.',
    },
  },

  channel_broadcast: {
    en: { title: '📡 {{channel}}', body: '{{message}}' },
    he: { title: '📡 {{channel}}', body: '{{message}}' },
    ar: { title: '📡 {{channel}}', body: '{{message}}' },
    es: { title: '📡 {{channel}}', body: '{{message}}' },
    fr: { title: '📡 {{channel}}', body: '{{message}}' },
    de: { title: '📡 {{channel}}', body: '{{message}}' },
    zh: { title: '📡 {{channel}}', body: '{{message}}' },
    ru: { title: '📡 {{channel}}', body: '{{message}}' },
  },

  // [V139-RN01] reaction_received — fired when someone reacts to your message
  reaction_received: {
    en: {
      title: '{{emoji}} reaction from {{reactorId}}',
      body:  'Someone reacted {{emoji}} to your message in {{channelId}}.',
    },
    he: {
      title: '{{emoji}} תגובה מ-{{reactorId}}',
      body:  'מישהו הגיב {{emoji}} על ההודעה שלך בערוץ {{channelId}}.',
    },
    ar: {
      title: '{{emoji}} تفاعل من {{reactorId}}',
      body:  'تفاعل شخص ما {{emoji}} مع رسالتك في {{channelId}}.',
    },
    es: {
      title: '{{emoji}} reacción de {{reactorId}}',
      body:  'Alguien reaccionó {{emoji}} a tu mensaje en {{channelId}}.',
    },
    fr: {
      title: '{{emoji}} réaction de {{reactorId}}',
      body:  'Quelqu&#39;un a réagi {{emoji}} à votre message dans {{channelId}}.',
    },
    de: {
      title: '{{emoji}} Reaktion von {{reactorId}}',
      body:  'Jemand reagierte {{emoji}} auf Ihre Nachricht in {{channelId}}.',
    },
    zh: {
      title: '{{reactorId}} 用 {{emoji}} 回应了你',
      body:  '有人在 {{channelId}} 对你的消息使用了 {{emoji}} 反应。',
    },
    ru: {
      title: '{{emoji}} реакция от {{reactorId}}',
      body:  'Кто-то отреагировал {{emoji}} на ваше сообщение в {{channelId}}.',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a localised { title, body } pair for the given type and locale.
 * Falls back to 'en' if the locale is not found.
 *
 * @param {string} type     - notification type (e.g. 'tier_promotion')
 * @param {string} locale   - BCP 47 short code (e.g. 'he', 'en', 'fr')
 * @param {object} vars     - placeholder values { tier, from, to, streak, channel, message }
 * @returns {{ title: string, body: string } | null}
 */
function resolve(type, locale, vars = {}) {
  const lang = TEMPLATES[type];
  if (!lang) return null;

  const normalised = (locale || 'en').toLowerCase().split('-')[0]; // 'he-IL' → 'he'
  const tmpl = lang[normalised] || lang['en'];
  if (!tmpl) return null;

  function interpolate(s) {
    return String(s).replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`
    );
  }

  // If we used the fallback ('en'), report 'en' as the resolved locale
  const resolvedLocale = lang[normalised] ? normalised : 'en';

  return {
    title: interpolate(tmpl.title),
    body:  interpolate(tmpl.body),
    locale: resolvedLocale,
    rtl:   RTL_LOCALES.has(resolvedLocale),
  };
}

/** Returns true for right-to-left locales. */
function isRtl(locale) {
  return RTL_LOCALES.has((locale || '').toLowerCase().split('-')[0]);
}

/** List of supported locale codes for this template registry. */
function supportedLocales() {
  const all = new Set();
  for (const lang of Object.values(TEMPLATES)) {
    for (const code of Object.keys(lang)) all.add(code);
  }
  return [...all].sort();
}

module.exports = { TEMPLATES, resolve, isRtl, supportedLocales, RTL_LOCALES };
