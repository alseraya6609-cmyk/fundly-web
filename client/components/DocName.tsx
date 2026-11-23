import { useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { docDisplayName } from '@/lib/data'

/*
  «اسم المستند» عند كل إرفاق (DocumentStore.askDocumentName في التطبيق):
  الاسم إلزامي، ويظهر به المستند في «المستندات» وداخل السجل بدل «مستند».
  namedFile(file) يفتح النافذة ويعيد الملف باسمه الجديد (والامتداد نفسه)،
  أو null إن أُلغي. DocNameHost مركّبة مرة واحدة في App.
*/

type Ask = { initial: string; resolve: (name: string | null) => void }

let open: ((ask: Ask) => void) | null = null

/** الامتداد «.pdf» من اسم الملف، أو ''. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || name.length - dot > 6) return ''
  return name.slice(dot).toLowerCase()
}

/** أسماء الكاميرا والمعرض العشوائية لا تُقترح (IMG_1234، image، 1700…). */
function suggestedName(file: File): string {
  const base = docDisplayName(file.name)
  return /^(img|image|photo|scan|screenshot|pxl|dsc)?[\s_-]*[\d_-]*$/i.test(base) ? '' : base
}

export function askDocName(initial = ''): Promise<string | null> {
  if (!open) return Promise.resolve(initial.trim() || null)
  return new Promise((resolve) => open!({ initial, resolve }))
}

/** يطلب اسم المستند ويعيد ملفًا جديدًا بهذا الاسم — null إن أُلغي. */
export async function namedFile(file: File | null | undefined): Promise<File | null> {
  if (!file) return null
  const typed = await askDocName(suggestedName(file))
  if (!typed) return null
  const safe = typed.replace(/[\\/:*?"<>|]/g, '_')
  return new File([file], `${safe}${extensionOf(file.name)}`, { type: file.type, lastModified: file.lastModified })
}

export function DocNameHost() {
  const { t } = useI18n()
  const [ask, setAsk] = useState<Ask | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    open = (next) => {
      setName(next.initial)
      setError(false)
      setAsk(next)
    }
    return () => {
      open = null
    }
  }, [])
  useEffect(() => {
    if (ask) window.setTimeout(() => input.current?.focus(), 30)
  }, [ask])

  if (!ask) return null
  const close = (value: string | null) => {
    ask.resolve(value)
    setAsk(null)
  }
  const save = () => {
    const v = name.trim()
    if (!v) return setError(true)
    close(v)
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-brand-deep/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="doc-name-title" className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl">
        <p id="doc-name-title" className="flex items-center gap-2 text-[17px] font-extrabold text-title">
          <FileText className="size-5 text-brand" />
          {t('اسم المستند')}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-sub">{t('اكتب اسمًا تعرف به المستند دون فتحه — يظهر به في «المستندات» وداخل السجل.')}</p>
        <input
          ref={input}
          dir="auto"
          value={name}
          maxLength={120}
          placeholder={t('مثال: فاتورة الكهرباء — نوفمبر')}
          onChange={(e) => {
            setName(e.target.value)
            setError(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') close(null)
          }}
          className="mt-3 h-11 w-full rounded-field bg-field px-3 text-[13.5px] text-title outline-none ring-1 ring-line focus:ring-2 focus:ring-gold"
        />
        {error && <p className="mt-1 text-[11.5px] font-bold text-danger">{t('اكتب اسم المستند')}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => close(null)} className="h-11 rounded-field border border-line text-[13.5px] font-extrabold text-sub hover:bg-surface">
            {t('إلغاء')}
          </button>
          <button type="button" onClick={save} className="h-11 rounded-field bg-brand text-[13.5px] font-extrabold text-white hover:bg-brand-dark">
            {t('حفظ')}
          </button>
        </div>
      </div>
    </div>
  )
}
