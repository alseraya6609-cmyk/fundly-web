import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Circle, Loader2, PenLine, PlusCircle, Search } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { Asset } from '@/lib/data'
import { errorText } from '@/lib/supabase'
import { AssetError } from '@/lib/assetWrite'
import { splitLogs } from '@/lib/vehicleWrite'
import {
  COMMON_FACILITIES,
  PREMISES_TYPES,
  PROPERTY_SUBTYPE_KEY,
  PROPERTY_TYPE_KEY,
  UNIT,
  addUnitsNow,
  buildUnits,
  decodeUnits,
  editStateOf,
  emptyUnitForm,
  hasRooms,
  isResidential,
  nextUnitNumber,
  saveFullEdit,
  subTypeOptions,
  unitIsLive,
  unitTypesFor,
  validateEdit,
  type PropertyEditState,
  type PropertyUnit,
  type UnitFormValues,
} from '@/lib/propertyWrite'
import { FacilityForm, Field, MeterFields, Panel, SelectField, SideEntry, SideHeader, UnitForm, UnitReviewSheet, unitIcon } from './PropertyParts'

/*
  «تعديل عقار» (_PropertyFullEditScreen): بيانات العقار، كل نوع وحدة
  بوحداته (بحث بالاسم أو الرقم)، المرافق العامة، و«إضافة وحدة جديدة» —
  ولا يُحفظ شيء إلا بـ«حفظ التعديل». من صفحة وحدة: «تعديل وحدات» بلا
  «بيانات العقار» ومفتوحًا على نوعها.
  «إضافة وحدة» من صفحة العقار (_UnitsEntryScreen): كل إضافة تُحفظ فورًا.
*/

const DATA = '__data'
const FAC = 'f:'

const propertyTypeOf = (asset: Asset) => splitLogs(asset.logs_json).meta[PROPERTY_TYPE_KEY] ?? ''

/** شاشة إضافة الوحدات والمرافق (_UnitsEntryScreen). onCommit يعيد رسالة خطأ إن تعذّر. */
export function UnitsAdder({
  propertyType,
  existing,
  facilitiesOnly = false,
  title = 'إضافة الوحدات والمرافق العامة',
  onCommit,
  onClose,
}: {
  propertyType: string
  existing: PropertyUnit[]
  facilitiesOnly?: boolean
  title?: string
  onCommit: (units: PropertyUnit[], annexes: Record<string, number>, logLine: string) => Promise<string | null> | string | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const types = facilitiesOnly ? [] : unitTypesFor(propertyType)
  const [added, setAdded] = useState<PropertyUnit[]>([])
  const [savedTypes, setSavedTypes] = useState<string[]>([])
  const [entry, setEntry] = useState(types[0] ?? FAC + COMMON_FACILITIES[0])
  const [forms, setForms] = useState<Record<string, UnitFormValues>>({})
  const [fac, setFac] = useState<Record<string, { count: string; notes: string }>>({})
  const [pending, setPending] = useState<{ type: string; units: PropertyUnit[]; annexes: Record<string, number>; log: string; rows: [string, string][] } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const all = [...existing, ...added]
  const formOf = (type: string) => forms[type] ?? emptyUnitForm(nextUnitNumber(all, type))
  const facility = entry.startsWith(FAC) ? entry.slice(FAC.length) : ''

  function commit() {
    setError('')
    if (facility) {
      const form = fac[facility] ?? { count: '', notes: '' }
      const count = parseInt(form.count.trim(), 10) || 0
      if (count <= 0) return setError('أدخل العدد أولًا')
      const note = form.notes.trim()
      setPending({
        type: facility,
        units: [],
        annexes: { [facility]: count },
        log: `تمت إضافة مرفق: ${facility} (العدد ${count})${note ? ` — ${note}` : ''}`,
        rows: [['المرفق', facility], ['العدد', String(count)], ...(note ? ([['الملاحظات', note]] as [string, string][]) : [])],
      })
      return
    }
    const built = buildUnits({ type: entry, form: formOf(entry), existing: all, wizard: false, singleUnit: false, areaFeet: false })
    if (built.error !== undefined) return setError(built.error)
    setPending({ type: entry, units: built.units, annexes: {}, log: `تمت إضافة ${built.units.length} × ${entry} من نموذج إدخال الوحدات`, rows: built.review })
  }

  async function confirm() {
    if (!pending) return
    setBusy(true)
    const problem = await onCommit(pending.units, pending.annexes, pending.log)
    setBusy(false)
    if (problem) {
      setPending(null)
      return setError(problem)
    }
    setAdded((x) => [...x, ...pending.units])
    setSavedTypes((x) => [...x, pending.type])
    if (facility) setFac((x) => ({ ...x, [facility]: { count: '', notes: '' } }))
    else
      setForms((x) => {
        const next = { ...x }
        delete next[pending.type]
        return next
      })
    setNotice(`${t('تم حفظ')} ${t(pending.type)} ${t('في العقار')}`)
    window.setTimeout(() => setNotice(''), 4000)
    setPending(null)
  }

  const side = (
    <>
      {types.length > 0 && <SideHeader>{t('الوحدات')}</SideHeader>}
      {types.map((type) => (
        <SideEntry key={type} label={t(type)} icon={unitIcon(type)} active={entry === type} badge={all.filter((u) => u.type === type && unitIsLive(u)).length} onClick={() => (setError(''), setEntry(type))} />
      ))}
      <SideHeader>{t('المرافق العامة')}</SideHeader>
      {COMMON_FACILITIES.map((f) => (
        <SideEntry key={f} label={t(f)} icon={Circle} active={entry === FAC + f} badge={savedTypes.filter((x) => x === f).length} onClick={() => (setError(''), setEntry(FAC + f))} />
      ))}
    </>
  )

  return (
    <>
      <Panel title={title} onClose={onClose} side={side}>
        {notice && <p className="mb-3 rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-bold text-brand">{notice}</p>}
        {facility ? (
          <FacilityForm
            facility={facility}
            count={fac[facility]?.count ?? ''}
            notes={fac[facility]?.notes ?? ''}
            error={error ? t(error) : undefined}
            onChange={(count, notes) => setFac((x) => ({ ...x, [facility]: { count, notes } }))}
            onCommit={commit}
          />
        ) : (
          <UnitForm key={entry} type={entry} form={formOf(entry)} onChange={(f) => setForms((x) => ({ ...x, [entry]: f }))} wizard={false} singleUnit={false} areaFeet={false} error={error ? t(error) : undefined} onCommit={commit} />
        )}
      </Panel>
      {pending && <UnitReviewSheet type={pending.type} rows={pending.rows} busy={busy} onBack={() => setPending(null)} onConfirm={confirm} />}
    </>
  )
}

/** «إضافة وحدة» / «إضافة مرفق» من صفحة العقار: تُحفظ كل إضافة فورًا. */
export function AddUnitsNow({ asset, facilitiesOnly = false, onClose, onSaved }: { asset: Asset; facilitiesOnly?: boolean; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient()
  const live = useMemo(() => decodeUnits(asset.units_json).filter(unitIsLive), [asset.units_json])
  return (
    <UnitsAdder
      propertyType={propertyTypeOf(asset)}
      existing={live}
      facilitiesOnly={facilitiesOnly}
      onClose={onClose}
      onCommit={async (units, annexes, log) => {
        try {
          await addUnitsNow(asset.id, units, annexes, log)
          await qc.invalidateQueries({ queryKey: ['assets'] })
          onSaved()
          return null
        } catch (e) {
          return e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.'
        }
      }}
    />
  )
}

export function PropertyEditor({ asset, initialType, focusKey, onClose, onDone }: { asset: Asset; initialType?: string; focusKey?: string; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const unitsOnly = initialType !== undefined
  const [s, setS] = useState<PropertyEditState>(() => editStateOf(asset))
  const [originals] = useState<PropertyUnit[]>(() => s.units.map((u) => ({ ...u, extras: { ...u.extras } })))
  const [selected, setSelected] = useState(initialType ?? DATA)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const propertyType = propertyTypeOf(asset)
  const subOptions = subTypeOptions(propertyType)
  const unitTypes = [...new Set(s.units.map((u) => u.type))]
  const n = (v: string) => parseInt(v.trim(), 10) || 0
  const setMeta = (patch: Record<string, string>) => setS((x) => ({ ...x, meta: { ...x.meta, ...patch } }))
  const setUnit = (i: number, patch: Partial<PropertyUnit>) => setS((x) => ({ ...x, units: x.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) }))
  const pick = (key: string) => {
    setSelected(key)
    setQuery('')
    setError('')
  }

  async function save() {
    setError('')
    const problem = validateEdit(s, unitsOnly)
    if (problem) {
      setSelected(problem.focus === '__data' ? DATA : problem.focus)
      return setError(problem.error)
    }
    setBusy(true)
    try {
      const result = await saveFullEdit(asset.id, s, originals, focusKey)
      await qc.invalidateQueries({ queryKey: ['assets'] })
      await qc.invalidateQueries({ queryKey: ['unit-contracts'] })
      onDone(result.contractsError ? `${t('حُفظ التعديل، وتعذّر تحديث اسم الوحدة في العقد:')} ${result.contractsError}` : 'تم حفظ تعديل العقار')
    } catch (e) {
      setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  const side = (
    <>
      {!unitsOnly && <SideEntry label={t('بيانات العقار')} icon={PenLine} active={selected === DATA} onClick={() => pick(DATA)} />}
      <SideHeader>{t('الوحدات')}</SideHeader>
      {unitTypes.map((type) => (
        <SideEntry key={type} label={t(type)} icon={unitIcon(type)} active={selected === type} badge={s.units.filter((u) => u.type === type).length} onClick={() => pick(type)} />
      ))}
      <SideEntry label={t('إضافة وحدة جديدة')} icon={PlusCircle} accent onClick={() => setAdding(true)} />
      <SideHeader>{t('المرافق العامة')}</SideHeader>
      {s.facilityNames.map((f) => (
        <SideEntry key={f} label={t(f)} icon={Circle} active={selected === FAC + f} badge={n(s.facilities[f] ?? '')} onClick={() => pick(FAC + f)} />
      ))}
    </>
  )

  const num = (v: number) => (v > 0 ? String(v) : '')
  const unitCard = (u: PropertyUnit, i: number) => {
    const type = u.type
    const rooms = hasRooms(type)
    const full = type === UNIT.fullFloor
    const residential = isResidential(type)
    const Icon = unitIcon(type)
    return (
      <div key={i} className="mb-3 rounded-card border border-line bg-white px-3 pt-3 pb-1">
        <p className="mb-3 flex items-center gap-1.5 text-[13px] font-extrabold text-title">
          <Icon className="size-4 text-brand" />
          <span dir="auto" className="min-w-0 flex-1">
            {u.name.trim() ? `${u.name.trim()} · ${t(type)}` : t(type)}
          </span>
          <span className="text-[10.5px] font-bold text-muted">{t(u.status)}</span>
        </p>
        <Field label={`${t('رقم')} ${t(type)}`} value={u.unitNumber} onChange={(v) => setUnit(i, { unitNumber: v })} />
        <Field label={`${t('اسم')} ${t(type)}`} value={u.name} onChange={(v) => setUnit(i, { name: v })} />
        {type !== UNIT.parking && <Field label={t('المساحة (متر مربع)')} value={u.area} numeric onChange={(v) => setUnit(i, { area: v })} />}
        {rooms && <Field label={t('عدد الغرف')} value={num(u.rooms)} numeric onChange={(v) => setUnit(i, { rooms: n(v) })} />}
        {(rooms || full) && <Field label={t('عدد البلكونات')} value={num(u.balconies)} numeric onChange={(v) => setUnit(i, { balconies: n(v) })} />}
        {full && <Field label={t('عدد الصالات')} value={num(u.halls)} numeric onChange={(v) => setUnit(i, { halls: n(v) })} />}
        {residential && <Field label={t('عدد الحمامات')} value={num(u.bathrooms)} numeric onChange={(v) => setUnit(i, { bathrooms: n(v) })} />}
        {residential && <Field label={t('عدد مواقف السيارات الخاصة')} value={num(u.parkingCount)} numeric onChange={(v) => setUnit(i, { parkingCount: n(v) })} />}
        {type !== UNIT.parking && <MeterFields values={u.extras} onChange={(patch) => setUnit(i, { extras: { ...u.extras, ...patch } })} />}
        <Field label={t('الملاحظات')} value={u.notes} multiline onChange={(v) => setUnit(i, { notes: v })} />
      </div>
    )
  }

  let body
  if (selected === DATA) {
    body = (
      <div>
        <Field label={t('اسم العقار')} value={s.name} onChange={(v) => setS((x) => ({ ...x, name: v }))} />
        <Field label={t('الوصف')} value={s.description} multiline onChange={(v) => setS((x) => ({ ...x, description: v }))} />
        {subOptions.length > 0 && <SelectField label={t('النوع')} value={s.meta[PROPERTY_SUBTYPE_KEY] ?? ''} options={subOptions} onChange={(v) => setMeta({ [PROPERTY_SUBTYPE_KEY]: v })} />}
        <Field label={t('العنوان / الموقع')} value={s.address} onChange={(v) => setS((x) => ({ ...x, address: v }))} />
        <Field label={t('المالك')} value={s.owner} onChange={(v) => setS((x) => ({ ...x, owner: v }))} />
        <Field label={t('رابط الموقع على خرائط جوجل')} value={s.mapLink} onChange={(v) => setS((x) => ({ ...x, mapLink: v }))} />
        <p className="mt-1 mb-2 text-[13px] font-extrabold text-title">{t('بيانات العقار الرسمية (تُستعمل في عقود الإيجار)')}</p>
        <Field label={t('المدينة')} value={s.meta['المدينة'] ?? ''} onChange={(v) => setMeta({ المدينة: v })} />
        <Field label={t('المنطقة')} value={s.meta['المنطقة'] ?? ''} onChange={(v) => setMeta({ المنطقة: v })} />
        <SelectField label={t('نوع العين')} value={s.meta['نوع العين'] ?? ''} options={PREMISES_TYPES} onChange={(v) => setMeta({ 'نوع العين': v })} />
        <Field label={t('مساحة العين (م٢)')} value={s.meta['مساحة العين'] ?? ''} numeric onChange={(v) => setMeta({ 'مساحة العين': v })} />
        <Field label={t('رقم العقار')} value={s.meta['رقم العقار'] ?? ''} onChange={(v) => setMeta({ 'رقم العقار': v })} />
        <MeterFields values={s.meta} onChange={setMeta} />
      </div>
    )
  } else if (selected.startsWith(FAC)) {
    const f = selected.slice(FAC.length)
    body = (
      <div>
        <p className="mb-3 text-[15px] font-extrabold text-title">{t(f)}</p>
        <Field label={t('العدد (0 = غير موجود)')} value={s.facilities[f] ?? ''} numeric onChange={(v) => setS((x) => ({ ...x, facilities: { ...x.facilities, [f]: v } }))} />
      </div>
    )
  } else {
    const q = query.trim()
    const indexes = s.units.map((u, i) => [u, i] as const).filter(([u]) => (q ? u.name.includes(q) || u.unitNumber.includes(q) : u.type === selected))
    body = (
      <div>
        <label className="relative mb-3 block">
          <Search className="absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted" />
          <input dir="auto" value={query} placeholder={t('ابحث باسم الوحدة أو رقمها')} onChange={(e) => setQuery(e.target.value)} className="h-12 w-full rounded-field border border-line bg-field ps-9 pe-3 text-[13.5px] font-bold text-title outline-none focus:border-gold" />
        </label>
        {indexes.length === 0 && <p className="py-5 text-center text-[12px] font-bold text-muted">{t('لا توجد وحدة مطابقة')}</p>}
        {indexes.map(([u, i]) => unitCard(u, i))}
      </div>
    )
  }

  return (
    <>
      <Panel
        title={unitsOnly ? 'تعديل وحدات' : 'تعديل عقار'}
        onClose={onClose}
        side={side}
        footer={
          <div>
            {error && <p className="mb-2 whitespace-pre-line rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
            <button type="button" disabled={busy} onClick={save} className="flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('حفظ التعديل')}
            </button>
          </div>
        }
      >
        {body}
      </Panel>
      {adding && (
        <UnitsAdder
          propertyType={propertyType}
          existing={s.units}
          title="إضافة وحدة جديدة"
          onClose={() => setAdding(false)}
          onCommit={(units, annexes) => {
            setS((x) => {
              const facilities = { ...x.facilities }
              const names = [...x.facilityNames]
              for (const [name, count] of Object.entries(annexes)) {
                if (!(name in facilities)) names.push(name)
                facilities[name] = String(n(facilities[name] ?? '') + count)
              }
              return { ...x, units: [...x.units, ...units], facilities, facilityNames: names }
            })
            if (units.length) {
              setSelected(units[0].type)
              setQuery('')
            }
            return null
          }}
        />
      )}
    </>
  )
}
