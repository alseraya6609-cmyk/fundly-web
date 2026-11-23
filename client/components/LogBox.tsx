import { useState } from 'react'
import { History } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { Asset } from '@/lib/data'
import { splitLogs } from '@/lib/vehicleWrite'
import type { PropertyUnit } from '@/lib/propertyWrite'

/*
  «السجل» في الموقع: سجل العقار/الأصل (logs_json، يُحفظ الأحدث أولًا) وسجل
  الوحدة (__سجل الوحدة: تعديل الاسم، التمديد...). الأحدث في أول سطر.
*/

const SHOWN = 8

function Lines({ lines }: { lines: { text: string; when?: string }[] }) {
  const { t } = useI18n()
  const [all, setAll] = useState(false)
  if (!lines.length) return null
  const shown = all ? lines : lines.slice(0, SHOWN)
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-1.5 text-[14px] font-extrabold text-title">
        <History className="size-4 text-brand" />
        {t('السجل')} <span className="text-[12px] font-bold text-muted">({lines.length})</span>
      </p>
      <div className="card-inner divide-y divide-line px-3">
        {shown.map((l, i) => (
          <div key={i} className="py-2.5">
            <p dir="auto" className="text-[12.5px] font-bold leading-relaxed text-ink">
              {l.text}
            </p>
            {l.when && <p className="mt-0.5 text-[11px] text-muted">{l.when}</p>}
          </div>
        ))}
      </div>
      {lines.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-[12px] font-extrabold text-brand underline">
          {t(all ? 'عرض أقل' : 'عرض الكل')}
        </button>
      )}
    </div>
  )
}

/** سجل العقار أو النشاط أو المركبة. */
export function AssetLogBox({ asset }: { asset: Asset }) {
  const lines = splitLogs(asset.logs_json)
    .logs.map((x) => x.trim())
    .filter(Boolean)
    .map((text) => ({ text }))
  return <Lines lines={lines} />
}

const two = (n: number) => String(n).padStart(2, '0')

/** سجل الوحدة (_buildUnitLogSection). */
export function UnitLogBox({ unit }: { unit: PropertyUnit }) {
  const { t } = useI18n()
  let rows: Record<string, unknown>[] = []
  try {
    const decoded = JSON.parse(unit.extras['__سجل الوحدة'] ?? '[]')
    if (Array.isArray(decoded)) rows = decoded.filter((r) => r && typeof r === 'object')
  } catch {
    rows = []
  }
  const lines = [...rows].reverse().map((row) => {
    const at = new Date(String(row.at ?? ''))
    const when = Number.isNaN(at.getTime()) ? '' : `${two(at.getDate())}/${two(at.getMonth() + 1)}/${at.getFullYear()} · ${t('الساعة')} ${two(at.getHours())}:${two(at.getMinutes())}`
    const text = row.type === 'rename' ? `${t('تم تعديل الاسم من')} «${String(row.from ?? '')}» ${t('إلى')} «${String(row.to ?? '')}»` : String(row.text ?? '')
    return { text, when }
  })
  return <Lines lines={lines} />
}
