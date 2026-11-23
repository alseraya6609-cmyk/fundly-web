import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, Search, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

/** سهم «التالي» حسب اتجاه اللغة (في العربية يشير لليسار كما في التطبيق). */
export function Chevron({ className }: { className?: string }) {
  const { dir } = useI18n()
  const Icon = dir === 'rtl' ? ChevronLeft : ChevronRight
  return <Icon className={cn('size-5 shrink-0 text-chevron', className)} />
}

/** مربع الأيقونة الملوّن (tint) كما في بطاقات التطبيق. */
export function IconBadge({
  icon: Icon,
  color = '#0A5A50',
  size = 44,
  solid = false,
}: {
  icon: LucideIcon
  color?: string
  size?: number
  solid?: boolean
}) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-icon"
      style={{
        width: size,
        height: size,
        background: solid ? color : `${color}1f`,
        color: solid ? '#fff' : color,
      }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
    </span>
  )
}

/** ترويسة صفحة القسم: أيقونة الوحدة، العنوان والوصف، وزر الرجوع. */
export function PageHeader({
  icon,
  color,
  title,
  subtitle,
  back = true,
}: {
  icon: LucideIcon
  color: string
  title: string
  subtitle?: string
  back?: boolean
}) {
  const { t, dir } = useI18n()
  const navigate = useNavigate()
  const Back = dir === 'rtl' ? ChevronLeft : ChevronRight
  return (
    <div className="flex items-center gap-3 px-1 pb-4 pt-2">
      <IconBadge icon={icon} color={color} size={52} />
      <div className="min-w-0 flex-1">
        <h1 className="text-[20px] font-extrabold leading-tight text-title">{t(title)}</h1>
        {subtitle && <p className="mt-0.5 text-[12px] text-muted">{t(subtitle)}</p>}
      </div>
      {back && (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="grid size-11 place-items-center rounded-full bg-surface text-body hover:bg-line"
          aria-label={t('رجوع')}
        >
          <Back className="size-5" />
        </button>
      )}
    </div>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const { t } = useI18n()
  return (
    <label className="flex h-14 items-center gap-3 rounded-field border border-line bg-white px-4 focus-within:border-gold">
      <Search className="size-5 shrink-0 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(placeholder)}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-title outline-none placeholder:text-muted"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label={t('مسح')} className="text-muted">
          <X className="size-4" />
        </button>
      )}
    </label>
  )
}

export function Chip({
  active,
  label,
  icon: Icon,
  count,
  onClick,
}: {
  active: boolean
  label: string
  icon?: LucideIcon
  count?: number
  onClick: () => void
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-11 shrink-0 items-center gap-2 rounded-inner border px-4 text-[13px] font-bold transition-colors',
        active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-body hover:border-hairline',
      )}
    >
      {Icon && <Icon className="size-4" />}
      <span>{t(label)}</span>
      {count !== undefined && (
        <span
          className={cn(
            'grid min-w-6 place-items-center rounded-full px-1.5 text-[11px]',
            active ? 'bg-white/20 text-white' : 'bg-surface text-sub',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="mb-3 mt-6 flex items-center gap-2">
      <span className="h-5 w-1 rounded-full bg-gold" />
      <h2 className="text-[17px] font-extrabold text-title">{children}</h2>
      {count !== undefined && (
        <span className="grid min-w-7 place-items-center rounded-full bg-brand-soft px-2 text-[12px] font-bold text-brand">
          {count}
        </span>
      )}
    </div>
  )
}

export function Loading() {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Loader2 className="size-5 animate-spin" />
      <span className="text-[13px]">{t('جارٍ تحميل السجلات من الخادم...')}</span>
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useI18n()
  const message = String((error as { message?: string })?.message ?? error ?? '')
  return (
    <div className="rounded-inner bg-danger-soft px-4 py-3 text-[13px] text-danger">
      {t('تعذّر تحميل البيانات')}
      {message ? <span className="ltr block text-[11px] opacity-80">{message}</span> : null}
    </div>
  )
}

export function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-12 text-center">
      <Icon className="size-9 text-muted" strokeWidth={1.6} />
      <p className="text-[14px] text-sub">{t(text)}</p>
    </div>
  )
}

/** نافذة التفاصيل: من الأسفل على الجوال، وفي الوسط على الشاشات الكبيرة. */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-deep/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-card bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-card"
      >
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full bg-surface text-body"
            aria-label={t('إغلاق')}
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** صف «عنوان: قيمة» داخل التفاصيل. */
export function InfoRow({ label, value, ltr = false }: { label: string; value: ReactNode; ltr?: boolean }) {
  const { t } = useI18n()
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-0">
      <span className="shrink-0 text-[13px] text-muted">{t(label)}</span>
      <span className={cn('whitespace-pre-line text-end text-[14px] font-semibold text-ink', ltr && 'ltr')}>{value}</span>
    </div>
  )
}
