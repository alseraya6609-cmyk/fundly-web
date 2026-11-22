/*
  عامل خدمة فَندلي للإشعارات والموقع مغلق (Web Push عبر Firebase).
  دالة الخادم fundly-push ترسل رسالة بيانات فقط بأعمدة fundly_inbox
  (id, sender_name, sender_fnd, source, entry_type, title, action, note, ...)،
  وهنا يُكتب الإشعار بلغة المستخدم (تحفظها الصفحة في ذاكرة fundly-sw) كما
  يفعل التطبيق (FundlyAccount.inboxNotice)، ويفتح الضغط عليه صفحة الطلبات.
*/

const TITLES = {
  ar: {
    announcement: 'إعلان من فَندلي',
    admin: 'رسالة من فَندلي',
    support: 'رد الدعم الفني على بلاغك',
    activity: 'إضافة جديدة',
    response: 'رد على ما أرسلته',
    invite: 'وصلك طلب جديد',
  },
  en: {
    announcement: 'Announcement from Fundly',
    admin: 'Message from Fundly',
    support: 'Support replied to your report',
    activity: 'New Addition',
    response: 'Reply to what you sent',
    invite: 'You have a new request',
  },
  fr: {
    announcement: 'Annonce de Fundly',
    admin: 'Message de Fundly',
    support: 'Le support a répondu à votre signalement',
    activity: 'Nouvel ajout',
    response: 'Réponse à votre envoi',
    invite: 'Vous avez une nouvelle demande',
  },
  ur: {
    announcement: 'Fundly کی جانب سے اعلان',
    admin: 'Fundly کی جانب سے پیغام',
    support: 'سپورٹ نے آپ کی رپورٹ کا جواب دیا',
    activity: 'نیا اضافہ',
    response: 'آپ کی بھیجی ہوئی چیز کا جواب',
    invite: 'آپ کو نئی درخواست ملی ہے',
  },
  zh: {
    announcement: 'Fundly 公告',
    admin: '来自 Fundly 的消息',
    support: '客服已回复您的反馈',
    activity: '新增',
    response: '对您所发送内容的回复',
    invite: '您有一个新请求',
  },
}

async function language() {
  try {
    const cache = await caches.open('fundly-sw')
    const hit = await cache.match('/__fundly_lang')
    const lang = hit ? (await hit.text()).trim() : ''
    return TITLES[lang] ? lang : 'ar'
  } catch (_) {
    return 'ar'
  }
}

function noteOf(raw) {
  try {
    const parsed = JSON.parse(raw || '')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function notice(data, lang) {
  const tr = TITLES[lang]
  const action = data.action || 'invite'
  const title = String(data.title || '').trim()
  const who = String(data.sender_name || '').trim() || String(data.sender_fnd || '').trim()
  const note = noteOf(data.note)
  const body = String(note.body || '').trim()
  if (action === 'announcement') return [`${tr.announcement} — ${title}`, body]
  if (action === 'admin_message') return [`${tr.admin} — ${title}`, body]
  if (action === 'support') return [tr.support, title ? `«${title}»${body ? `: ${body}` : ''}` : body]
  if (action === 'activity') {
    const name = String(note.name || '').trim()
    return [`${tr.activity} — ${title}`, `${who}${name ? ` — «${name}»` : ''}`]
  }
  const response = ['accepted', 'rejected', 'archived', 'removed'].includes(action)
  return [response ? tr.response : tr.invite, `${who}${title ? ` — «${title}»` : ''}`]
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (_) {
    payload = {}
  }
  // FCM: {data: {...}, from, fcmMessageId}
  const data = payload && typeof payload.data === 'object' ? payload.data : payload || {}
  const id = String(data.id || '').trim()
  if (!id) return
  event.waitUntil(
    (async () => {
      const lang = await language()
      const [title, body] = notice(data, lang)
      await self.registration.showNotification(title, {
        body,
        tag: `inbox_${id}`,
        icon: '/img/logo.png',
        badge: '/img/logo.png',
        lang,
        dir: lang === 'ar' || lang === 'ur' ? 'rtl' : 'ltr',
        data: { url: '/requests' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/requests'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
