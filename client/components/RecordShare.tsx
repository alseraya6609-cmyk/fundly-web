import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileText, Printer, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { buildRecordHtml, type RecordDoc } from '@/lib/recordPrint'

/*
  «مشاركة كمستند PDF» (askPdfLetterhead + buildRecordPdf + Printing.sharePdf):
  يُسأل أولًا بترويسة Fundly أو بدونها، ثم يُعرض المستند ويُطبع أو يُحفظ PDF
  من نافذة الطباعة في المتصفح.
*/

function LetterheadAsk({ onPick, onClose }: { onPick: (letterhead: boolean) => void; onClose: () => void }) {
  const { t } = useI18n()
  const option = (letterhead: boolean, title: string, sub: string) => (
    <button type="button" onClick={() => onPick(letterhead)} className="flex w-full items-start gap-3 rounded-inner px-2 py-3 text-start hover:bg-brand-soft">
      <FileText className="mt-0.5 size-5 shrink-0 text-brand" />
      <span className="flex flex-col">
        <span className="text-[13.5px] font-extrabold text-title">{t(title)}</span>
        <span className="text-[11.5px] text-muted">{t(sub)}</span>
      </span>
    </button>
  )
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-[16px] font-extrabold text-title">{t('مشاركة كمستند PDF')}</p>
        {option(true, 'بترويسة Fundly', 'الشعار والاسم ورقم المستند والتاريخ')}
        {option(false, 'بدون ترويسة', 'مستند أبيض بالبيانات فقط')}
      </div>
    </div>
  )
}

export function RecordPreview({ doc, onClose }: { doc: RecordDoc; onClose: () => void }) {
  const { t, lang, dir } = useI18n()
  const frame = useRef<HTMLIFrameElement>(null)
  const html = useMemo(() => buildRecordHtml(doc, { t, lang, dir, origin: window.location.origin }), [doc, t, lang, dir])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-page" role="dialog" aria-modal="true">
      <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
        <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-body hover:bg-line" aria-label={t('إغلاق')}>
          <X className="size-5" />
        </button>
        <p dir="auto" className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-title">
          {doc.title}
        </p>
        <button
          type="button"
          onClick={() => {
            const win = frame.current?.contentWindow
            if (!win) return
            win.focus()
            win.print()
          }}
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

/**
 * يعيد دالة البدء وواجهة النافذتين. [build] يبني المستند حسب الترويسة؛
 * [ask]=false يتخطّى سؤال الترويسة (تسوية الحساب في التطبيق بترويسة دائمًا).
 */
export function useRecordShare(): { start: (build: (letterhead: boolean) => RecordDoc, ask?: boolean) => void; ui: ReactNode } {
  const [pending, setPending] = useState<((letterhead: boolean) => RecordDoc) | null>(null)
  const [doc, setDoc] = useState<RecordDoc | null>(null)
  const ui = (
    <>
      {pending && (
        <LetterheadAsk
          onClose={() => setPending(null)}
          onPick={(letterhead) => {
            const build = pending
            setPending(null)
            setDoc(build(letterhead))
          }}
        />
      )}
      {doc && <RecordPreview doc={doc} onClose={() => setDoc(null)} />}
    </>
  )
  return {
    start: (build, ask = true) => {
      if (ask) setPending(() => build)
      else setDoc(build(true))
    },
    ui,
  }
}
