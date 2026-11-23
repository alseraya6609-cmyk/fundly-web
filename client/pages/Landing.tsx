import { Link } from 'react-router-dom'
import { Building2, CalendarDays, FileBarChart, FileText, Mail, MapPin, ShieldCheck, Smartphone, UserRound, Users, UsersRound, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { LanguagePicker } from './More'
import { SITE, StoreLinks } from './Gates'

/*
  الصفحة الرئيسية لـ fundlyglobal.com لمن لم يسجّل الدخول: تعريف بالتطبيق
  والموقع والجهة المشغّلة، وأزرار الدخول وإنشاء الحساب، وروابط المتجرين
  والسياسة والشروط وحذف الحساب. المسجَّل يصل إليها من /welcome.
*/

const COMPANY_AR = 'فوندلي مجمع للتعامل الالكتروني'
const COMPANY_EN = 'FUNDLY E TRANSACTION COMPLEX'
const EMAIL = 'support@fundlyglobal.com'

const FEATURES: [LucideIcon, string, string][] = [
  [UserRound, 'أنا', 'مصروفاتك ودخلك وديونك وأقساطك ومستنداتك ومواعيدك وأدويتك في مكان واحد.'],
  [UsersRound, 'الالتزامات المشتركة', 'رحلات ومشاركات وتحديد أدوار مع الآخرين، بميزانية ومصروفات وتسويات واضحة.'],
  [Users, 'الأفراد والجهات', 'ما لك وما عليك مع كل شخص أو جهة، ووثائقهم وتذكيرات انتهائها.'],
  [Building2, 'العقارات والأنشطة والمركبات', 'الوحدات وعقود الإيجار والدفعات والصيانة وسندات القبض.'],
  [FileText, 'المستندات', 'مستنداتك ومرفقاتك منظّمة، مع تنبيه قبل انتهائها.'],
  [CalendarDays, 'الكلندر الذكي', 'كل المواعيد والاستحقاقات في تقويم واحد مع تنبيهات.'],
  [FileBarChart, 'التقارير', 'ملخص شامل لكل الأقسام وتقارير PDF جاهزة للطباعة.'],
  [ShieldCheck, 'التفويضات', 'فوّض غيرك بإدارة ما تختاره، بالصلاحيات والمدة التي تحددها.'],
  [Smartphone, 'على الجوال والويب', 'حساب واحد على الآيفون والأندرويد ومن المتصفح.'],
]

export default function Landing() {
  const { t, lang } = useI18n()
  const { user } = useSession()
  const q = `?lang=${lang}`
  const year = new Date().getFullYear()
  return (
    <div className="min-h-screen bg-page">
      {/* الشريط العلوي */}
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/welcome" className="flex items-center gap-2">
            <img src="/img/logo.png" alt="" className="h-10 w-auto" />
            <span className="text-[20px] font-extrabold text-title">{t('فوندلي')}</span>
          </Link>
          <nav className="hidden items-center gap-5 text-[14px] font-bold text-body md:flex">
            <a href="#features" className="hover:text-brand">
              {t('المزايا')}
            </a>
            <a href="#company" className="hover:text-brand">
              {t('عن الشركة')}
            </a>
            <a href={`${SITE}/privacy.html${q}`} className="hover:text-brand">
              {t('سياسة الخصوصية')}
            </a>
          </nav>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <LanguagePicker compact />
            {user ? (
              <Link to="/" className="rounded-field bg-brand px-4 py-2.5 text-[13.5px] font-extrabold text-white hover:bg-brand-dark">
                {t('الدخول إلى حسابي')}
              </Link>
            ) : (
              <>
                <Link to="/login" className="rounded-field border border-brand px-4 py-2.5 text-[13.5px] font-extrabold text-brand hover:bg-brand-soft">
                  {t('تسجيل الدخول')}
                </Link>
                <Link to="/login?mode=signup" className="rounded-field bg-brand px-4 py-2.5 text-[13.5px] font-extrabold text-white hover:bg-brand-dark">
                  {t('إنشاء حساب')}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* التعريف */}
      <section className="relative overflow-hidden bg-brand">
        <div className="absolute -start-24 -top-24 size-80 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -end-20 size-96 rounded-full bg-white/5" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-20">
          <div>
            <p className="mb-3 inline-block rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-bold text-white/85">{t('التطبيق مجاني بالكامل')}</p>
            <h1 className="text-[30px] font-extrabold leading-snug text-white sm:text-[40px]">{t('أموالك، أصولك، التزاماتك وعلاقاتك في لوحة واحدة')}</h1>
            <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-white/80">
              {t('تطبيق لتسجيل وتنظيم ومتابعة التزاماتك الشخصية والمشتركة، والأفراد والجهات، والعقارات والمركبات والأنشطة التجارية، والمستندات.')}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {user ? (
                <Link to="/" className="rounded-field bg-white px-6 py-3.5 text-[15px] font-extrabold text-brand hover:bg-brand-soft">
                  {t('الدخول إلى حسابي')}
                </Link>
              ) : (
                <>
                  <Link to="/login?mode=signup" className="rounded-field bg-white px-6 py-3.5 text-[15px] font-extrabold text-brand hover:bg-brand-soft">
                    {t('أنشئ حسابك مجانًا')}
                  </Link>
                  <Link to="/login" className="rounded-field border border-white/60 px-6 py-3.5 text-[15px] font-extrabold text-white hover:bg-white/10">
                    {t('تسجيل الدخول')}
                  </Link>
                </>
              )}
            </div>
            <div className="mt-7">
              <p className="mb-2 text-[13px] font-bold text-white/70">{t('حمّل التطبيق')}</p>
              <StoreLinks />
            </div>
          </div>
          <div className="hidden justify-center lg:flex">
            <div className="grid size-72 place-items-center rounded-[48px] bg-white/10">
              <img src="/img/logo.png" alt="" className="h-40 w-auto rounded-3xl bg-white p-5" />
            </div>
          </div>
        </div>
      </section>

      {/* المزايا */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
        <h2 className="text-center text-[26px] font-extrabold text-title">{t('كل ما تديره في مكان واحد')}</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[14.5px] leading-relaxed text-sub">{t('حساب واحد تدخل به من الجوال أو من المتصفح، وبياناتك نفسها في الاثنين.')}</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([Icon, title, text]) => (
            <div key={title} className="rounded-card border border-line bg-white p-5">
              <div className="mb-3 grid size-11 place-items-center rounded-icon bg-brand-soft text-brand">
                <Icon className="size-5" />
              </div>
              <h3 className="text-[16px] font-extrabold text-title">{t(title)}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-sub">{t(text)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* الخصوصية */}
      <section className="bg-surface">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-[auto_1fr] md:items-center">
          <div className="grid size-14 place-items-center rounded-icon bg-white text-brand">
            <ShieldCheck className="size-7" />
          </div>
          <div>
            <h2 className="text-[20px] font-extrabold text-title">{t('بياناتك ملكك')}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-sub">
              {t('تحذف حسابك وكل بياناته متى شئت، وسياسة الخصوصية توضّح ما يعالجه التطبيق ولماذا.')}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] font-bold">
              <a href={`${SITE}/privacy.html${q}`} className="text-brand underline">
                {t('سياسة الخصوصية')}
              </a>
              <a href={`${SITE}/terms.html${q}`} className="text-brand underline">
                {t('شروط الاستخدام')}
              </a>
              <a href={`${SITE}/delete-account.html${q}`} className="text-brand underline">
                {t('حذف الحساب والبيانات')}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* الجهة المشغّلة */}
      <section id="company" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
        <div className="rounded-card border border-line bg-white p-6 sm:p-8">
          <h2 className="text-[22px] font-extrabold text-title">{t('عن الشركة')}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-sub">{t('فوندلي تطبيق وموقع تملكهما وتشغّلهما:')}</p>
          <p className="mt-3 text-[17px] font-extrabold text-title" dir="rtl">
            {COMPANY_AR}
          </p>
          <p className="text-[15px] font-extrabold text-brand">
            <bdi dir="ltr">{COMPANY_EN}</bdi>
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-inner bg-surface px-4 py-3">
              <MapPin className="size-5 shrink-0 text-brand" />
              <span className="text-[14px] font-bold text-ink">{t('أبوظبي، الإمارات العربية المتحدة')}</span>
            </div>
            <a href={`mailto:${EMAIL}`} className="flex items-center gap-3 rounded-inner bg-surface px-4 py-3 hover:bg-brand-soft">
              <Mail className="size-5 shrink-0 text-brand" />
              <span className="text-[14px] font-bold text-ink" dir="ltr">
                {EMAIL}
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* التذييل */}
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <img src="/img/logo.png" alt="" className="h-8 w-auto" />
            <span className="text-[13px] text-sub" dir="ltr">
              © {year} {COMPANY_EN}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-bold text-body">
            <a href={`${SITE}/privacy.html${q}`} className="hover:text-brand">
              {t('سياسة الخصوصية')}
            </a>
            <a href={`${SITE}/terms.html${q}`} className="hover:text-brand">
              {t('شروط الاستخدام')}
            </a>
            <a href={`${SITE}/delete-account.html${q}`} className="hover:text-brand">
              {t('حذف الحساب والبيانات')}
            </a>
            <a href={`mailto:${EMAIL}`} className="hover:text-brand" dir="ltr">
              {EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
