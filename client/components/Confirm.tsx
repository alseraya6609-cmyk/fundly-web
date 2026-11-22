import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

/** نافذة تأكيد قبل أي حفظ أو تغيير (confirmAction في التطبيق). */
export function Confirm({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  danger = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4" onClick={busy ? undefined : onCancel}>
      <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl">
        <p className="text-[17px] font-extrabold text-title">{t(title)}</p>
        <p dir="auto" className="mt-2 text-[13px] leading-relaxed text-sub">
          {message}
        </p>
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cn(
              'flex h-11 flex-1 items-center justify-center gap-2 rounded-field text-[14px] font-extrabold text-white disabled:opacity-60',
              danger ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-dark',
            )}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t(confirmLabel)}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-11 flex-1 rounded-field bg-surface text-[14px] font-bold text-body hover:bg-line disabled:opacity-60"
          >
            {t('إلغاء')}
          </button>
        </div>
      </div>
    </div>
  )
}
