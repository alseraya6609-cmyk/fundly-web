import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Building2,
  Camera,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Eraser,
  Eye,
  FileText,
  Globe,
  Home as HomeIcon,
  Image as ImageIcon,
  Info,
  KeyRound,
  LifeBuoy,
  Loader2,
  LogOut,
  PenLine,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Stamp,
  Trash2,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { LANGS, useI18n, type Lang } from '@/lib/i18n'
import { WEB_VERSION, moduleHidden, useSession } from '@/lib/session'
import { useStore } from '@/lib/data'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { StoreError } from '@/lib/storeWrite'
import {
  CALENDARS,
  CURRENCIES,
  HOME_TITLES,
  LEAD_TIMES,
  PAD_HEIGHT,
  PAD_WIDTH,
  PAGE_CATALOG,
  PAGE_TITLES,
  SHARED_NAME_MODES,
  SHARED_NAME_NICK,
  SettingsError,
  changePassword,
  deleteMyAccount,
  imageSrc,
  imageToBase64,
  itemKey,
  loadFaq,
  normalizeOrder,
  profileFrom,
  publicNameFor,
  saveHomeLayout,
  saveLogo,
  savePageHidden,
  saveProfile,
  saveSignature,
  saveStamp,
  setCalendar,
  setCurrency,
  setExpiryNotices,
  setLeadDays,
  validHidden,
  type Point,
  type ProfileInput,
} from '@/lib/settingsWrite'
import { reminderSettings } from '@/lib/notify'
import { signatureStrokes } from '@/lib/lease'
import { Confirm } from '@/components/Confirm'
import { AlarmSettingsBox, NotificationsCard } from '@/components/Notifier'
import { Empty, ErrorBox, Loading, PageHeader, SectionTitle, Sheet } from '@/components/ui'
import { SITE } from './Gates'

/*
  «الإعدادات» كما في التطبيق (SettingsHubPage وما يتفرع منها)، على نفس
  مفاتيح الحساب فتظهر التغييرات في التطبيق بالمزامنة:
  /settings                  القائمة
  /settings/profile          البيانات الشخصية (ProfileDataSettingsPage)
  /settings/notifications    التنبيهات والتذكير
  /settings/language         اللغة والعملة والتقويم
  /settings/pages            تخصيص الصفحات (+ /settings/pages/home و /settings/pages/<page>)
  /settings/signature        التوقيع الإلكتروني والختم والشعار
  /settings/faq              الأسئلة الشائعة
  /settings/about            حول التطبيق
  قفل التطبيق وحجم النص والمزامنة خاصة بالجوال فلا تُنقل.
*/

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

const messageOf = (e: unknown) => (e instanceof SettingsError || e instanceof StoreError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')

function useRefresh() {
  const qc = useQueryClient()
  const { refresh } = useSession()
  return async () => {
    await qc.invalidateQueries({ queryKey: ['store'] })
    await refresh()
  }
}

function Notice({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'error' }) {
  const { t } = useI18n()
  if (!text) return null
  return (
    <p className={cn('mb-3 whitespace-pre-line rounded-inner px-4 py-3 text-[13px] font-bold', tone === 'ok' ? 'bg-brand-soft text-brand' : 'bg-danger-soft text-danger')}>{t(text)}</p>
  )
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40', on ? 'bg-brand-light' : 'bg-line')}
    >
      <span className={cn('absolute top-1 size-5 rounded-full bg-white shadow transition-all', on ? 'start-6' : 'start-1')} />
    </button>
  )
}

function LinkRow({ to, href, icon: Icon, color = '#0A5A50', title, subtitle, danger, onClick }: { to?: string; href?: string; icon: LucideIcon; color?: string; title: string; subtitle?: string; danger?: boolean; onClick?: () => void }) {
  const { t } = useI18n()
  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-inner" style={{ background: `${danger ? '#C4392E' : color}1a`, color: danger ? '#C4392E' : color }}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-start">
        <span className={cn('block text-[14px] font-extrabold', danger ? 'text-danger' : 'text-title')}>{t(title)}</span>
        {subtitle && <span className="mt-0.5 block text-[12px] text-sub">{t(subtitle)}</span>}
      </span>
    </>
  )
  const cls = 'card flex w-full items-center gap-3 px-4 py-3.5 hover:bg-line/60'
  if (to) return <Link to={to} className={cls}>{body}</Link>
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={cls}>{body}</a>
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <label className="flex flex-col gap-1">
      <span className="ps-1 text-[12px] font-bold text-sub">{t(label)}</span>
      {children}
    </label>
  )
}

// ======================= القائمة =======================

function SettingsHub() {
  const { t, lang } = useI18n()
  const { profile, signOut } = useSession()
  const store = useStore()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const faq = useQuery({ queryKey: ['faq'], queryFn: loadFaq, staleTime: 300_000 })
  const q = lang === 'ar' ? '' : `?lang=${lang}`
  const d = store.data ?? {}
  const name = String(d['settings_profile_name'] ?? '').trim() || profile?.display_name || ''
  const photo = String(d['settings_profile_photo'] ?? '')
  const currencyLabel = String(d['settings_currency'] ?? '')
  const suffix = CURRENCIES.find(([k]) => k === currencyLabel)?.[1] ?? ''
  const lead = LEAD_TIMES.find(([, n]) => n === reminderSettings(d).leadDays)?.[0] ?? ''
  return (
    <div>
      <PageHeader icon={SettingsIcon} color="#0A5A50" title="الإعدادات" />
      <Link to="/settings/profile" className="card mb-3 flex items-center gap-3 p-4 hover:bg-line/60">
        {photo ? <img src={imageSrc(photo)} alt="" className="size-14 rounded-full object-cover" /> : <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand"><UserRound className="size-7" /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-extrabold text-title">{name || t('صاحب الحساب')}</span>
          <span className="block text-[12px] text-sub">{t('عرض وتعديل البيانات الشخصية')}</span>
          {profile?.fnd_id && <span className="ltr mt-0.5 block text-[12px] font-bold text-gold-dark">{profile.fnd_id}</span>}
        </span>
      </Link>
      <div className="flex flex-col gap-2">
        <LinkRow to="/settings/profile" icon={UserRound} title="البيانات الشخصية" subtitle="الاسم والصورة ووسائل التواصل" />
        <LinkRow to="/settings/notifications" icon={Bell} title="التنبيهات والتذكير" subtitle={lead ? `${t('وقت التذكير الافتراضي')}: ${t(lead)}` : undefined} />
        <LinkRow to="/settings/language" icon={Globe} title="اللغة والعملة والتقويم" subtitle={[LANGS.find((l) => l.code === lang)?.label, suffix && t(suffix)].filter(Boolean).join(' · ')} />
        <LinkRow to="/settings/pages" icon={SlidersHorizontal} title="تخصيص الصفحات" subtitle="الصفحة الرئيسية وإخفاء الفئات والعناصر في كل صفحة" />
        <LinkRow to="/settings/signature" icon={PenLine} title="التوقيع الإلكتروني والختم الإلكتروني" subtitle="إدارة التوقيع والختم المستخدمَين في المستندات" />
        <LinkRow to="/templates" icon={FileText} title="قوالب المستندات والايصالات" subtitle="العقود والإيصالات والفواتير الجاهزة" />
        <LinkRow to="/settings/about" icon={Info} title="حول التطبيق" subtitle={`${t('الإصدار')} ${WEB_VERSION}`} />
        <LinkRow href={`${SITE}/privacy.html${q}`} icon={ShieldCheck} title="سياسة الخصوصية" subtitle="بياناتك وحقوقك" />
        <LinkRow href={`${SITE}/terms.html${q}`} icon={FileText} title="شروط الاستخدام" subtitle="شروط الخدمة واستخدام التطبيق" />
        <LinkRow to="/support" icon={LifeBuoy} title="تواصل معنا" subtitle="إرسال ملاحظة أو طلب دعم" />
        {(faq.data?.length ?? 0) > 0 && <LinkRow to="/settings/faq" icon={CircleHelp} title="الأسئلة الشائعة" subtitle="إجابات سريعة عن استخدام فَندلي" />}
        <LinkRow icon={Trash2} danger title="حذف الحساب" subtitle="حذف حسابك وكل بياناته نهائيًا" onClick={() => setDeleting(true)} />
        <LinkRow icon={LogOut} danger title="تسجيل الخروج" subtitle="الخروج من الحساب على هذا الجهاز" onClick={() => setLeaving(true)} />
      </div>
      {deleting && <DeleteAccount onClose={() => setDeleting(false)} />}
      <Confirm
        open={leaving}
        title="تسجيل الخروج"
        message={t('هل تريد تسجيل الخروج من حسابك؟')}
        confirmLabel="تسجيل الخروج"
        danger
        onConfirm={async () => {
          await signOut()
          navigate('/login', { replace: true })
        }}
        onCancel={() => setLeaving(false)}
      />
    </div>
  )
}

// ======================= البيانات الشخصية =======================

function ProfileSettings() {
  const { t } = useI18n()
  const { profile } = useSession()
  const store = useStore()
  const refresh = useRefresh()
  const [form, setForm] = useState<ProfileInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [password, setPassword] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (store.data && !form) setForm(profileFrom(store.data, profile?.display_name ?? ''))
  }, [store.data, form, profile])
  if (store.isLoading || !form) return <Loading />
  const set = (patch: Partial<ProfileInput>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const shown = publicNameFor(form.mode, form.given, form.family, form.nickname)
  async function save() {
    if (!form) return
    setBusy(true)
    setNotice(null)
    try {
      await saveProfile(store.data, form)
      await refresh()
      setNotice({ text: 'تم حفظ البيانات الشخصية', tone: 'ok' })
    } catch (e) {
      setNotice({ text: messageOf(e), tone: 'error' })
    } finally {
      setBusy(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
  return (
    <div>
      <PageHeader icon={UserRound} color="#0A5A50" title="تعديل الملف الشخصي" />
      {notice && <Notice text={notice.text} tone={notice.tone} />}
      <div className="card p-5">
        <div className="mb-5 flex flex-col items-center gap-2">
          <div className="relative">
            {form.photo ? (
              <img src={imageSrc(form.photo)} alt="" className="size-32 rounded-full border-4 border-surface object-cover" />
            ) : (
              <span className="grid size-32 place-items-center rounded-full border-4 border-surface bg-field text-muted">
                <UserRound className="size-16" />
              </span>
            )}
            <button type="button" aria-label={t('تغيير الصورة الشخصية')} onClick={() => fileRef.current?.click()} className="absolute bottom-1 end-0 grid size-10 place-items-center rounded-full bg-brand text-white hover:bg-brand-dark">
              <Camera className="size-5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  set({ photo: await imageToBase64(file, 900, 0.82) })
                } catch (err) {
                  setNotice({ text: messageOf(err), tone: 'error' })
                }
              }}
            />
          </div>
          {form.photo && (
            <button type="button" onClick={() => set({ photo: '' })} className="text-[12px] font-bold text-danger">
              {t('حذف الصورة')}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <Field label="اسمك الثلاثي *">
            <input dir="auto" value={form.given} placeholder={t('مثل: عبدالعزيز حمود سالم')} onChange={(e) => set({ given: e.target.value })} className={inputClass} />
          </Field>
          <Field label="القبيلة / العائلة (اختياري)">
            <input dir="auto" value={form.family} placeholder={t('اسم القبيلة أو العائلة')} onChange={(e) => set({ family: e.target.value })} className={inputClass} />
          </Field>
          <div>
            <p className="mb-1 ps-1 text-[12px] font-bold text-sub">{t('اسمي الظاهر للآخرين عند المشاركة')}</p>
            <div className="flex flex-wrap gap-2">
              {SHARED_NAME_MODES.map((m) => (
                <button key={m} type="button" onClick={() => set({ mode: m })} className={cn('h-10 rounded-inner border px-3 text-[13px] font-bold', form.mode === m ? 'border-brand bg-brand text-white' : 'border-line bg-white text-body')}>
                  {t(m)}
                </button>
              ))}
            </div>
          </div>
          {form.mode === SHARED_NAME_NICK && (
            <Field label="الاسم المستعار">
              <input dir="auto" value={form.nickname} placeholder={t('مثل: أم محمد')} onChange={(e) => set({ nickname: e.target.value })} className={inputClass} />
            </Field>
          )}
          <div className="flex items-center gap-3 rounded-field border border-brand/35 bg-brand-soft px-4 py-3">
            <Eye className="size-5 text-brand" />
            <div>
              <p className="text-[11.5px] font-bold text-sub">{t('يظهر للآخرين')}</p>
              <p dir="auto" className="text-[16px] font-extrabold text-brand">{shown || '—'}</p>
            </div>
          </div>
          <Field label="البريد الإلكتروني">
            <input dir="ltr" type="email" value={form.email} placeholder="username@example.com" onChange={(e) => set({ email: e.target.value })} className={inputClass} />
          </Field>
          <Field label="تاريخ الميلاد *">
            <div className="flex gap-2">
              <input dir="ltr" value={form.birthday} placeholder={t('يوم/شهر/سنة — مثل 17/9/1984')} onChange={(e) => set({ birthday: e.target.value })} className={inputClass} />
              <input
                type="date"
                aria-label={t('اختيار من التقويم')}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  const [y, m, d] = e.target.value.split('-').map((x) => parseInt(x, 10))
                  if (y) set({ birthday: `${d}/${m}/${y}` })
                }}
                className="h-12 w-12 shrink-0 cursor-pointer rounded-field border border-line bg-field px-1 text-transparent"
              />
            </div>
          </Field>
          <Field label="رقم الهاتف *">
            <input dir="ltr" type="tel" value={form.phone} placeholder={t('أدخل رقم الهاتف')} onChange={(e) => set({ phone: e.target.value })} className={inputClass} />
          </Field>
          <Field label="المدينة *">
            <input dir="auto" value={form.city} placeholder={t('أدخل المدينة')} onChange={(e) => set({ city: e.target.value })} className={inputClass} />
          </Field>
          <Field label="حسابات السوشيال ميديا">
            <input dir="auto" value={form.social} placeholder={t('أضف اسم المستخدم أو رابط الحساب')} onChange={(e) => set({ social: e.target.value })} className={inputClass} />
          </Field>
        </div>
        <button type="button" disabled={busy} onClick={save} className="mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t(busy ? 'جارٍ الحفظ...' : 'حفظ التعديلات')}
        </button>
        <button type="button" onClick={() => setPassword(true)} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-field border border-line text-[14px] font-extrabold text-brand hover:bg-brand-soft">
          <KeyRound className="size-4" />
          {t('تغيير كلمة المرور')}
        </button>
      </div>
      {password && <ChangePassword onClose={() => setPassword(false)} onDone={() => (setPassword(false), setNotice({ text: 'تم تغيير كلمة المرور', tone: 'ok' }))} />}
      <p className="mt-3 text-[11.5px] text-muted">{t('الاسم الكامل يبقى عندك، والآخرون يرون الاسم الظاهر فقط.')}</p>
    </div>
  )
}

function ChangePassword({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t('تغيير كلمة المرور')}</p>
      <div className="mt-3 flex flex-col gap-3">
        <Field label="كلمة المرور الحالية">
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </Field>
        <Field label="كلمة المرور الجديدة">
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </Field>
        <Field label="تأكيد كلمة المرور الجديدة">
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} />
        </Field>
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setError('')
          if (!current || !next) return setError('أكمل الحقول')
          if (next !== again) return setError('كلمتا المرور غير متطابقتين')
          setBusy(true)
          try {
            await changePassword(current, next)
            onDone()
          } catch (e) {
            setError(messageOf(e))
          } finally {
            setBusy(false)
          }
        }}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t('حفظ')}
      </button>
    </Sheet>
  )
}

// ======================= التنبيهات والتذكير =======================

function NotificationSettings() {
  const { t } = useI18n()
  const store = useStore()
  const refresh = useRefresh()
  const [error, setError] = useState('')
  const settings = reminderSettings(store.data)
  async function run(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(messageOf(e))
    }
  }
  return (
    <div>
      <PageHeader icon={Bell} color="#0A5A50" title="التنبيهات والتذكير" />
      <Notice text={error} tone="error" />
      <NotificationsCard />
      <div className="card mt-3 flex flex-col gap-4 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-extrabold text-title">{t('تنبيهات انتهاء المستندات والعقود')}</p>
            <p className="mt-0.5 text-[12px] text-sub">{t('تنبيهات انتهاء الإقامات والرخص والعقود والتأمين')}</p>
          </div>
          <Switch on={settings.expiry} label={t('تنبيهات انتهاء المستندات والعقود')} onChange={(v) => run(() => setExpiryNotices(v))} />
        </div>
        <Field label="وقت التذكير الافتراضي">
          <select value={settings.leadDays} onChange={(e) => run(() => setLeadDays(Number(e.target.value)))} className={inputClass}>
            {LEAD_TIMES.map(([label, days]) => (
              <option key={days} value={days}>
                {t(label)}
              </option>
            ))}
          </select>
          <span className="ps-1 text-[11.5px] text-muted">{t('يُستخدم للعناصر التي لم تُحدَّد لها مدة تذكير خاصة بها')}</span>
        </Field>
        <AlarmSettingsBox />
      </div>
    </div>
  )
}

// ======================= اللغة والعملة والتقويم =======================

function LanguageSettings() {
  const { t, lang, setLang } = useI18n()
  const store = useStore()
  const refresh = useRefresh()
  const [error, setError] = useState('')
  const d = store.data ?? {}
  const currency = String(d['settings_currency'] ?? '')
  const calendar = String(d['settings_calendar'] ?? '') || 'ميلادي'
  const suffix = CURRENCIES.find(([k]) => k === currency)?.[1] ?? ''
  async function run(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(messageOf(e))
    }
  }
  return (
    <div>
      <PageHeader icon={Globe} color="#0A5A50" title="اللغة والعملة والتقويم" />
      <Notice text={error} tone="error" />
      <div className="card flex flex-col gap-4 p-4">
        <Field label="لغة التطبيق">
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className={inputClass}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <span className="ps-1 text-[11.5px] text-muted">{t('لغة الموقع في هذا المتصفح، وللتطبيق لغته في كل جوال.')}</span>
        </Field>
        <Field label="العملة الافتراضية">
          <select value={currency} onChange={(e) => e.target.value && run(() => setCurrency(e.target.value))} className={inputClass}>
            {!currency && <option value="">—</option>}
            {CURRENCIES.map(([label]) => (
              <option key={label} value={label}>
                {t(label)}
              </option>
            ))}
          </select>
          <span className="ps-1 text-[11.5px] text-muted">{t('تظهر بجانب كل مبلغ في التطبيق')}</span>
        </Field>
        <div className="flex items-center gap-2 rounded-field bg-surface px-4 py-3">
          <span className="text-[12px] text-sub">{t('معاينة المبلغ:')}</span>
          <span className="text-[13px] font-extrabold text-title">1,250 {suffix ? t(suffix) : ''}</span>
        </div>
        <Field label="نوع التقويم الافتراضي">
          <select value={calendar} onChange={(e) => run(() => setCalendar(e.target.value))} className={inputClass}>
            {CALENDARS.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </Field>
        {calendar === 'هجري' && (
          <p className="rounded-inner bg-surface px-3 py-2 text-[12px] text-sub">{t('التواريخ المدخلة والمخزّنة تبقى ميلادية؛ التقويم الهجري خيار عرض سيُطبَّق تدريجيًا على الشاشات.')}</p>
        )}
      </div>
    </div>
  )
}

// ======================= تخصيص الصفحات =======================

const PAGE_LOOK: Record<string, [LucideIcon, string]> = {
  personal: [UserRound, '#0E7161'],
  shared: [UsersRound, '#34A894'],
  people: [Users, '#5C6B68'],
  assets: [Building2, '#F2A93F'],
}

function PagesSettings() {
  const { t } = useI18n()
  const { adminHidden } = useSession()
  const store = useStore()
  return (
    <div>
      <PageHeader icon={SlidersHorizontal} color="#0A5A50" title="تخصيص الصفحات" />
      <p className="mb-3 text-[12px] text-muted">{t('اختر الصفحة التي تريد تخصيصها: أخفِ ما لا تستخدمه من فئات، ويعود كل شيء متى أظهرته.')}</p>
      <div className="flex flex-col gap-2">
        <LinkRow to="/settings/pages/home" icon={HomeIcon} title="تخصيص الصفحة الرئيسية" subtitle="إخفاء الأقسام التي لا تستخدمها وترتيبها" />
        {Object.keys(PAGE_CATALOG)
          .filter((page) => !moduleHidden(adminHidden, page))
          .map((page) => {
            const count = validHidden(page, store.data?.[`page_custom_hidden_v1_${page}`]).length
            return (
              <LinkRow
                key={page}
                to={`/settings/pages/${page}`}
                icon={PAGE_LOOK[page][0]}
                color={PAGE_LOOK[page][1]}
                title={`${t('تخصيص صفحة')} ${t(PAGE_TITLES[page])}`}
                subtitle={count === 0 ? 'كل الفئات والعناصر ظاهرة' : `${t('المخفي:')} ${count}`}
              />
            )
          })}
      </div>
    </div>
  )
}

function HomeLayoutSettings() {
  const { t } = useI18n()
  const { adminHidden } = useSession()
  const store = useStore()
  const refresh = useRefresh()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reset, setReset] = useState(false)
  const order = normalizeOrder(store.data?.['home_layout_order_v2'])
  const off = new Set(Array.isArray(store.data?.['home_layout_hidden_v1']) ? (store.data!['home_layout_hidden_v1'] as unknown[]).map(String) : [])
  async function save(nextOrder: string[], nextOff: Set<string>) {
    setBusy(true)
    setError('')
    try {
      await saveHomeLayout(nextOrder, [...nextOff])
      await refresh()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
  const visibleCount = order.filter((id) => !off.has(id) && !moduleHidden(adminHidden, id)).length
  return (
    <div>
      <PageHeader icon={HomeIcon} color="#0A5A50" title="تخصيص الصفحة الرئيسية" />
      <p className="mb-3 text-[12px] text-muted">{t('أخفِ الأقسام التي لا تستخدمها، ورتّبها بالأسهم؛ يظهر الترتيب نفسه في الصفحة الرئيسية.')}</p>
      <Notice text={error} tone="error" />
      <div className="flex flex-col gap-2">
        {order.map((id, i) => {
          const admin = moduleHidden(adminHidden, id)
          const shown = !off.has(id) && !admin
          return (
            <div key={id} className={cn('card flex items-center gap-3 px-4 py-3', admin && 'opacity-60')}>
              <Switch
                on={shown}
                disabled={busy || admin}
                label={t(HOME_TITLES[id])}
                onChange={(v) => {
                  if (!v && visibleCount <= 1) return setError('يجب أن يبقى قسم واحد على الأقل ظاهرًا')
                  const next = new Set(off)
                  if (v) next.delete(id)
                  else next.add(id)
                  void save(order, next)
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-extrabold text-title">{t(HOME_TITLES[id])}</p>
                <p className="text-[11.5px] text-sub">{t(admin ? 'غير متاح حاليًا' : shown ? 'ظاهر في الرئيسية' : 'مخفي من الرئيسية')}</p>
              </div>
              <button type="button" aria-label={t('أعلى')} disabled={busy || i === 0} onClick={() => save(order.map((x, j) => (j === i - 1 ? id : j === i ? order[i - 1] : x)), off)} className="grid size-9 place-items-center rounded-inner text-sub hover:bg-line disabled:opacity-30">
                <ArrowUp className="size-4" />
              </button>
              <button type="button" aria-label={t('أسفل')} disabled={busy || i === order.length - 1} onClick={() => save(order.map((x, j) => (j === i + 1 ? id : j === i ? order[i + 1] : x)), off)} className="grid size-9 place-items-center rounded-inner text-sub hover:bg-line disabled:opacity-30">
                <ArrowDown className="size-4" />
              </button>
            </div>
          )
        })}
      </div>
      <button type="button" onClick={() => setReset(true)} className="mt-4 text-[13px] font-bold text-brand">
        {t('استعادة الترتيب الافتراضي')}
      </button>
      <Confirm
        open={reset}
        title="استعادة الترتيب الافتراضي"
        message={t('ستظهر كل الأقسام بترتيبها الأصلي.')}
        confirmLabel="استعادة"
        busy={busy}
        onConfirm={async () => {
          await save(['people', 'shared', 'assets'], new Set())
          setReset(false)
        }}
        onCancel={() => setReset(false)}
      />
    </div>
  )
}

function PageCategoriesSettings({ page }: { page: string }) {
  const { t } = useI18n()
  const { adminHidden } = useSession()
  const store = useStore()
  const refresh = useRefresh()
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reset, setReset] = useState(false)
  const hidden = new Set(validHidden(page, store.data?.[`page_custom_hidden_v1_${page}`]))
  // ما أخفته الإدارة لا يظهر هنا.
  const categories = (PAGE_CATALOG[page] ?? [])
    .filter((c) => !adminHidden.has(`category:${page}:${c.title}`))
    .map((c) => ({ ...c, items: c.items.filter((i) => !adminHidden.has(`item:${page}:${c.title}:${i}`)) }))
  async function change(fn: (list: string[]) => string[]) {
    setBusy(true)
    setError('')
    try {
      await savePageHidden(page, fn)
      await refresh()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
  if (!PAGE_CATALOG[page]) return <Empty icon={SlidersHorizontal} text="لا توجد بيانات حالياً" />
  const visibleCount = categories.filter((c) => !hidden.has(c.title)).length
  return (
    <div>
      <PageHeader icon={PAGE_LOOK[page][0]} color={PAGE_LOOK[page][1]} title={`${t('تخصيص صفحة')} ${t(PAGE_TITLES[page])}`} />
      <Notice text={error} tone="error" />
      <div className="flex flex-col gap-2">
        {categories.map((c) => {
          const visible = !hidden.has(c.title)
          const hiddenItems = c.items.filter((i) => hidden.has(itemKey(c.title, i))).length
          const expanded = open === c.title && visible && c.items.length > 0
          return (
            <div key={c.title} className="card overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <Switch
                  on={visible}
                  disabled={busy}
                  label={t(c.title)}
                  onChange={(v) => {
                    if (!v && visibleCount <= 1) return setError('يجب أن تبقى فئة واحدة على الأقل ظاهرة')
                    void change((list) => (v ? list.filter((k) => k !== c.title) : [...list.filter((k) => k !== c.title), c.title]))
                  }}
                />
                <button type="button" disabled={!visible || !c.items.length} onClick={() => setOpen(expanded ? null : c.title)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13.5px] font-extrabold', visible ? 'text-title' : 'text-muted')}>{t(c.title)}</span>
                    <span className="block text-[11px] text-muted">
                      {!visible
                        ? t('الفئة كلها مخفية')
                        : !c.items.length
                          ? t('ظاهرة في الصفحة')
                          : hiddenItems === 0
                            ? `${t('كل العناصر ظاهرة')} (${c.items.length})`
                            : `${t('مخفي')} ${hiddenItems} ${t('من')} ${c.items.length}`}
                    </span>
                  </span>
                  {visible && c.items.length > 0 && (expanded ? <ChevronUp className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />)}
                </button>
              </div>
              {expanded && (
                <div className="border-t border-line">
                  {c.items.map((item) => {
                    const key = itemKey(c.title, item)
                    const on = !hidden.has(key)
                    return (
                      <div key={item} className="flex items-center gap-3 px-6 py-2.5">
                        <Switch on={on} disabled={busy} label={t(item)} onChange={(v) => change((list) => (v ? list.filter((k) => k !== key) : [...list.filter((k) => k !== key), key]))} />
                        <span className="text-[12.5px] font-bold text-title">{t(item)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button type="button" onClick={() => setReset(true)} className="mt-4 text-[13px] font-bold text-brand">
        {t('إظهار الكل')}
      </button>
      <Confirm
        open={reset}
        title="إظهار الكل"
        message={t('ستظهر كل الفئات والعناصر في هذه الصفحة.')}
        confirmLabel="إظهار الكل"
        busy={busy}
        onConfirm={async () => {
          await change(() => [])
          setReset(false)
        }}
        onCancel={() => setReset(false)}
      />
    </div>
  )
}

// ======================= التوقيع والختم والشعار =======================

function SignatureSettings() {
  const { t } = useI18n()
  const store = useStore()
  const refresh = useRefresh()
  const d = store.data ?? {}
  const savedStrokes = useMemo(() => signatureStrokes(d['user_signature_strokes_v1']) as Point[][], [d])
  const savedStamp = String(d['user_stamp_image_v1'] ?? '')
  const savedLogo = String(d['user_logo_image_v1'] ?? '')
  const [strokes, setStrokes] = useState<Point[][] | null>(null)
  const [stamp, setStamp] = useState<string | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const pad = useRef<HTMLDivElement>(null)
  const drawing = useRef(false)
  const stampRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const lines = strokes ?? savedStrokes
  const stampNow = stamp ?? savedStamp
  const logoNow = logo ?? savedLogo
  const changed = strokes !== null || stamp !== null || logo !== null
  // نقاط بمقياس لوحة التطبيق (عرض PAD_WIDTH) لتُعرض هناك كما رُسمت.
  const point = (e: React.PointerEvent): Point => {
    const rect = pad.current!.getBoundingClientRect()
    const k = PAD_WIDTH / rect.width
    return [Math.max(0, Math.min(PAD_WIDTH, (e.clientX - rect.left) * k)), Math.max(0, Math.min(PAD_HEIGHT, (e.clientY - rect.top) * k))]
  }
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true)
    setNotice(null)
    try {
      await fn()
      await refresh()
      setNotice({ text: message, tone: 'ok' })
    } catch (e) {
      setNotice({ text: messageOf(e), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  async function pick(file: File | undefined, set: (v: string) => void, quality: number) {
    if (!file) return
    try {
      set(await imageToBase64(file, 900, quality))
    } catch (e) {
      setNotice({ text: messageOf(e), tone: 'error' })
    }
  }
  const box = (title: string, hint: string, children: ReactNode, Icon: LucideIcon) => (
    <div className="card mb-3 p-4">
      <p className="flex items-center gap-2 text-[15px] font-extrabold text-title">
        <Icon className="size-5 text-brand" />
        {t(title)}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-sub">{t(hint)}</p>
      <div className="mt-3">{children}</div>
    </div>
  )
  return (
    <div>
      <PageHeader icon={PenLine} color="#0A5A50" title="التوقيع الإلكتروني والختم الإلكتروني" />
      {notice && <Notice text={notice.text} tone={notice.tone} />}
      {box(
        'التوقيع الإلكتروني',
        'ارسم توقيعك داخل المساحة، وارفع صورة ختمك أسفلها. يبقيان محفوظين حتى تستخدمهما في نموذج أو مستند تختاره أنت.',
        <>
          <div
            ref={pad}
            data-testid="signature-pad"
            className="relative w-full max-w-[520px] touch-none select-none overflow-hidden rounded-inner border border-line bg-white"
            style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = true
              setStrokes([...lines, [point(e)]])
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return
              const p = point(e)
              setStrokes((x) => {
                const cur = x ?? []
                if (!cur.length) return cur
                return [...cur.slice(0, -1), [...cur[cur.length - 1], p]]
              })
            }}
            onPointerUp={() => (drawing.current = false)}
            onPointerCancel={() => (drawing.current = false)}
          >
            {lines.length === 0 && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] font-bold text-muted">
                <span className="flex items-center gap-2">
                  <PenLine className="size-4" />
                  {t('ارسم توقيعك هنا')}
                </span>
              </span>
            )}
            <svg viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`} className="absolute inset-0 size-full">
              {lines.map((st, i) =>
                st.length === 1 ? (
                  <circle key={i} cx={st[0][0]} cy={st[0][1]} r={1.6} fill="#0F2420" />
                ) : (
                  <polyline key={i} points={st.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#0F2420" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                ),
              )}
            </svg>
          </div>
          <button type="button" disabled={!lines.length} onClick={() => setStrokes([])} className="mt-2 flex items-center gap-1.5 text-[12.5px] font-bold text-danger disabled:opacity-40">
            <Eraser className="size-4" />
            {t('مسح التوقيع')}
          </button>
        </>,
        PenLine,
      )}
      {box(
        'الختم الإلكتروني',
        'أضف صورة ختمك أو ارفعها من المعرض، ثم احفظها لتظهر مع التوقيع في المستندات.',
        <>
          <button type="button" onClick={() => stampRef.current?.click()} className="grid h-36 w-full max-w-[520px] place-items-center rounded-inner border-2 border-dashed border-line bg-white hover:border-brand">
            {stampNow ? <img src={imageSrc(stampNow)} alt="" className="max-h-32 object-contain" /> : <span className="flex items-center gap-2 text-[13px] font-bold text-muted"><Stamp className="size-5" />{t('اضغط لإضافة أو رفع صورة الختم')}</span>}
          </button>
          <input ref={stampRef} type="file" accept="image/*" className="hidden" onChange={(e) => (pick(e.target.files?.[0], setStamp, 0.88), (e.target.value = ''))} />
          {stampNow && (
            <div className="mt-2 flex gap-4 text-[12.5px] font-bold">
              <button type="button" onClick={() => stampRef.current?.click()} className="text-brand">{t('استبدال صورة الختم')}</button>
              <button type="button" onClick={() => setStamp('')} className="text-danger">{t('حذف الختم')}</button>
            </div>
          )}
        </>,
        Stamp,
      )}
      {box(
        'الشعار (لوجو)',
        'يظهر في منتصف أعلى الصفحة الأولى من المستندات والتقارير.',
        <>
          <button type="button" onClick={() => logoRef.current?.click()} className="grid h-36 w-full max-w-[520px] place-items-center rounded-inner border-2 border-dashed border-line bg-white hover:border-brand">
            {logoNow ? <img src={imageSrc(logoNow)} alt="" className="max-h-32 object-contain" /> : <span className="flex items-center gap-2 text-[13px] font-bold text-muted"><ImageIcon className="size-5" />{t('اضغط لإضافة الشعار')}</span>}
          </button>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => (pick(e.target.files?.[0], setLogo, 0.92), (e.target.value = ''))} />
          {logoNow && (
            <button type="button" onClick={() => setLogo('')} className="mt-2 text-[12.5px] font-bold text-danger">
              {t('حذف الشعار')}
            </button>
          )}
        </>,
        ImageIcon,
      )}
      <button type="button" disabled={!changed || busy} onClick={() => setConfirm(true)} className="flex h-13 w-full items-center justify-center gap-2 rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50">
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t('حفظ التوقيع والختم')}
      </button>
      <Confirm
        open={confirm}
        title="حفظ التوقيع والختم"
        message={t('سيتم حفظ التوقيع والختم واستعمالهما في المستندات. تأكيد؟')}
        confirmLabel="تأكيد"
        busy={busy}
        onConfirm={async () => {
          await run(async () => {
            if (strokes !== null) await saveSignature(strokes)
            if (stamp !== null && stamp !== savedStamp) await saveStamp(stamp)
            if (logo !== null && logo !== savedLogo) await saveLogo(logo)
            setStrokes(null)
            setStamp(null)
            setLogo(null)
          }, 'تم حفظ التوقيع والختم')
          setConfirm(false)
        }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}

// ======================= حول / الأسئلة الشائعة / حذف الحساب =======================

function AboutSettings() {
  const { t } = useI18n()
  return (
    <div>
      <PageHeader icon={Info} color="#0A5A50" title="حول التطبيق" />
      <div className="card flex flex-col items-center gap-2 p-6 text-center">
        <img src="/img/logo.png" alt="" className="h-16 w-auto" />
        <p className="text-[20px] font-extrabold text-title">Fundly</p>
        <p className="text-[13px] font-bold text-sub">
          {t('الموقع')} {WEB_VERSION}
        </p>
        <p className="mt-2 rounded-inner bg-surface px-4 py-3 text-[13px] text-sub">{t('تطبيق عربي لإدارة الأموال والأصول والالتزامات والعلاقات في مكان واحد.')}</p>
        <p className="mt-2 text-[12px] text-muted" dir="ltr">
          FUNDLY E TRANSACTION COMPLEX · support@fundlyglobal.com
        </p>
      </div>
    </div>
  )
}

function FaqSettings() {
  const { t } = useI18n()
  const faq = useQuery({ queryKey: ['faq'], queryFn: loadFaq, staleTime: 300_000 })
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div>
      <PageHeader icon={CircleHelp} color="#0A5A50" title="الأسئلة الشائعة" />
      {faq.isLoading ? (
        <Loading />
      ) : faq.error ? (
        <ErrorBox error={faq.error} />
      ) : !faq.data?.length ? (
        <Empty icon={CircleHelp} text="لا توجد أسئلة بعد" />
      ) : (
        <div className="flex flex-col gap-2">
          {faq.data.map((f, i) => (
            <div key={i} className="card overflow-hidden">
              <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-3 px-4 py-3.5 text-start">
                <span dir="auto" className="min-w-0 flex-1 text-[14px] font-extrabold text-title">{f.question}</span>
                {open === i ? <ChevronUp className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />}
              </button>
              {open === i && (
                <p dir="auto" className="whitespace-pre-line border-t border-line px-4 py-3 text-[13px] leading-relaxed text-sub">
                  {f.answer}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted">{t('لم تجد إجابتك؟')} <Link to="/support" className="font-bold text-brand">{t('تواصل معنا')}</Link></p>
    </div>
  )
}

function DeleteAccount({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const { signOut } = useSession()
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2>(1)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (step === 1)
    return (
      <Confirm
        open
        title="حذف الحساب نهائيًا"
        message={t('سيُحذف حسابك وكل بياناته نهائيًا من خوادمنا: التزاماتك، والأفراد والجهات، والعقارات والمركبات والأنشطة، والمستندات والملفات، والتفويضات، والالتزامات المشتركة التي أنشأتها (تُحذف عند كل أعضائها). لا يمكن التراجع عن الحذف ولا استرجاع البيانات.')}
        confirmLabel="حذف الحساب"
        danger
        onConfirm={() => setStep(2)}
        onCancel={onClose}
      />
    )
  return (
    <Sheet open onClose={busy ? () => undefined : onClose}>
      <div className="flex flex-col items-center text-center">
        <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
          <Trash2 className="size-7" />
        </span>
        <p className="mt-3 text-[18px] font-extrabold text-title">{t('حذف الحساب نهائيًا')}</p>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-inner bg-surface p-3 text-[13px] font-extrabold text-title">
        <input type="checkbox" checked={understood} disabled={busy} onChange={(e) => (setUnderstood(e.target.checked), setError(''))} className="mt-0.5 size-4 accent-[#C4392E]" />
        {t('أفهم أن الحذف نهائي ولا يمكن التراجع عنه')}
      </label>
      {busy && <p className="mt-3 text-center text-[12.5px] font-bold text-muted">{t('جارٍ حذف الحساب...')}</p>}
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-center text-[12.5px] font-bold text-danger">{t(error)}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="h-12 flex-1 rounded-field border border-line text-[14px] font-extrabold text-body disabled:opacity-60">
          {t('إلغاء')}
        </button>
        <button
          type="button"
          disabled={!understood || busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await deleteMyAccount()
              await signOut().catch(() => undefined)
              navigate('/login', { replace: true })
            } catch (e) {
              setError(messageOf(e))
              setBusy(false)
            }
          }}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-field bg-danger text-[14px] font-extrabold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t('حذف الحساب')}
        </button>
      </div>
    </Sheet>
  )
}

// ======================= الموجّه =======================

export default function Settings() {
  const { section, page } = useParams()
  if (section === 'profile') return <ProfileSettings />
  if (section === 'notifications') return <NotificationSettings />
  if (section === 'language') return <LanguageSettings />
  if (section === 'pages' && page === 'home') return <HomeLayoutSettings />
  if (section === 'pages' && page) return <PageCategoriesSettings page={page} />
  if (section === 'pages') return <PagesSettings />
  if (section === 'signature') return <SignatureSettings />
  if (section === 'faq') return <FaqSettings />
  if (section === 'about') return <AboutSettings />
  return <SettingsHub />
}
