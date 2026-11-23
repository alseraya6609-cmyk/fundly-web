import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

/** الرقم التعريفي داخل نص مثل «زين (FND-AB12-CD34)» — فارغ إن لا رقم. */
export const fndIn = (text: string) => text.toUpperCase().match(/FND-[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? ''

/** الرقم التعريفي مع زر نسخ يتحول إلى «تم النسخ» لحظة النسخ. */
export function FndCopy({ fnd }: { fnd: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])
  async function copy() {
    try {
      await navigator.clipboard.writeText(fnd)
    } catch {
      // بلا صلاحية الحافظة: تحديد النص يدويًا.
      const area = document.createElement('textarea')
      area.value = fnd
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={t('نسخ الرقم')}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-white px-2 text-[11px] font-extrabold text-brand ring-1 ring-line hover:bg-brand-soft"
    >
      <bdi dir="ltr">{fnd}</bdi>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span>{t(copied ? 'تم النسخ' : 'نسخ الرقم')}</span>
    </button>
  )
}
