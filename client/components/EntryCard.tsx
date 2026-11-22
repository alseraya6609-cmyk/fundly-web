import type { LucideIcon } from 'lucide-react'
import { Chevron, IconBadge } from './ui'
import { useI18n } from '@/lib/i18n'

/**
 * بطاقة سجل في القوائم، بنفس ترتيب التطبيق: الأيقونة، ثم العنوان والنوع
 * الملوّن، ثم المبلغ والتاريخ، ثم سهم الفتح. النصوص تلتف ولا تُقطع (قاعدة
 * التطبيق: كل جملة تظهر كاملة على أي شاشة).
 */
export function EntryCard({
  icon,
  color,
  title,
  type,
  amount,
  meta,
  badge,
  onClick,
}: {
  icon: LucideIcon
  color: string
  title: string
  type?: string
  amount?: string
  meta?: string
  badge?: string
  onClick?: () => void
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      className="card flex w-full items-center gap-3 p-4 text-start transition-colors hover:bg-line/70"
    >
      <IconBadge icon={icon} color={color} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p dir="auto" className="break-words text-[15px] font-extrabold leading-snug text-title">
            {title}
          </p>
          {badge && (
            <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">
              {t(badge)}
            </span>
          )}
        </div>
        {type && (
          <p dir="auto" className="mt-0.5 break-words text-[12px] font-bold" style={{ color }}>
            {type}
          </p>
        )}
        {(amount || meta) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5">
            {amount && (
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
                <span className="size-1.5 shrink-0 rounded-full bg-brand-light" />
                <span>{amount}</span>
              </p>
            )}
            {meta && <p className="text-[11px] text-muted">{meta}</p>}
          </div>
        )}
      </div>
      <Chevron />
    </button>
  )
}
