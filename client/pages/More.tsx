import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CalendarDays, ReceiptText, Check, Copy, Ellipsis, FileBarChart, FileText, Globe, LayoutDashboard, LifeBuoy, LogOut, ShieldCheck, Smartphone, Trash2, UserRound } from 'lucide-react'
import { LANGS, useI18n, type Lang } from '@/lib/i18n'
import { WEB_VERSION, useSession } from '@/lib/session'
import { useStore } from '@/lib/data'
import { cn } from '@/lib/format'
import { IconBadge, InfoRow, PageHeader, SectionTitle } from '@/components/ui'
import { SITE, StoreLinks } from './Gates'
import { NotificationsCard } from '@/components/Notifier'

/** اختيار اللغة — اللغات الخمس نفسها في التطبيق. */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n()
  if (compact) {
    return (
      <label className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[13px] font-bold text-body">
        <Globe className="size-4" />
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="bg-transparent outline-none"
          aria-label={t('اللغة')}
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          className={cn(
            'flex h-11 items-center gap-2 rounded-inner border px-4 text-[14px] font-bold',
            lang === l.code ? 'border-brand bg-brand text-white' : 'border-line bg-white text-body hover:border-hairline',
          )}
        >
          {lang === l.code && <Check className="size-4" />}
          {l.label}
        </button>
      ))}
    </div>
  )
}

export default function More() {
  const { t, lang } = useI18n()
  const { user, profile, signOut } = useSession()
  const store = useStore()
  const [copied, setCopied] = useState(false)
  const q = lang === 'ar' ? '' : `?lang=${lang}`

  const name = String(store.data?.['settings_profile_name'] ?? '').trim() || profile?.display_name || ''
  const phone = String(store.data?.['settings_profile_phone'] ?? '').trim() || profile?.phone || ''

  async function copyId() {
    if (!profile?.fnd_id) return
    try {
      await navigator.clipboard.writeText(profile.fnd_id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // الحافظة غير متاحة: لا شيء.
    }
  }

  const links = [
    { icon: ShieldCheck, label: 'سياسة الخصوصية', href: `${SITE}/privacy.html${q}` },
    { icon: FileText, label: 'شروط الاستخدام', href: `${SITE}/terms.html${q}` },
    { icon: LifeBuoy, label: 'الدعم الفني', href: 'mailto:support@fundlyglobal.com' },
  ]

  return (
    <div>
      <PageHeader icon={Ellipsis} color="#0A5A50" title="المزيد" back={false} />

      <div className="card p-5">
        <div className="flex items-center gap-3">
          <IconBadge icon={UserRound} color="#0A5A50" size={56} solid />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] font-extrabold text-title">{name || t('صاحب الحساب')}</p>
            {profile?.fnd_id && (
              <button type="button" onClick={copyId} className="mt-0.5 flex items-center gap-1.5 text-[13px] font-bold text-gold-dark">
                <span className="ltr">{profile.fnd_id}</span>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            )}
          </div>
        </div>
        <div className="card-inner mt-4 px-4">
          <InfoRow label="البريد الإلكتروني" value={user?.email} ltr />
          <InfoRow label="رقم الهاتف" value={phone} ltr />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(
          [
            ['/calendar', 'الكلندر الذكي', CalendarDays],
            ['/requests', 'الطلبات', Bell],
            ['/summary', 'الملخص الشامل', LayoutDashboard],
            ['/reports', 'التقارير', FileBarChart],
            ['/salary', 'سندات القبض والرواتب', ReceiptText],
            ['/delegations', 'التفويضات', ShieldCheck],
            ['/trash', 'سلة المهملات', Trash2],
            ['/support', 'إرسال بلاغ أو اقتراح', LifeBuoy],
          ] as const
        ).map(([to, label, Icon]) => (
          <Link key={to} to={to} className="card flex flex-col items-center gap-2 px-2 py-4 text-center hover:bg-line/70">
            <Icon className="size-6 text-brand" />
            <span className="text-[12px] font-bold text-ink">{t(label)}</span>
          </Link>
        ))}
      </div>

      <SectionTitle>{t('اللغة')}</SectionTitle>
      <LanguagePicker />

      <SectionTitle>{t('الإشعارات')}</SectionTitle>
      <NotificationsCard />

      <SectionTitle>{t('روابط')}</SectionTitle>
      <div className="card divide-y divide-line overflow-hidden">
        {links.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-4 hover:bg-line/60">
            <l.icon className="size-5 text-brand" />
            <span className="flex-1 text-[14px] font-bold text-ink">{t(l.label)}</span>
          </a>
        ))}
      </div>

      <SectionTitle>{t('التطبيق')}</SectionTitle>
      <div className="card flex items-start gap-3 p-4">
        <Smartphone className="mt-0.5 size-5 text-brand" />
        <div className="flex-1 text-[13px] leading-relaxed text-sub">
          {t('ما تفعله في الموقع يُحفظ في حسابك ويظهر في التطبيق.')}
          <StoreLinks className="mt-3" />
        </div>
      </div>

      <button
        type="button"
        onClick={signOut}
        className="mt-6 flex h-13 w-full items-center justify-center gap-2 rounded-field bg-danger-soft py-3.5 text-[15px] font-extrabold text-danger hover:bg-danger/15"
      >
        <LogOut className="size-5" />
        {t('تسجيل الخروج')}
      </button>
      <p className="mt-4 text-center text-[11px] text-muted">
        {t('إصدار الموقع')} <span className="ltr">{WEB_VERSION}</span>
      </p>
    </div>
  )
}
