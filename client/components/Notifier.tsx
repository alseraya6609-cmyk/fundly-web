import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlarmClock, BellRing, Loader2, Play, Square } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { useInbox, useStore } from '@/lib/data'
import { useCalendar } from '@/lib/calendar'
import { askPermission, dueReminders, freshInbox, inboxNotice, notifyPermission, planReminders, reminderSettings, showNotice } from '@/lib/notify'
import { registerWebPush, setPushLanguage, webPushConfigured, type PushState } from '@/lib/webPush'
import { ALARM_EVENT, DEFAULT_TONE, TONES, alarmSettings, playAlarm, ringing, saveAlarmSettings, stopAlarm, type AlarmSettings } from '@/lib/alarm'

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
      for (const p of dueReminders(userId, planned, new Date())) {
        showNotice(`${p.key}@${p.at.getTime()}`, p.title, p.body, () => {
          stopAlarm()
          navigate(p.to || '/calendar')
        })
        // منبّه المتابعة والتخطيط: الرنة المختارة لهذا المتصفح.
        if (p.alarm) playAlarm(p.title)
      }
    }
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [planned, userId, navigate])
  return null
}

/** شريط «إيقاف المنبّه» والرنة تعمل. */
function AlarmBar() {
  const { t } = useI18n()
  const [title, setTitle] = useState(ringing())
  useEffect(() => {
    const update = () => setTitle(ringing())
    window.addEventListener(ALARM_EVENT, update)
    return () => window.removeEventListener(ALARM_EVENT, update)
  }, [])
  if (!title) return null
  return (
    <div role="alert" className="fixed inset-x-3 bottom-20 z-[65] mx-auto flex max-w-md items-center gap-3 rounded-card bg-brand-deep px-4 py-3 text-white shadow-2xl md:bottom-6">
      <AlarmClock className="size-6 shrink-0 animate-pulse text-gold-light" />
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-bold text-white/70">{t('منبّه المتابعة والتخطيط')}</p>
        <p dir="auto" className="truncate text-[14px] font-extrabold">
          {title}
        </p>
      </div>
      <button type="button" onClick={stopAlarm} className="flex h-10 shrink-0 items-center gap-1.5 rounded-inner bg-white px-3 text-[13px] font-extrabold text-brand-deep hover:bg-brand-soft">
        <Square className="size-3.5 fill-current" />
        {t('إيقاف')}
      </button>
    </div>
  )
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

  return (
    <>
      {user && permission === 'granted' && <ReminderNotifier userId={user.id} />}
      <AlarmBar />
    </>
  )
}

/** «منبّه المتابعة والتخطيط»: الرنة لهذا المتصفح، والإنذار المستمر، وتجربتها. */
export function AlarmSettingsBox() {
  const { t } = useI18n()
  const [value, setValue] = useState<AlarmSettings>(alarmSettings())
  const [blocked, setBlocked] = useState(false)
  const update = (next: AlarmSettings) => {
    setValue(next)
    saveAlarmSettings(next)
  }
  async function test() {
    setBlocked(false)
    if (value.tone === DEFAULT_TONE) return
    const ok = await playAlarm(t('تجربة رنة المنبّه'), value)
    if (!ok) setBlocked(true)
  }
  return (
    <div className="mt-3 rounded-inner bg-brand-soft p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-brand-dark">
        <AlarmClock className="size-4" />
        {t('منبّه المتابعة والتخطيط')}
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-sub">
        {t('رنة تصلك في موعد المهام والمواعيد والاجتماعات وتذكيرات التقويم — بدل الإشعار الخافت.')}
      </p>
      <label className="mt-2 block">
        <span className="mb-1 block text-[11.5px] font-bold text-sub">{t('رنة المنبّه')}</span>
        <select
          value={value.tone}
          onChange={(e) => update({ ...value, tone: e.target.value })}
          className="h-10 w-full rounded-field bg-white px-3 text-[13px] text-title outline-none ring-1 ring-line focus:ring-2 focus:ring-gold"
        >
          {TONES.map((x) => (
            <option key={x.id} value={x.id}>
              {t(x.label)}
            </option>
          ))}
        </select>
      </label>
      <label className={`mt-2 flex items-start gap-2 text-[12.5px] ${value.tone === DEFAULT_TONE ? 'opacity-50' : ''}`}>
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--color-brand)]"
          disabled={value.tone === DEFAULT_TONE}
          checked={value.insistent}
          onChange={(e) => update({ ...value, insistent: e.target.checked })}
        />
        <span>
          <span className="block font-bold text-ink">{t('إنذار مستمر حتى أوقفه')}</span>
          <span className="block text-[11.5px] text-sub">{t('تتكرر الرنة حتى تضغط «إيقاف» أو الإشعار')}</span>
        </span>
      </label>
      <button
        type="button"
        onClick={test}
        disabled={value.tone === DEFAULT_TONE}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-inner border border-brand bg-white text-[13px] font-extrabold text-brand hover:bg-brand-soft disabled:opacity-50"
      >
        <Play className="size-4" />
        {t('تجربة الرنة')}
      </button>
      {blocked && <p className="mt-1 text-[11.5px] font-bold text-danger">{t('المتصفح منع تشغيل الصوت — اضغط في الصفحة ثم جرّب مرة أخرى.')}</p>}
      <p className="mt-2 text-[11px] text-muted">{t('الرنة تعمل والموقع مفتوح في هذا المتصفح، والتطبيق يرنّ وهو مغلق.')}</p>
    </div>
  )
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
        <AlarmSettingsBox />
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
