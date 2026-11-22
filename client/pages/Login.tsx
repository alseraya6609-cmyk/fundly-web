import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock, UserRound } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { StoreLinks } from './Gates'
import { LanguagePicker } from './More'

export default function Login() {
  const { t } = useI18n()
  const { user, signIn } = useSession()
  const location = useLocation()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(identifier, password)
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
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
        <div className="flex justify-end">
          <LanguagePicker compact />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <img src="/img/logo.png" alt="" className="mb-3 h-16 w-auto" />
            <p className="text-[14px] text-sub">{t('أموالك، أصولك، التزاماتك وعلاقاتك في لوحة واحدة')}</p>
          </div>
          <h1 className="text-[26px] font-extrabold text-title">{t('تسجيل الدخول')}</h1>
          <p className="mt-1 text-[14px] text-sub">{t('ادخل بحساب التطبيق نفسه')}</p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-bold text-body">
                {t('البريد الإلكتروني أو الرقم التعريفي أو رقم الهاتف')}
              </span>
              <span className="flex h-14 items-center gap-3 rounded-field bg-field px-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-gold">
                <UserRound className="size-5 text-muted" />
                <input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  dir="ltr"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-title outline-none"
                  placeholder="name@example.com · FND…"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-bold text-body">{t('كلمة المرور')}</span>
              <span className="flex h-14 items-center gap-3 rounded-field bg-field px-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-gold">
                <Lock className="size-5 text-muted" />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  dir="ltr"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-title outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="text-muted"
                  aria-label={t(show ? 'إخفاء' : 'إظهار')}
                >
                  {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </span>
            </label>

            {error && <p className="rounded-inner bg-danger-soft px-4 py-3 text-[13px] text-danger">{t(error)}</p>}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 flex h-14 items-center justify-center gap-2 rounded-field bg-brand text-[16px] font-extrabold text-white transition-colors hover:bg-brand-dark disabled:opacity-70"
            >
              {busy && <Loader2 className="size-5 animate-spin" />}
              {t('تسجيل الدخول')}
            </button>
          </form>

          <div className="mt-8 rounded-inner bg-surface p-4 text-[13px] leading-relaxed text-sub">
            {t('إنشاء الحساب واستعادة كلمة المرور من التطبيق.')}
            <StoreLinks className="mt-3" />
          </div>
        </div>
      </div>
    </div>
  )
}
