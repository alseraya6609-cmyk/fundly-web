import { useEffect, useState, type ReactNode } from 'react'
import { Building, Building2, Car, DoorOpen, Home, Landmark, Layers, Plus, Store, Warehouse, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import {
  AREA_UNIT_KEY,
  AREA_UNITS,
  INNER_FACILITIES_KEY,
  METER_FIELDS,
  PREMISES_TYPES,
  UNIT,
  hasRooms,
  isResidential,
  rangeCount,
  type UnitFormValues,
} from '@/lib/propertyWrite'
import { Sheet } from './ui'

/*
  أجزاء شاشات العقار المشتركة (إضافة العقار، تعديله، إضافة وحدات): اللوح
  بشقّيه (قائمة جانبية ونموذج)، الحقول، خانات العدادات، نموذج الوحدة،
  نموذج المرفق، ومراجعة الوحدة قبل إضافتها (_confirmUnitEntry).
*/

export const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

/** _unitTypeIcon */
export function unitIcon(type: string): LucideIcon {
  if (type === UNIT.shop || type === UNIT.showroom) return Store
  if (type === UNIT.warehouse) return Warehouse
  if (type === UNIT.parking) return Car
  if (type === UNIT.office) return Building
  if (type === UNIT.room || type === UNIT.studio) return DoorOpen
  if (type === UNIT.fullFloor || type === UNIT.mezzanine) return Layers
  if (type === UNIT.land || type === UNIT.station) return Landmark
  if (type === UNIT.apartment || type === UNIT.chalet) return Home
  return Building2
}

/** لوح كامل بشقّين: قائمة جانبية ونموذج، وشريط سفلي ثابت. */
export function Panel({ title, top, side, footer, onClose, children }: { title: string; top?: ReactNode; side?: ReactNode; footer?: ReactNode; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n()
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-deep/40 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" className="flex h-[94vh] w-full flex-col overflow-hidden rounded-t-card bg-white shadow-2xl sm:h-[90vh] sm:max-w-4xl sm:rounded-card">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-[17px] font-extrabold text-title">{t(title)}</p>
          <button type="button" onClick={onClose} aria-label={t('إغلاق')} className="grid size-9 place-items-center rounded-full bg-surface text-body">
            <X className="size-4" />
          </button>
        </div>
        {top}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {side && <div className="max-h-44 shrink-0 overflow-y-auto border-b border-line bg-surface/50 py-2 sm:max-h-none sm:w-52 sm:border-b-0 sm:border-e">{side}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        </div>
        {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function SideHeader({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-3 pb-1 text-[11px] font-extrabold text-muted">{children}</p>
}

export function SideEntry({ label, icon: Icon, active, badge = 0, locked = false, accent = false, onClick }: { label: string; icon: LucideIcon; active?: boolean; badge?: number; locked?: boolean; accent?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] leading-tight',
        active ? 'bg-brand/10 font-extrabold text-brand' : accent ? 'font-extrabold text-brand' : 'font-bold text-title hover:bg-brand/5',
        locked && 'opacity-45',
      )}
    >
      <Icon className={cn('size-4 shrink-0', active || accent ? 'text-brand' : 'text-muted')} />
      <span className="min-w-0 flex-1">{label}</span>
      {badge > 0 && <span className="text-[10.5px] font-extrabold text-brand">{badge}</span>}
    </button>
  )
}

export function Field({
  label,
  value,
  onChange,
  numeric = false,
  multiline = false,
  required = false,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  numeric?: boolean
  multiline?: boolean
  required?: boolean
  hint?: string
}) {
  return (
    <label className="mb-3 flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {multiline ? (
        <textarea dir="auto" rows={2} value={value} placeholder={hint} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, 'h-auto min-h-20 py-2.5')} />
      ) : (
        <input dir="auto" inputMode={numeric ? 'decimal' : undefined} value={value} placeholder={hint} onChange={(e) => onChange(numeric ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value)} className={inputClass} />
      )}
    </label>
  )
}

export function SelectField({ label, value, options, onChange, required = false, blank = true }: { label: string; value: string; options: string[]; onChange: (v: string) => void; required?: boolean; blank?: boolean }) {
  const { t } = useI18n()
  return (
    <label className="mb-3 flex flex-col gap-1">
      {label && (
        <span className="text-[12px] font-bold text-sub">
          {label}
          {required && <span className="text-danger"> *</span>}
        </span>
      )}
      <select value={options.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {blank && <option value="">—</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {t(o)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** المساحة بجانبها وحدتها (م² / قدم²). */
export function AreaField({ label, value, unit, onChange, onUnit, required = false }: { label: string; value: string; unit: string; onChange: (v: string) => void; onUnit: (u: string) => void; required?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <Field label={label} value={value} onChange={onChange} numeric required={required} />
      </div>
      <div className="w-24 pt-5">
        <SelectField label="" value={AREA_UNITS.includes(unit) ? unit : AREA_UNITS[0]} options={AREA_UNITS} onChange={onUnit} blank={false} />
      </div>
    </div>
  )
}

/**
  _MeterCountField: خانة لكل عداد (واحدة في البداية، و«+» تضيف). العدد = الخانات
  المكتوب فيها رقم، وبلا أي رقم = عدد الخانات، وخانة واحدة فارغة = لا عدادات.
  الأرقام سطر لكل عداد.
*/
export function MeterField({ numberLabel, count, numbers, onChange }: { numberLabel: string; count: string; numbers: string; onChange: (count: string, numbers: string) => void }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<string[]>(() => {
    const saved = numbers.split('\n').map((v) => v.trim())
    const filled = saved.filter(Boolean).length
    let n = parseInt(count.trim(), 10) || 0
    if (n < filled) n = filled
    if (n < 1) n = 1
    if (n > 50) n = 50
    return Array.from({ length: n }, (_, i) => (i < saved.length ? saved[i] : ''))
  })
  const sync = (next: string[]) => {
    setRows(next)
    const filled = next.map((v) => v.trim()).filter(Boolean)
    const none = filled.length === 0 && next.length === 1
    onChange(none ? '' : String(filled.length ? filled.length : next.length), filled.join('\n'))
  }
  return (
    <div className="mb-1">
      {rows.map((value, i) => (
        <div key={i} className="mb-2 flex items-center gap-2">
          <input dir="auto" value={value} placeholder={t(numberLabel) + (rows.length > 1 ? ` ${i + 1}` : '')} onChange={(e) => sync(rows.map((r, j) => (j === i ? e.target.value : r)))} className={inputClass} />
          {i > 0 && (
            <button type="button" aria-label={t('حذف العداد')} onClick={() => sync(rows.filter((_, j) => j !== i))} className="text-danger">
              <X className="size-4" />
            </button>
          )}
          {i === rows.length - 1 && rows.length < 50 && (
            <button type="button" aria-label={t('إضافة عداد')} title={t('إضافة عداد')} onClick={() => sync([...rows, ''])} className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
              <Plus className="size-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** خانات عدادات الكهرباء والمياه لمجموعة قيم (بيانات العقار أو الوحدة). */
export function MeterFields({ values, onChange }: { values: Record<string, string>; onChange: (patch: Record<string, string>) => void }) {
  const { t } = useI18n()
  return (
    <>
      {METER_FIELDS.map(([countKey, numbersKey, countLabel, numberLabel]) => (
        <div key={countKey}>
          <p className="mb-1 text-[12px] font-bold text-sub">{t(countLabel)}</p>
          <MeterField numberLabel={numberLabel} count={values[countKey] ?? ''} numbers={values[numbersKey] ?? ''} onChange={(c, nums) => onChange({ [countKey]: c, [numbersKey]: nums })} />
        </div>
      ))}
    </>
  )
}

/** _syncCountToRange / _syncRangeToCount */
export function withCount(f: UnitFormValues, count: string): UnitFormValues {
  const q = parseInt(count.trim(), 10) || 0
  const first = parseInt(f.firstNumber.trim(), 10) || 1
  return { ...f, count, lastNumber: q > 1 ? String(first + q - 1) : '' }
}
export function withFirst(f: UnitFormValues, firstNumber: string): UnitFormValues {
  const q = parseInt(f.count.trim(), 10) || 0
  const first = parseInt(firstNumber.trim(), 10) || 1
  return { ...f, firstNumber, lastNumber: q > 1 ? String(first + q - 1) : '' }
}
export function withLast(f: UnitFormValues, lastNumber: string): UnitFormValues {
  const first = parseInt(f.firstNumber.trim(), 10) || 1
  const last = parseInt(lastNumber.trim(), 10) || 0
  return { ...f, lastNumber, count: last >= first ? String(last - first + 1) : f.count }
}

/**
  نموذج نوع وحدة: العدد، ثم رقم أول وإلى رقم (أو الرقم)، ثم الاسم، والمساحة،
  وحقول النوع، والعدادات، والملاحظات، و«إضافة <النوع>».
  wizard: بيانات الوحدة كالعقار المستقل في العقار متعدد الوحدات.
*/
export function UnitForm({ type, form, onChange, wizard, singleUnit, areaFeet, error, onCommit }: { type: string; form: UnitFormValues; onChange: (f: UnitFormValues) => void; wizard: boolean; singleUnit: boolean; areaFeet: boolean; error?: string; onCommit: () => void }) {
  const { t } = useI18n()
  const countOnly = type === UNIT.parking
  const rooms = hasRooms(type)
  const residential = isResidential(type)
  const showFull = wizard ? type === UNIT.fullFloor : type === UNIT.apartment || type === UNIT.fullFloor
  const count = rangeCount(form)
  const first = parseInt(form.firstNumber.trim(), 10) || 1
  const set = (patch: Partial<UnitFormValues>) => onChange({ ...form, ...patch })
  const setMeta = (key: string, value: string) => onChange({ ...form, unitMeta: { ...form.unitMeta, [key]: value } })
  const feet = singleUnit || !wizard ? areaFeet : (form.unitMeta[AREA_UNIT_KEY] ?? '') === 'قدم²'
  const areaLabel = t(feet ? 'مساحة كل وحدة (قدم مربع)' : 'مساحة كل وحدة (متر مربع)')
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-title">
        {(() => {
          const Icon = unitIcon(type)
          return <Icon className="size-5 text-brand" />
        })()}
        {t('إضافة')} {t(type)}
      </p>
      <Field label={t('العدد (سجّل أكثر من 1 لإضافة عدة وحدات مرة واحدة)')} value={form.count} onChange={(v) => onChange(withCount(form, v))} numeric />
      {!countOnly && (
        <>
          {count > 1 ? (
            <>
              <Field label={`${t('رقم أول')} ${t(type)}`} value={form.firstNumber} onChange={(v) => onChange(withFirst(form, v))} numeric />
              <Field label={t('إلى رقم (تسجيل تلقائي)')} value={form.lastNumber} onChange={(v) => onChange(withLast(form, v))} numeric />
              <p className="-mt-1 mb-3 rounded-inner bg-brand-soft px-3 py-2 text-[11.5px] font-bold leading-relaxed text-brand">
                {t('الرقم من')} {first} {t('إلى')} {first + count - 1} — {t('سيتم تسجيل الوحدات تلقائيًا، وتستطيع تعديل البيانات بعد عملية الحفظ.')}
              </p>
            </>
          ) : (
            <Field label={`${t('رقم')} ${t(type)}`} value={form.firstNumber} onChange={(v) => onChange(withFirst(form, v))} numeric />
          )}
          <Field label={`${t('اسم')} ${t(type)}`} required value={form.name} onChange={(v) => set({ name: v })} />
          {!wizard || singleUnit ? (
            <Field label={areaLabel} value={form.area} onChange={(v) => set({ area: v })} numeric />
          ) : (
            <>
              <AreaField label={areaLabel} value={form.area} unit={form.unitMeta[AREA_UNIT_KEY] || AREA_UNITS[0]} onChange={(v) => set({ area: v })} onUnit={(u) => setMeta(AREA_UNIT_KEY, u)} />
              <SelectField label={t('نوع العين')} value={form.unitMeta['نوع العين'] ?? ''} options={PREMISES_TYPES} onChange={(v) => setMeta('نوع العين', v)} />
              {count <= 1 && <Field label={t('رقم الوحدة الرسمية')} value={form.unitMeta['رقم العقار'] ?? ''} onChange={(v) => setMeta('رقم العقار', v)} />}
              <Field label={t(INNER_FACILITIES_KEY)} value={form.unitMeta[INNER_FACILITIES_KEY] ?? ''} onChange={(v) => setMeta(INNER_FACILITIES_KEY, v)} multiline />
            </>
          )}
          {rooms && <Field label={t('عدد الغرف')} value={form.rooms} onChange={(v) => set({ rooms: v })} numeric />}
          {(rooms || showFull) && <Field label={t('عدد البلكونات')} value={form.balconies} onChange={(v) => set({ balconies: v })} numeric />}
          {showFull && <Field label={t('عدد الصالات')} value={form.halls} onChange={(v) => set({ halls: v })} numeric />}
          {residential && <Field label={t('عدد الحمامات')} value={form.bathrooms} onChange={(v) => set({ bathrooms: v })} numeric />}
          {residential && <Field label={t('عدد مواقف السيارات الخاصة')} value={form.parking} onChange={(v) => set({ parking: v })} numeric />}
        </>
      )}
      {type !== UNIT.parking && (
        <>
          <MeterFields values={form.meters} onChange={(patch) => set({ meters: { ...form.meters, ...patch } })} />
          <p className="mb-3 text-[11px] font-semibold leading-relaxed text-muted">{t('عند إضافة أكثر من وحدة معًا: يُحفظ عدد العدادات لكل وحدة، وأرقامها تُكتب لكل وحدة من «تعديل الوحدات».')}</p>
        </>
      )}
      <Field label={t('الملاحظات')} value={form.notes} onChange={(v) => set({ notes: v })} multiline />
      {error && <p className="mb-3 whitespace-pre-line rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{error}</p>}
      <button type="button" onClick={onCommit} className="h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
        {t('إضافة')} {t(type)}
      </button>
    </div>
  )
}

/** نموذج المرفق: العدد والملاحظات. */
export function FacilityForm({ facility, count, notes, added, error, onChange, onCommit }: { facility: string; count: string; notes: string; added?: string; error?: string; onChange: (count: string, notes: string) => void; onCommit: () => void }) {
  const { t } = useI18n()
  return (
    <div>
      <p className="mb-3 text-[15px] font-extrabold text-title">
        {t('مرفق:')} {t(facility)}
      </p>
      <Field label={t('العدد')} value={count} onChange={(v) => onChange(v, notes)} numeric />
      <Field label={t('الملاحظات')} value={notes} onChange={(v) => onChange(count, v)} multiline />
      {added && <p className="mb-3 text-[12px] font-bold text-brand">{added}</p>}
      {error && <p className="mb-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{error}</p>}
      <button type="button" onClick={onCommit} className="h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
        {t('إضافة')}
      </button>
    </div>
  )
}

/** _confirmUnitEntry: ما سيُضاف سطرًا سطرًا ثم تأكيد. */
export function UnitReviewSheet({ type, rows, busy, error, onBack, onConfirm }: { type: string; rows: [string, string][]; busy?: boolean; error?: string; onBack: () => void; onConfirm: () => void }) {
  const { t } = useI18n()
  return (
    <Sheet open onClose={onBack}>
      <p className="text-[17px] font-extrabold text-title">
        {t('مراجعة')} {t(type)}
      </p>
      <div className="mt-3 flex flex-col gap-1 rounded-inner bg-surface p-3">
        {rows.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="flex justify-between gap-3 text-[12.5px]">
            <span className="text-sub">{t(k)}</span>
            <span dir="auto" className="text-end font-bold text-ink">
              {t(v)}
            </span>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy} onClick={onBack} className="h-12 flex-1 rounded-field border border-line text-[14px] font-extrabold text-ink">
          {t('رجوع')}
        </button>
        <button type="button" disabled={busy} onClick={onConfirm} className="h-12 flex-[2] rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
          {t('تأكيد')}
        </button>
      </div>
    </Sheet>
  )
}
