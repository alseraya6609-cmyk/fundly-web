import { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { openFile } from '@/lib/data'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'

/**
 * فتح ملف مرفق في تبويب جديد برابط مؤقت (قراءة فقط). الملف الذي لم يُرفع
 * من الجوال بعد لا يُعثر عليه في المخزن فتظهر رسالة بدل الفتح.
 */
export function FileButton({
  file,
  label = 'فتح الملف',
  className,
}: {
  file: { bucket?: string; path?: string; localPath?: string }
  label?: string
  className?: string
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function open() {
    // يُفتح التبويب قبل انتظار الرابط حتى لا يمنعه المتصفح كنافذة منبثقة.
    const tab = window.open('', '_blank')
    setBusy(true)
    setError(false)
    const url = await openFile(file).catch(() => null)
    setBusy(false)
    if (url && tab) {
      tab.location.href = url
    } else {
      tab?.close()
      setError(true)
    }
  }

  return (
    <span className={cn('inline-flex flex-col items-start gap-1', className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          open()
        }}
        disabled={busy}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-[12px] font-bold text-brand hover:bg-brand-tint disabled:opacity-70"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
        {t(label)}
      </button>
      {error && <span className="text-[11px] text-danger">{t('الملف غير متاح — افتحه من التطبيق')}</span>}
    </span>
  )
}
