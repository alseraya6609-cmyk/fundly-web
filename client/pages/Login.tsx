import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, Phone, UserRound, Users } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import {
  finishSignUp,
  isValidNameParts,
  maskEmail,
  resendSignupCode,
  resetWithCode,
  sendResetCode,
  signUpAccount,
  verifySignupCode,
  type SignUpInput,
} from '@/lib/account'
import { SITE, StoreLinks } from './Gates'
import { LanguagePicker } from './More'

type Mode = 'login' | 'signup' | 'reset'

const messageOf = (err: unknown) => String((err as Error)?.message ?? err)

export default function Login() {
  const { t } = useI18n()
  const { user } = useSession()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('login')

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  const heading: Record<Mode, [string, string]> = {
    login: ['تسجيل الدخول', 'ادخل بحساب التطبيق نفسه'],
    signup: ['إنشاء حساب جديد', 'حساب واحد تدخل به من أي جوال، ويولّد لك النظام رقمًا تعريفيًا ثابتًا للمعاملات المشتركة.'],
    reset: ['نسيت كلمة المرور', ''],
  }

  return (
    <div className="min-h-screen bg-page lg:grid lg:grid-cols-2">
      {/* لوحة الهوية — الشاشات الكبيرة */}
      <div className="relative hidden overflow-hidden bg-brand lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute -start-24 -top-24 size-80 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -end-20 size-96 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <img src="/img/logo.png" alt="" className="h-12 w-auto rounded-xl bg-white p-1.5" />
          <span className="text-[26px] font-extrabold text-white">{t('فوندلي')}</span>
        </div>
        <div className="relative">
          <h2 className="max-w-md text-[34px] font-extrabold leading-snug text-white">
            {t('أموالك، أصولك، التزاماتك وعلاقاتك في لوحة واحدة')}
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/75">
            {t('ادخل بحساب التطبيق نفسه لتطّلع على بياناتك من الحاسوب.')}
          </p>
        </div>
        <p className="relative text-[12px] text-white/50">© {new Date().getFullYear()} Fundly</p>
      </div>

      <div className="flex min-h-screen flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          {mode !== 'login' ? (
            <button
              type="button"
              onClick={() => setMode('login')}
              className="flex items-center gap-1.5 text-[13px] font-bold text-brand"
            >
              <ArrowRight className="size-4 ltr:rotate-180" />
              {t('تسجيل الدخول')}
            </button>
          ) : (
            <span />
          )}
          <LanguagePicker compact />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <img src="/img/logo.png" alt="" className="mb-3 h-16 w-auto" />
            <p className="text-[14px] text-sub">{t('أموالك، أصولك، التزاماتك وعلاقاتك في لوحة واحدة')}</p>
          </div>
          <h1 className="text-[26px] font-extrabold text-title">{t(heading[mode][0])}</h1>
          {heading[mode][1] && <p className="mt-1 text-[14px] leading-relaxed text-sub">{t(heading[mode][1])}</p>}

          {mode === 'login' && <LoginForm onMode={setMode} />}
          {mode === 'signup' && <SignUpForm />}
          {mode === 'reset' && <ResetForm />}

          <div className="mt-8 rounded-inner bg-surface p-4 text-[13px] leading-relaxed text-sub">
            {t('التطبيق متوفر على الجوال بنفس الحساب.')}
            <StoreLinks className="mt-3" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------- عناصر مشتركة ----------------

function Field({
  label,
  icon,
  value,
  onChange,
  type = 'text',
  ltr = false,
  autoComplete,
  placeholder,
  trailing,
  center = false,
}: {
  label: string
  icon: ReactNode
  value: string
  onChange: (v: string) => void
  type?: string
  ltr?: boolean
  autoComplete?: string
  placeholder?: string
  trailing?: ReactNode
  center?: boolean
}) {
  const { t } = useI18n()
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-bold text-body">{t(label)}</span>
      <span className="flex h-14 items-center gap-3 rounded-field bg-field px-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-gold">
        {icon}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={type}
          autoComplete={autoComplete}
          dir={ltr ? 'ltr' : undefined}
          placeholder={placeholder}
          className={`min-w-0 flex-1 bg-transparent text-[15px] text-title outline-none ${center ? 'text-center tracking-[0.4em]' : ''}`}
        />
        {trailing}
      </span>
    </label>
  )
}

function EyeToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" onClick={onToggle} className="text-muted" aria-label={t(show ? 'إخفاء' : 'إظهار')}>
      {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
    </button>
  )
}

function ErrorLine({ text }: { text: string }) {
  const { t } = useI18n()
  if (!text) return null
  return <p className="rounded-inner bg-danger-soft px-4 py-3 text-[13px] text-danger">{t(text)}</p>
}

function Primary({ busy, label, onClick }: { busy: boolean; label: string; onClick?: () => void }) {
  const { t } = useI18n()
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={busy}
      className="mt-2 flex h-14 items-center justify-center gap-2 rounded-field bg-brand text-[16px] font-extrabold text-white transition-colors hover:bg-brand-dark disabled:opacity-70"
    >
      {busy && <Loader2 className="size-5 animate-spin" />}
      {t(label)}
    </button>
  )
}

const iconCls = 'size-5 text-muted'

// ---------------- الدخول ----------------

function LoginForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { t } = useI18n()
  const { signIn } = useSession()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(identifier, password)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
      <Field
        label="البريد الإلكتروني أو الرقم التعريفي أو رقم الهاتف"
        icon={<UserRound className={iconCls} />}
        value={identifier}
        onChange={setIdentifier}
        autoComplete="username"
        ltr
        placeholder="name@example.com · FND…"
      />
      <Field
        label="كلمة المرور"
        icon={<Lock className={iconCls} />}
        value={password}
        onChange={setPassword}
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        ltr
        trailing={<EyeToggle show={show} onToggle={() => setShow((v) => !v)} />}
      />
      <div className="-mt-1 flex justify-end">
        <button type="button" onClick={() => onMode('reset')} className="text-[13px] font-bold text-brand hover:underline">
          {t('نسيت كلمة المرور؟')}
        </button>
      </div>

      <ErrorLine text={error} />
      <Primary busy={busy} label="تسجيل الدخول" />

      <button
        type="button"
        onClick={() => onMode('signup')}
        className="flex h-12 items-center justify-center rounded-field bg-white text-[15px] font-extrabold text-brand ring-1 ring-line hover:bg-surface"
      >
        {t('إنشاء حساب جديد')}
      </button>
    </form>
  )
}

// ---------------- إنشاء الحساب ----------------

function SignUpForm() {
  const { adopt } = useSession()
  const [form, setForm] = useState<SignUpInput & { confirm: string }>({ given: '', family: '', email: '', phone: '', password: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // الموافقة إلزامية مرة واحدة في هذه الشاشة.
  const [agreed, setAgreed] = useState(false)
  const [askPolicy, setAskPolicy] = useState(false)
  const [otpFor, setOtpFor] = useState('')
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function enter() {
    await finishSignUp(form)
    await adopt({ acceptPolicy: true })
  }

  async function create(withAgreement = agreed) {
    setError('')
    if (!isValidNameParts(form.given)) return setError('اكتب اسمك')
    if (form.password !== form.confirm) return setError('كلمتا المرور غير متطابقتين')
    // البريد وكلمة المرور قبل طلب الرمز، فلا يُطلب رمز لبيانات مرفوضة.
    const mail = form.email.trim().toLowerCase()
    if (!mail.includes('@') || !mail.includes('.')) return setError('صيغة البريد الإلكتروني غير صحيحة')
    if (form.password.length < 6) return setError('كلمة المرور قصيرة — 6 أحرف على الأقل')
    if (!withAgreement) return setAskPolicy(true)
    setBusy(true)
    try {
      const signedIn = await signUpAccount(form)
      if (signedIn) await enter()
      else setOtpFor(mail)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) create()
        }}
        className="mt-8 flex flex-col gap-4"
      >
        <Field label="اسمك الثلاثي" icon={<UserRound className={iconCls} />} value={form.given} onChange={set('given')} autoComplete="name" />
        <Field label="القبيلة / العائلة (اختياري)" icon={<Users className={iconCls} />} value={form.family} onChange={set('family')} autoComplete="family-name" />
        <Field label="البريد الإلكتروني" icon={<Mail className={iconCls} />} value={form.email} onChange={set('email')} type="email" autoComplete="email" ltr />
        <Field label="رقم الهاتف (اختياري — للدخول به)" icon={<Phone className={iconCls} />} value={form.phone} onChange={set('phone')} type="tel" autoComplete="tel" ltr />
        <Field
          label="كلمة المرور"
          icon={<Lock className={iconCls} />}
          value={form.password}
          onChange={set('password')}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          ltr
          trailing={<EyeToggle show={show} onToggle={() => setShow((v) => !v)} />}
        />
        <Field
          label="تأكيد كلمة المرور"
          icon={<Lock className={iconCls} />}
          value={form.confirm}
          onChange={set('confirm')}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          ltr
        />
        <ErrorLine text={error} />
        <Primary busy={busy} label="إنشاء الحساب" />
      </form>

      {askPolicy && (
        <PolicyAgreement
          onAgree={() => {
            setAskPolicy(false)
            setAgreed(true)
            create(true)
          }}
          onCancel={() => {
            setAskPolicy(false)
            setError('وافق على شروط الاستخدام وسياسة الخصوصية للمتابعة')
          }}
        />
      )}

      {otpFor && (
        <OtpDialog
          email={otpFor}
          onVerified={enter}
          onCancel={() => {
            setOtpFor('')
            setError('لم يُفعَّل الحساب بعد — اضغط «إنشاء الحساب» مرة أخرى بنفس البريد لإرسال رمز جديد')
          }}
        />
      )}
    </>
  )
}

/** showPolicyAgreement: الشروط والخصوصية، والموافقة إلزامية للتسجيل. */
function PolicyAgreement({ onAgree, onCancel }: { onAgree: () => void; onCancel: () => void }) {
  const { t, lang } = useI18n()
  const q = lang === 'ar' ? '' : `?lang=${lang}`
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl">
        <p className="text-[17px] font-extrabold text-title">{t('شروط الاستخدام وسياسة الخصوصية')}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-sub">{t('للمتابعة اقرأ السياسة والشروط ووافق عليها.')}</p>
        <div className="mt-4 flex justify-center gap-4 text-[13px] font-bold">
          <a className="text-brand underline" href={`${SITE}/privacy.html${q}`} target="_blank" rel="noreferrer">
            {t('سياسة الخصوصية')}
          </a>
          <a className="text-brand underline" href={`${SITE}/terms.html${q}`} target="_blank" rel="noreferrer">
            {t('شروط الاستخدام')}
          </a>
        </div>
        <p className="mt-4 rounded-inner bg-surface px-3 py-2 text-[12px] leading-relaxed text-sub">
          {t('بالضغط على «أوافق» تقرّ بأنك قرأت شروط الاستخدام وسياسة الخصوصية ووافقت عليهما.')}
        </p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onAgree} className="h-11 flex-[2] rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
            {t('أوافق وأنشئ الحساب')}
          </button>
          <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-field bg-surface text-[14px] font-bold text-body hover:bg-line">
            {t('إلغاء')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** رمز التحقق: 6 أرقام تصل إلى البريد، وبعد صحته يدخل مباشرة. */
function OtpDialog({ email, onVerified, onCancel }: { email: string; onVerified: () => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await verifySignupCode(email, code)
      await onVerified()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  async function resend() {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await resendSignupCode(email)
      setNotice('أرسلنا رمزًا جديدًا إلى بريدك')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl">
        <p className="text-[17px] font-extrabold text-title">{t('رمز التحقق')}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-sub">{t('أرسلنا رمز تحقق من 6 أرقام إلى بريدك، اكتبه هنا لتفعيل الحساب.')}</p>
        <p className="mt-1 text-[12px] font-bold text-body" dir="ltr">
          {maskEmail(email)}
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d٠-٩]/g, '').slice(0, 8))}
          onKeyDown={(e) => e.key === 'Enter' && confirm()}
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          placeholder="------"
          aria-label={t('رمز التحقق')}
          className="mt-4 h-14 w-full rounded-field bg-field text-center text-[22px] font-extrabold tracking-[0.5em] text-title outline-none ring-1 ring-line focus:ring-2 focus:ring-gold"
        />
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        {notice && <p className="mt-3 rounded-inner bg-brand-soft px-3 py-2 text-[12px] font-bold text-brand">{t(notice)}</p>}
        <div className="mt-5 flex items-end gap-2">
          <div className="flex flex-col items-start">
            <button type="button" disabled={busy} onClick={resend} className="px-1.5 py-1 text-[13px] font-bold text-brand disabled:opacity-60">
              {t('إعادة إرسال الرمز')}
            </button>
            <button type="button" disabled={busy} onClick={onCancel} className="px-1.5 py-1 text-[13px] font-bold text-muted disabled:opacity-60">
              {t('إلغاء')}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className="ms-auto flex h-11 min-w-28 items-center justify-center gap-2 rounded-field bg-brand px-5 text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('تأكيد')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------- نسيت كلمة المرور ----------------

function ResetForm() {
  const { t } = useI18n()
  const { adopt } = useSession()
  const [identifier, setIdentifier] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    setBusy(true)
    setError('')
    try {
      setSentTo(await sendResetCode(sentTo || identifier))
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password !== confirm) return setError('كلمتا المرور غير متطابقتين')
    setBusy(true)
    setError('')
    try {
      await resetWithCode(sentTo, code, password)
      await adopt()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  if (!sentTo) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) send()
        }}
        className="mt-6 flex flex-col gap-4"
      >
        <p className="text-[14px] leading-relaxed text-sub">
          {t('اكتب بريدك أو رقم هاتفك أو رقمك التعريفي، ونرسل رمزًا إلى البريد المرتبط بحسابك.')}
        </p>
        <Field
          label="البريد أو الهاتف أو الرقم التعريفي"
          icon={<UserRound className={iconCls} />}
          value={identifier}
          onChange={setIdentifier}
          autoComplete="username"
          ltr
        />
        <ErrorLine text={error} />
        <Primary busy={busy} label="إرسال الرمز" />
      </form>
    )
  }

  return (
    <form onSubmit={reset} className="mt-6 flex flex-col gap-4">
      <p className="text-[14px] leading-relaxed text-sub">
        {t('أرسلنا رمزًا إلى')}{' '}
        <bdi dir="ltr" className="font-bold text-body">
          {maskEmail(sentTo)}
        </bdi>
      </p>
      <Field
        label="الرمز"
        icon={<KeyRound className={iconCls} />}
        value={code}
        onChange={(v) => setCode(v.replace(/[^\d٠-٩]/g, '').slice(0, 8))}
        autoComplete="one-time-code"
        ltr
        center
        placeholder="------"
      />
      <Field
        label="كلمة المرور الجديدة"
        icon={<Lock className={iconCls} />}
        value={password}
        onChange={setPassword}
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        ltr
        trailing={<EyeToggle show={show} onToggle={() => setShow((v) => !v)} />}
      />
      <Field
        label="تأكيد كلمة المرور الجديدة"
        icon={<Lock className={iconCls} />}
        value={confirm}
        onChange={setConfirm}
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        ltr
      />
      <ErrorLine text={error} />
      <Primary busy={busy} label="تغيير كلمة المرور والدخول" />
      <button type="button" disabled={busy} onClick={send} className="h-10 text-[13px] font-bold text-brand disabled:opacity-60">
        {t('إعادة إرسال الرمز')}
      </button>
    </form>
  )
}
