import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, FileCheck2, Loader2, Wrench } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/format'

/** صفحات السياسة والشروط وحذف الحساب على الموقع نفسه (public/*.html). */
export const SITE = ''
const APP_STORE = 'https://apps.apple.com/app/id6829661981'

/** روابط المتجرين: من إعدادات لوحة التحكم إن وُجدت. */
export function StoreLinks({ className }: { className?: string }) {
  const { t } = useI18n()
  const { config } = useSession()
  const ios = config?.ios_url || APP_STORE
  const android = config?.android_url
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      <a
        href={ios}
        target="_blank"
        rel="noreferrer"
        className="rounded-full bg-white px-4 py-2 text-[13px] font-bold text-brand ring-1 ring-line hover:ring-brand"
      >
        {t('App Store')}
      </a>
      {android && (
        <a
          href={android}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-white px-4 py-2 text-[13px] font-bold text-brand ring-1 ring-line hover:ring-brand"
        >
          {t('Google Play')}
        </a>
      )}
    </div>
  )
}

function GateLayout({ icon, color, title, children }: { icon: ReactNode; color: string; title: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="grid min-h-screen place-items-center bg-surface px-5">
      <div className="w-full max-w-md rounded-card bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-icon" style={{ background: `${color}1f`, color }}>
          {icon}
        </div>
        <h1 className="text-[20px] font-extrabold text-title">{t(title)}</h1>
        <div className="mt-3 text-[14px] leading-relaxed text-sub">{children}</div>
      </div>
    </div>
  )
}

export function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-brand">
      <img src="/img/logo.png" alt="" className="h-20 w-auto animate-pulse rounded-2xl bg-white p-2" />
    </div>
  )
}

export function Maintenance() {
  const { t } = useI18n()
  const { config, user } = useSession()
  return (
    <GateLayout icon={<Wrench className="size-8" />} color="#CE8422" title="التطبيق تحت الصيانة">
      <p>{config?.maintenance_message || t('نعمل على تحسين الخدمة، وسنعود قريبًا.')}</p>
      {!user && (
        <Link to="/login" className="mt-6 inline-block text-[13px] font-bold text-brand underline">
          {t('تسجيل الدخول')}
        </Link>
      )}
    </GateLayout>
  )
}

export function Suspended() {
  const { t } = useI18n()
  const { account, signOut } = useSession()
  return (
    <GateLayout icon={<Ban className="size-8" />} color="#C4392E" title="حسابك موقوف">
      {account?.reason && <p>{account.reason}</p>}
      <p className="mt-2">{t('للاستفسار تواصل مع الدعم')}</p>
      <a href="mailto:support@fundlyglobal.com" className="ltr mt-1 block font-bold text-brand">
        support@fundlyglobal.com
      </a>
      <button
        type="button"
        onClick={signOut}
        className="mt-6 h-12 w-full rounded-field bg-surface font-bold text-body hover:bg-line"
      >
        {t('تسجيل الخروج')}
      </button>
    </GateLayout>
  )
}

/** الموافقة على إصدار السياسة الحالي — نفس دالة التطبيق fundly_accept_policy. */
export function PolicyConsent() {
  const { t, lang } = useI18n()
  const { config, acceptPolicy, signOut } = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const q = lang === 'ar' ? '' : `?lang=${lang}`
  async function accept() {
    setBusy(true)
    setError('')
    try {
      await acceptPolicy()
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <GateLayout icon={<FileCheck2 className="size-8" />} color="#0A5A50" title="تحديث سياسة الخصوصية وشروط الاستخدام">
      {config?.policy_note && <p className="mb-3">{config.policy_note}</p>}
      <p>{t('للمتابعة اقرأ السياسة والشروط ووافق عليها.')}</p>
      <div className="mt-4 flex justify-center gap-4 text-[13px] font-bold">
        <a className="text-brand underline" href={`${SITE}/privacy.html${q}`} target="_blank" rel="noreferrer">
          {t('سياسة الخصوصية')}
        </a>
        <a className="text-brand underline" href={`${SITE}/terms.html${q}`} target="_blank" rel="noreferrer">
          {t('شروط الاستخدام')}
        </a>
      </div>
      {error && <p className="mt-4 rounded-inner bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand font-extrabold text-white hover:bg-brand-dark disabled:opacity-70"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t('أوافق')}
      </button>
      <button type="button" onClick={signOut} className="mt-3 h-11 w-full text-[13px] font-bold text-muted">
        {t('تسجيل الخروج')}
      </button>
    </GateLayout>
  )
}
