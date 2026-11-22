import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { useInbox, useStore } from '@/lib/data'
import { useCalendar } from '@/lib/calendar'
import { askPermission, dueReminders, freshInbox, inboxNotice, notifyPermission, planReminders, reminderSettings, showNotice } from '@/lib/notify'
import { registerWebPush, setPushLanguage, webPushConfigured, type PushState } from '@/lib/webPush'

/*
  الإشعارات في الموقع (FundlyNotifications / FundlyPush في التطبيق):
  - Notifier في الهيكل العام: الطلبات الجديدة (الفحص كل 30 ثانية) والتذكيرات
    التي حان وقتها، والموقع مفتوح. ورمز Web Push لهذا المتصفح إن ضُبط.
  - NotificationsCard في «المزيد»: إذن المتصفح وحالته.
*/

const PERMISSION_EVENT = 'fundly-notify-permission'

function usePermission() {
  const [permission, setPermission] = useState(notifyPermission())
  useEffect(() => {
    const update = () => setPermission(notifyPermission())
    window.addEventListener(PERMISSION_EVENT, update)
    window.addEventListener('focus', update)
    return () => {
      window.removeEventListener(PERMISSION_EVENT, update)
      window.removeEventListener('focus', update)
    }
  }, [])
  return permission
}

/** التذكيرات: مواعيد اليوم والانتهاء، كل دقيقة (يحمّل بيانات الكلندر فقط حين يُسمح بالإشعار). */
function ReminderNotifier({ userId }: { userId: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const store = useStore()
  const { loading, items } = useCalendar()
  const settings = reminderSettings(store.data)
  const planned = useMemo(
    () => (loading || !store.isSuccess ? [] : planReminders(items, settings, new Date(), t)),
    [loading, items, store.isSuccess, settings.enabled, settings.expiry, settings.leadDays, t],
  )
  useEffect(() => {
    if (!planned.length) return
    const tick = () => {
      for (const p of dueReminders(userId, planned, new Date())) showNotice(`${p.key}@${p.at.getTime()}`, p.title, p.body, () => navigate(p.to || '/calendar'))
    }
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [planned, userId, navigate])
  return null
}

export function Notifier() {
  const { t, lang } = useI18n()
  const { user } = useSession()
  const navigate = useNavigate()
  const inbox = useInbox()
  const permission = usePermission()

  // الطلبات والردود والإعلانات الجديدة: مرة لكل طلب.
  useEffect(() => {
    if (!user || !inbox.data) return
    for (const item of freshInbox(user.id, inbox.data)) {
      const [title, body] = inboxNotice(item, t)
      showNotice(`inbox_${item.id}`, title, body, () => navigate('/requests'))
    }
  }, [inbox.data, user?.id])

  // رمز Web Push لهذا المتصفح (إن ضُبط Firebase) بعد الدخول والإذن، ولغة الإشعار.
  useEffect(() => {
    setPushLanguage(lang)
  }, [lang])
  useEffect(() => {
    if (user && permission === 'granted') registerWebPush()
  }, [user?.id, permission])

  return user && permission === 'granted' ? <ReminderNotifier userId={user.id} /> : null
}

/** بطاقة الإشعارات في «المزيد». */
export function NotificationsCard() {
  const { t } = useI18n()
  const store = useStore()
  const permission = usePermission()
  const [busy, setBusy] = useState(false)
  const [push, setPush] = useState<PushState | null>(null)
  const settings = reminderSettings(store.data)

  async function enable() {
    setBusy(true)
    try {
      await askPermission()
      window.dispatchEvent(new Event(PERMISSION_EVENT))
      if (notifyPermission() === 'granted') {
        setPush(await registerWebPush())
        showNotice('fundly_test', t('فوندلي'), t('ستصلك الإشعارات في هذا المتصفح.'))
      }
    } finally {
      setBusy(false)
    }
  }

  const status =
    permission === 'unsupported'
      ? 'هذا المتصفح لا يدعم الإشعارات.'
      : permission === 'denied'
        ? 'الإشعارات محظورة لهذا الموقع — اسمح بها من إعدادات الموقع في المتصفح.'
        : permission === 'granted'
          ? 'الإشعارات مفعّلة في هذا المتصفح.'
          : 'فعّل الإشعارات لتصلك الطلبات الجديدة والتذكيرات.'

  return (
    <div className="card flex items-start gap-3 p-4">
      <BellRing className="mt-0.5 size-5 text-brand" />
      <div className="flex-1 text-[13px] leading-relaxed text-sub">
        <p className="font-bold text-ink">{t(status)}</p>
        <p className="mt-1">
          {t(
            webPushConfigured()
              ? 'تصلك الطلبات الجديدة ولو كان الموقع مغلقًا، والتذكيرات والموقع مفتوح.'
              : 'تصلك الطلبات الجديدة والتذكيرات والموقع مفتوح، والتطبيق ينبّهك وهو مغلق.',
          )}
        </p>
        {!settings.enabled && <p className="mt-1 font-bold text-gold-dark">{t('تذكيرات المواعيد موقوفة من إعدادات التطبيق.')}</p>}
        {push === 'error' && <p className="mt-1 font-bold text-danger">{t('تعذّر تفعيل الإشعارات والموقع مغلق — حاول لاحقًا.')}</p>}
        {permission === 'default' && (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="mt-3 flex h-10 items-center gap-2 rounded-inner bg-brand px-4 text-[13px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('تفعيل الإشعارات')}
          </button>
        )}
      </div>
    </div>
  )
}
