import { supabase } from './supabase'

/*
  إشعارات والموقع مغلق (Web Push) — مثل FundlyPush في التطبيق: رمز هذا
  المتصفح من Firebase يُحفظ باسم الحساب (fundly_register_push، المنصة web)،
  ودالة الخادم fundly-push نفسها ترسل كل طلب جديد في fundly_inbox إلى رموز
  أجهزة المستلم — ومنها هذا المتصفح. عامل الخدمة /fundly-push-sw.js يعرض
  الإشعار.

  يعمل فقط بعد ضبط إعداد تطبيق الويب من مشروع Firebase نفسه في متغيرات
  البيئة (قيم عامة لا أسرار): VITE_FIREBASE_API_KEY، VITE_FIREBASE_PROJECT_ID،
  VITE_FIREBASE_MESSAGING_SENDER_ID، VITE_FIREBASE_APP_ID، VITE_FIREBASE_VAPID_KEY.
  وبدونها تبقى إشعارات الموقع وهو مفتوح فقط (notify.ts).
*/

const env = (v: unknown) => String(v ?? '').trim()

const config = {
  apiKey: env(import.meta.env.VITE_FIREBASE_API_KEY),
  projectId: env(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  messagingSenderId: env(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: env(import.meta.env.VITE_FIREBASE_APP_ID),
}
const vapidKey = env(import.meta.env.VITE_FIREBASE_VAPID_KEY)

const TOKEN_KEY = 'fundly_web_push_token'
const SW_URL = '/fundly-push-sw.js'

export const webPushConfigured = () => !!(config.apiKey && config.projectId && config.messagingSenderId && config.appId && vapidKey)

export const webPushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export type PushState = 'on' | 'unconfigured' | 'unsupported' | 'no-permission' | 'error'

async function messaging() {
  const [{ getApps, initializeApp }, fm] = await Promise.all([import('firebase/app'), import('firebase/messaging')])
  if (!(await fm.isSupported())) return null
  const app = getApps().find((a) => a.name === 'fundly-web') ?? initializeApp(config, 'fundly-web')
  return { fm, instance: fm.getMessaging(app) }
}

/** لغة الإشعارات في عامل الخدمة (يقرؤها من ذاكرة مؤقتة صغيرة). */
export async function setPushLanguage(lang: string) {
  try {
    const cache = await caches.open('fundly-sw')
    await cache.put('/__fundly_lang', new Response(lang))
  } catch {
    // بلا Cache API: يبقى العربي.
  }
}

/**
 * بعد الدخول، وإذن الإشعارات ممنوح: رمز هذا المتصفح باسم الحساب. لا يطلب
 * الإذن بنفسه — يُطلب من زر «تفعيل الإشعارات» فقط.
 */
export async function registerWebPush(): Promise<PushState> {
  if (!webPushConfigured()) return 'unconfigured'
  if (!webPushSupported()) return 'unsupported'
  if (Notification.permission !== 'granted') return 'no-permission'
  try {
    const registration = await navigator.serviceWorker.register(SW_URL)
    const m = await messaging()
    if (!m) return 'unsupported'
    const token = await m.fm.getToken(m.instance, { vapidKey, serviceWorkerRegistration: registration })
    if (!token) return 'error'
    const { error } = await supabase.rpc('fundly_register_push', { p_token: token, p_platform: 'web' })
    if (error) return 'error'
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      // يُعاد عند الفتح التالي.
    }
    return 'on'
  } catch {
    return 'error'
  }
}

/** عند الخروج: لا تصل إشعارات الحساب لهذا المتصفح بعد ذلك. */
export async function unregisterWebPush() {
  let token = ''
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? ''
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // لا شيء
  }
  if (!token) return
  try {
    await supabase.rpc('fundly_unregister_push', { p_token: token })
  } catch {
    // لا شيء
  }
  if (!webPushSupported()) return
  try {
    // إلغاء اشتراك المتصفح: يبطل الرمز، ودالة الخادم تحذفه إن بقي.
    const registration = await navigator.serviceWorker.getRegistration(SW_URL)
    const subscription = await registration?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  } catch {
    // لا شيء
  }
}
