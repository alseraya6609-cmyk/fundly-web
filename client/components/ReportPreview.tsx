import { useEffect, useMemo, useRef } from 'react'
import { Printer, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { buildReportHtml, useReportSettings, type ReportDocument } from '@/lib/reports'

/**
 * معاينة التقرير (ReportPreviewScreen): المستند نفسه في التطبيق، والطباعة أو
 * الحفظ PDF من نافذة الطباعة في المتصفح.
 */
export function ReportPreview({ doc, onClose }: { doc: ReportDocument | null; onClose: () => void }) {
  const { t, lang, dir } = useI18n()
  const settings = useReportSettings()
  const frame = useRef<HTMLIFrameElement>(null)

  const html = useMemo(
    () =>
      doc
        ? buildReportHtml(doc, {
            t,
            lang,
            dir,
            currency: settings.currency,
            hideAmounts: settings.hideAmounts,
            userLogo: settings.userLogo,
            origin: window.location.origin,
          })
        : '',
    [doc, t, lang, dir, settings],
  )

  useEffect(() => {
    if (!doc) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [doc, onClose])

  if (!doc) return null

  function print() {
    const win = frame.current?.contentWindow
    if (!win) return
    win.focus()
    win.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page" role="dialog" aria-modal="true">
      <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-body hover:bg-line"
          aria-label={t('إغلاق')}
        >
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-[15px] font-extrabold text-title">
            {doc.title}
          </p>
          <p className="text-[11px] text-muted">
            {t(doc.archive ? 'أرشيف' : 'تقرير')} · {doc.reference} · {doc.items.length} {t('عنصر')}
          </p>
        </div>
        <button
          type="button"
          onClick={print}
          className="flex h-11 shrink-0 items-center gap-2 rounded-field bg-brand px-4 text-[13px] font-extrabold text-white hover:bg-brand-dark"
        >
          <Printer className="size-4" />
          <span>{t('طباعة / حفظ PDF')}</span>
        </button>
      </div>
      <iframe ref={frame} title={doc.title} srcDoc={html} className="min-h-0 w-full flex-1 border-0 bg-[#E9EEED]" />
    </div>
  )
}
