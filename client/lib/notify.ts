import { inboxText, type InboxItem } from './data'
import { CLOSED_STATUSES, NO_REMINDER, nextOccurrence, type CalItem } from './metrics'

/*
  إشعارات المتصفح — مثل FundlyNotifications وFundlyPush في التطبيق:
  - الطلبات والردود والإعلانات الجديدة في fundly_inbox: فحص كل 30 ثانية والموقع
    مفتوح (pollInbox)، وكل طلب يُشعَر به مرة واحدة (fundly_inbox_notified).
  - تذكيرات المواعيد والانتهاء (_reschedule): نفس الحساب — ساعة البند أو 9:00،
    و«وقت التذكير» بالدقائق أو أيام التذكير (أو الافتراضي من الإعدادات)، ولا
    شيء لـ«بدون تذكير» ولا للمغلق، وتنبيهات الانتهاء حسب إعدادها. والتطبيق
    يجدولها في الجهاز؛ والموقع يُظهر ما حان وقته وهو مفتوح.
  - والموقع مغلق: Web Push عبر Firebase (webPush.ts) إن ضُبط في الإعدادات.
*/

export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window

export function notifyPermission(): NotificationPermission | 'unsupported' {
  return canNotify() ? Notification.permission : 'unsupported'
}

export async function askPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!canNotify()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/** إشعار واحد لكل مفتاح (tag): الثاني بنفس المفتاح يحلّ محل الأول. */
export async function showNotice(key: string, title: string, body: string, onClick?: () => void) {
  if (notifyPermission() !== 'granted') return
  const dir = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
  const options: NotificationOptions = { body, tag: key, icon: '/img/logo.png', dir, lang: document.documentElement.lang || undefined }
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      onClick?.()
      n.close()
    }
  } catch {
    // الجوال (أندرويد) يمنع new Notification: عبر عامل الخدمة إن كان مسجّلًا.
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
      await reg?.showNotification(title, { ...options, data: { url: '/requests' } })
    } catch {
      // لا شيء: يبقى الشارة في الطلبات.
    }
  }
}

// ---------------- ما أُشعر به (لكل حساب في هذا المتصفح) ----------------

function readList(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-300)))
  } catch {
    // تخزين ممتلئ أو ممنوع: قد يتكرر إشعار، ولا يتوقف شيء.
  }
}

// ---------------- الطلبات ----------------

/** FundlyAccount.inboxNotice: (العنوان، النص). */
export function inboxNotice(item: InboxItem, t: (s: string) => string): [string, string] {
  const action = item.action || 'invite'
  const title =
    action === 'announcement'
      ? `${t('إعلان من فَندلي')} — ${item.title}`
      : action === 'admin_message'
        ? `${t('رسالة من فَندلي')} — ${item.title}`
        : action === 'support'
          ? t('رد الدعم الفني على بلاغك')
          : action === 'activity'
            ? `${t('إضافة جديدة')} — ${item.title}`
            : t(['accepted', 'rejected', 'archived', 'removed'].includes(action) ? 'رد على ما أرسلته' : 'وصلك طلب جديد')
  return [title, inboxText(item, t)]
}

/**
 * الجديد مما لم يُشعَر به بعد. أول مرة في هذا المتصفح تُسجَّل الطلبات الحالية
 * بلا إشعار (حتى لا يصل سيل من الطلبات القديمة دفعة واحدة).
 */
export function freshInbox(userId: string, items: InboxItem[]): InboxItem[] {
  const key = `fundly_inbox_notified:${userId}`
  const done = readList(key)
  if (done === null) {
    writeList(key, items.map((i) => i.id))
    return []
  }
  const fresh = items.filter((i) => !done.includes(i.id))
  if (fresh.length) writeList(key, [...done, ...fresh.map((i) => i.id)])
  return fresh
}

// ---------------- التذكيرات ----------------

export type ReminderSettings = { enabled: boolean; expiry: boolean; leadDays: number }

/** AppSettings: settings_notifications_enabled / settings_expiry_notifications / settings_default_lead_time_days. */
export function reminderSettings(store: Record<string, unknown> | undefined): ReminderSettings {
  const bool = (k: string) => (typeof store?.[k] === 'boolean' ? (store[k] as boolean) : true)
  const options: Record<string, number> = { 'في نفس اليوم': 0, 'قبل يوم': 1, 'قبل 3 أيام': 3, 'قبل أسبوع': 7, 'قبل شهر': 30 }
  const stored = Number(store?.['settings_default_lead_time_days'])
  const leadDays = Object.values(options).includes(stored) ? stored : (options[String(store?.['settings_default_lead_time'] ?? '')] ?? 7)
  return { enabled: bool('settings_notifications_enabled'), expiry: bool('settings_expiry_notifications'), leadDays }
}

/** _parseClock: «13:36» أو «1:36 PM» أو «١:٣٦ م». */
export function parseClock(raw: string): [number, number] | null {
  const text = raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  if (!text) return null
  const m = text.match(/(\d{1,2})\s*[:٫.]\s*(\d{2})/)
  if (!m) return null
  let hour = parseInt(m[1], 10)
  const minute = parseInt(m[2], 10)
  const lower = text.toLowerCase()
  const pm = lower.includes('pm') || /(^|[\s\d])م/.test(text)
  const am = lower.includes('am') || /(^|[\s\d])ص/.test(text)
  if (pm && hour < 12) hour += 12
  if (am && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return [hour, minute]
}

export type PlannedNotice = { key: string; at: Date; title: string; body: string; to?: string; alarm?: boolean }

/** FundlyNotifications._isAlarmItem: بنود «المتابعة والتخطيط» وتذكيرات التقويم التي أنشأها المستخدم. */
export const isAlarmItem = (item: CalItem) => item.category === 'organization' || item.isUserCreated

const pad = (n: number) => String(n).padStart(2, '0')

/** FundlyNotifications._reschedule: مواعيد الإشعارات القادمة والحالية. */
export function planReminders(items: CalItem[], settings: ReminderSettings, now: Date, t: (s: string) => string): PlannedNotice[] {
  if (!settings.enabled) return []
  const out: PlannedNotice[] = []
  for (const item of items) {
    if (item.remindBeforeDays === NO_REMINDER) continue
    if (CLOSED_STATUSES.has(item.status.trim())) continue
    if (item.isExpiry && !settings.expiry) continue
    const clock = parseClock(item.time) ?? [9, 0]
    const lead = item.remindBeforeDays >= 0 ? item.remindBeforeDays : settings.leadDays
    let day = new Date(item.date.getFullYear(), item.date.getMonth(), item.date.getDate())
    let at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock[0], clock[1])
    // المتكرر الذي فات وقته اليوم: موعده التالي.
    if (at <= now && item.repeat) {
      const tomorrow = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
      const next = nextOccurrence(day, item.repeat, tomorrow)
      if (next > day) {
        day = next
        at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock[0], clock[1])
      }
    }
    const title = item.title.trim() || item.type
    const timeText = `${pad(clock[0])}:${pad(clock[1])}`
    const what = `«${title}» · ${t(item.module)}`
    const dateText = `${day.getDate()}/${day.getMonth() + 1}/${day.getFullYear()}`
    out.push({
      key: `${item.module}|${item.sourceId}|due`,
      at,
      title,
      body: item.isExpiry ? `${t('ينتهي اليوم')} (${dateText}) — ${what}` : `${t('موعده الآن')} ${timeText} — ${what}`,
      to: item.to,
      alarm: isAlarmItem(item),
    })
    if (item.leadMinutes > 0) {
      // «وقت التذكير»: قبل الموعد بساعة/12 ساعة/يوم أو مخصص.
      const m = item.leadMinutes
      const span = m % 1440 === 0 ? `${m / 1440} ${t(m / 1440 === 1 ? 'يوم' : 'أيام')}` : `${Math.round(m / 60)} ${t('ساعة')}`
      out.push({
        key: `${item.module}|${item.sourceId}|lead`,
        at: new Date(at.getTime() - m * 60_000),
        title,
        body: `${t('موعده بعد')} ${span} — ${dateText} ${timeText} — ${what}`,
        to: item.to,
        alarm: isAlarmItem(item),
      })
    } else if (lead > 0) {
      out.push({
        key: `${item.module}|${item.sourceId}|lead`,
        at: new Date(at.getFullYear(), at.getMonth(), at.getDate() - lead, clock[0], clock[1]),
        title,
        body: `${t(item.isExpiry ? 'ينتهي بعد' : 'موعده بعد')} ${lead} ${t(lead === 1 ? 'يوم' : 'أيام')} (${dateText}) — ${what}`,
        to: item.to,
        alarm: isAlarmItem(item),
      })
    }
  }
  return out
}

/**
 * ما حان وقته خلال [windowMinutes] الأخيرة ولم يُشعَر به في هذا المتصفح.
 * (ما فات قبل ذلك والموقع مغلق لا يُعرض متأخرًا.)
 */
export function dueReminders(userId: string, planned: PlannedNotice[], now: Date, windowMinutes = 15): PlannedNotice[] {
  const key = `fundly_reminders_notified:${userId}`
  const done = readList(key) ?? []
  const from = now.getTime() - windowMinutes * 60_000
  const due = planned.filter((p) => p.at.getTime() <= now.getTime() && p.at.getTime() > from && !done.includes(`${p.key}@${p.at.getTime()}`))
  if (due.length) writeList(key, [...done, ...due.map((p) => `${p.key}@${p.at.getTime()}`)])
  return due
}
