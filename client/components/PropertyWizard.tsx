import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Building2 as Apartment, CheckCircle2, Circle, Loader2, PenLine as Edit3 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { useCurrency } from '@/lib/data'
import { errorText } from '@/lib/supabase'
import { AssetError } from '@/lib/assetWrite'
import {
  AREA_UNIT_KEY,
  COMMON_FACILITIES,
  INNER_FACILITIES_KEY,
  OFFICIAL_FIELDS,
  PLACE_DESC_KEY,
  PROPERTY_SUBTYPE_KEY,
  PROPERTY_TYPES,
  REQUIRED_META,
  buildUnits,
  createProperty,
  draftAddress,
  emptyUnitForm,
  formInProgress,
  metaLabel,
  nextUnitNumber,
  singleUnitProperty,
  subTypeOptions,
  unitTypesFor,
  type PropertyDraft,
  type PropertyUnit,
  type UnitFormValues,
} from '@/lib/propertyWrite'
import { Confirm } from './Confirm'
import { Sheet } from './ui'
import { AreaField, FacilityForm, Field, MeterFields, Panel, SelectField, SideEntry, SideHeader, UnitForm, UnitReviewSheet, unitIcon } from './PropertyParts'

/*
  «إضافة عقار» كما في التطبيق (_openAddPropertyWizard):
  1) نوع الملكية (_PropertyOwnershipStepScreen) — خيار واحد «عقار».
  2) نوع العقار (_PropertyTypeGridScreen) — بلا ما أخفته الإدارة.
  3) بيانات العقار ثم الوحدات والمرافق (_AddPropertyStep1Screen): قائمة
     جانبية ونموذج؛ الوحدات والمرافق مقفولة حتى «التالي» في البيانات.
  4) المراجعة (_PropertyReviewScreen) ثم «حفظ».
*/

const DATA = '__data'
const FAC = '__f:'
const REAL_ESTATE_TITLE = 'العقارات'

/** سطر وحدة في المراجعة (_PropertyReviewScreen._unitLine). */
function unitLine(u: PropertyUnit) {
  return [
    `الاسم: ${u.name}`,
    u.unitNumber && `رقم ${u.unitNumber}`,
    u.area && `${u.area} ${u.extras[AREA_UNIT_KEY] ?? 'م²'}`,
    u.rooms > 0 && `${u.rooms} غرف`,
    u.halls > 0 && `${u.halls} صالات`,
    u.balconies > 0 && `${u.balconies} بلكونات`,
    u.bathrooms > 0 && `${u.bathrooms} حمامات`,
    u.parkingCount > 0 && `${u.parkingCount} مواقف`,
    u.notes,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function PropertyWizard({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const { hidden } = useSession()
  const qc = useQueryClient()
  const currency = useCurrency()
  const [step, setStep] = useState<'ownership' | 'type' | 'main' | 'review'>('ownership')
  const [propertyType, setPropertyType] = useState('')
  const [entry, setEntry] = useState(DATA)
  const [dataDone, setDataDone] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [meta, setMeta] = useState<Record<string, string>>({})
  const [units, setUnits] = useState<PropertyUnit[]>([])
  const [facilityCounts, setFacilityCounts] = useState<Record<string, number>>({})
  const [facilityNotes, setFacilityNotes] = useState<Record<string, string>>({})
  const [forms, setForms] = useState<Record<string, UnitFormValues>>({})
  const [facForms, setFacForms] = useState<Record<string, { count: string; notes: string }>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<{ type: string; units: PropertyUnit[]; rows: [string, string][] } | null>(null)
  const [unfinished, setUnfinished] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const unitTypes = unitTypesFor(propertyType)
  const single = singleUnitProperty(propertyType)
  const areaFeet = (meta[AREA_UNIT_KEY] ?? '') === 'قدم²'
  const officialMeta: Record<string, string> = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, v.trim()] as [string, string]).filter(([, v]) => v))
  const formOf = (type: string) => forms[type] ?? emptyUnitForm(nextUnitNumber(units, type))
  const say = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(''), 4000)
  }
  const setM = (patch: Record<string, string>) => setMeta((x) => ({ ...x, ...patch }))

  function validateData(): boolean {
    if (!name.trim()) {
      setEntry(DATA)
      setError('أدخل بيانات العقار')
      return false
    }
    const missing = REQUIRED_META.filter((k) => !(meta[k] ?? '').trim())
    if (missing.length) {
      setEntry(DATA)
      setError(`${t('أكمل الحقول الإلزامية:')} ${missing.map((k) => t(k)).join('، ')}`)
      return false
    }
    return true
  }

  function commitUnit(type = entry) {
    setError('')
    const built = buildUnits({ type, form: formOf(type), existing: units, wizard: true, singleUnit: single, areaFeet })
    if (built.error !== undefined) return setError(built.error)
    setPending({ type, units: built.units, rows: built.review })
  }

  function confirmUnits() {
    if (!pending) return
    const all = [...units, ...pending.units]
    setUnits(all)
    setForms((x) => {
      const next = { ...x }
      delete next[pending.type]
      return next
    })
    setEntry(DATA)
    say(`${t('أُضيف')} ${pending.units.length} × ${t(pending.type)} — ${t('المجموع')} ${all.length} ${t('وحدة')}`)
    setPending(null)
  }

  function commitFacility(facility: string) {
    setError('')
    const form = facForms[facility] ?? { count: '', notes: '' }
    const count = parseInt(form.count.trim(), 10) || 0
    if (count <= 0) return setError('أدخل العدد أولًا')
    setFacilityCounts((x) => ({ ...x, [facility]: (x[facility] ?? 0) + count }))
    if (form.notes.trim()) setFacilityNotes((x) => ({ ...x, [facility]: form.notes.trim() }))
    setFacForms((x) => {
      const next = { ...x }
      delete next[facility]
      return next
    })
    setEntry(DATA)
    say(`${t('أُضيف المرفق:')} ${t(facility)}`)
  }

  /** مرفق كُتب عدده ولم يُضغط «إضافة»: يُضاف تلقائيًا. */
  function commitPendingFacilities() {
    const counts = { ...facilityCounts }
    const notes = { ...facilityNotes }
    for (const [facility, form] of Object.entries(facForms)) {
      const count = parseInt(form.count.trim(), 10) || 0
      if (count <= 0) continue
      counts[facility] = (counts[facility] ?? 0) + count
      if (form.notes.trim()) notes[facility] = form.notes.trim()
    }
    setFacilityCounts(counts)
    setFacilityNotes(notes)
    setFacForms({})
    return { counts, notes }
  }

  const unitOpen = entry !== DATA && !entry.startsWith(FAC)
  function select(key: string) {
    if (key === entry) return
    setError('')
    if (unitOpen && formInProgress(forms[entry])) return setUnfinished(entry)
    setEntry(key)
  }

  function dataNext() {
    setError('')
    if (!validateData()) return
    setDataDone(true)
    if (unitTypes.length) setEntry(unitTypes[0])
  }

  function goNext() {
    setError('')
    if (unitOpen && formInProgress(forms[entry])) return setUnfinished(entry)
    commitPendingFacilities()
    if (!validateData()) return
    setDataDone(true)
    if (!units.length) {
      if (unitTypes.length) setEntry(unitTypes[0])
      setError(unitTypes.length ? `${t('أضف وحدة واحدة على الأقل — فُتح نموذج')} «${t(unitTypes[0])}» ${t('لك')}` : 'لا توجد أنواع وحدات لهذا النوع من العقارات')
      return
    }
    setStep('review')
  }

  const draft = (): PropertyDraft => ({
    isSublease: false,
    propertyType,
    name: name.trim(),
    description: description.trim(),
    units,
    facilities: { ...facilityCounts },
    facilityNotes: { ...facilityNotes },
    officialMeta,
  })

  async function save() {
    setBusy(true)
    setError('')
    try {
      await createProperty(draft(), currency)
      await qc.invalidateQueries({ queryKey: ['assets'] })
      onDone('تمت إضافة العقار')
    } catch (e) {
      setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  if (step === 'ownership') {
    return (
      <Sheet open onClose={onClose}>
        <p className="text-[19px] font-extrabold text-title">{t('إضافة عقار')}</p>
        <p className="mt-1 text-[12.5px] font-semibold text-sub">{t('نوع الملكية')}</p>
        <div className="mt-4 flex items-center gap-3 rounded-inner border-[1.6px] border-brand bg-brand/5 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-extrabold text-title">{t('عقار')}</p>
            <p className="mt-0.5 text-[12px] font-semibold text-sub">{t('عقار للتأجير سواء مالك أو مستثمر')}</p>
          </div>
          <CheckCircle2 className="size-5 text-brand" />
        </div>
        <button type="button" onClick={() => setStep('type')} className="mt-5 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
          {t('التالي')}
        </button>
      </Sheet>
    )
  }

  if (step === 'type') {
    const types = PROPERTY_TYPES.filter((x) => !hidden.has(`item:assets:${REAL_ESTATE_TITLE}:${x}`))
    return (
      <Sheet open onClose={onClose}>
        <p className="text-[19px] font-extrabold text-title">{t('نوع العقار')}</p>
        <p className="mt-1 text-[12.5px] font-semibold text-sub">{t('إضافة عقار')}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {types.map((x) => {
            const Icon = unitIcon(unitTypesFor(x).length === 1 ? unitTypesFor(x)[0] : '')
            return (
              <button
                key={x}
                type="button"
                onClick={() => {
                  setPropertyType(x)
                  setStep('main')
                }}
                className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-inner border border-line bg-white px-2 text-[13px] font-bold text-ink hover:border-brand hover:text-brand"
              >
                <Icon className="size-5 text-brand" />
                {t(x)}
              </button>
            )
          })}
        </div>
        <button type="button" onClick={() => setStep('ownership')} className="mt-3 text-[12.5px] font-bold text-brand">
          {t('رجوع')}
        </button>
      </Sheet>
    )
  }

  if (step === 'review') {
    const d = draft()
    const address = draftAddress(officialMeta)
    const row = (k: string, v: string) => (
      <div key={k} className="flex gap-2 text-[12.5px] leading-relaxed">
        <span className="shrink-0 text-sub">{t(k)}:</span>
        <span dir="auto" className="whitespace-pre-line font-bold text-ink">
          {v}
        </span>
      </div>
    )
    return (
      <Panel title="مراجعة البيانات" onClose={() => setStep('main')}>
        <p className="mb-3 text-[13px] font-bold text-sub">{t('مراجعة تفاصيل العقار قبل الإرسال')}</p>
        <div className="flex flex-col gap-1.5 rounded-inner border border-line p-4">
          <p className="mb-1 flex items-center gap-2 text-[16px] font-extrabold text-title">
            <Apartment className="size-5 text-brand" />
            <span dir="auto">{d.name || d.description || t('بدون اسم')}</span>
          </p>
          {row('نوع العقار', t(propertyType))}
          {address && row('الموقع', address)}
          {Object.entries(officialMeta)
            .filter(([k]) => k !== AREA_UNIT_KEY)
            .map(([k, v]) => row(k === 'رقم العقار' ? 'رقم الوحدة الرسمية' : metaLabel(k), k === 'مساحة العين' ? `${v} ${officialMeta[AREA_UNIT_KEY] ?? 'م²'}` : t(v)))}
          {d.description && row('الملاحظات', d.description)}
          {[...new Set(units.map((u) => u.type))].map((type) => (
            <div key={type} className="mt-2">
              <p className="text-[13px] font-extrabold text-brand">
                {t(type)} ({units.filter((u) => u.type === type).length})
              </p>
              {units
                .filter((u) => u.type === type)
                .map((u, i) => (
                  <p key={i} dir="auto" className="text-[12px] leading-relaxed text-ink">
                    • {unitLine(u)}
                  </p>
                ))}
            </div>
          ))}
          {Object.keys(d.facilities).length > 0 &&
            row(
              'المرافق العامة',
              Object.entries(d.facilities)
                .map(([k, v]) => `${t(k)} (${v})`)
                .join('، '),
            )}
        </div>
        <p className="mt-3 rounded-inner bg-gold/10 px-3 py-2 text-[12px] font-bold text-sub">{t('تأكد من جميع البيانات قبل الإرسال، يمكنك العودة للتعديل من (⋮) إذا لزم الأمر')}</p>
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" disabled={busy} onClick={() => setStep('main')} className="h-12 flex-1 rounded-field border border-line text-[14px] font-extrabold text-ink">
            {t('رجوع')}
          </button>
          <button type="button" disabled={busy} onClick={save} className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('حفظ')}
          </button>
        </div>
      </Panel>
    )
  }

  const facilityKey = entry.startsWith(FAC) ? entry.slice(FAC.length) : ''
  const subOptions = subTypeOptions(propertyType)
  const side = (
    <>
      <SideEntry label={t('بيانات العقار')} icon={Edit3} active={entry === DATA} onClick={() => select(DATA)} />
      <div className={dataDone ? '' : 'opacity-60'}>
        <SideHeader>{t('الوحدات')}</SideHeader>
        {unitTypes.map((type) => (
          <SideEntry key={type} label={t(type)} icon={unitIcon(type)} active={entry === type} locked={!dataDone} badge={units.filter((u) => u.type === type).length} onClick={() => select(type)} />
        ))}
        <SideHeader>{t('المرافق العامة')}</SideHeader>
        {COMMON_FACILITIES.map((f) => (
          <SideEntry key={f} label={t(f)} icon={Circle} active={entry === FAC + f} locked={!dataDone} badge={facilityCounts[f] ?? 0} onClick={() => select(FAC + f)} />
        ))}
      </div>
    </>
  )

  return (
    <>
      <Panel
        title="إضافة عقار"
        onClose={onClose}
        top={
          <div className="border-b border-line bg-surface/60 px-4 py-2 text-center">
            <p className="text-[11px] font-bold text-muted">{t('نوع العقار')}</p>
            <p className="text-[14px] font-extrabold text-brand">{t(propertyType)}</p>
          </div>
        }
        side={side}
        footer={
          // «اضغط هنا لإكمال عملية التسجيل» في الآخر فقط: بعد «التالي» وإضافة وحدة.
          dataDone && units.length > 0 ? (
          <div>
            {units.length > 0 && (
              <p className="mb-1.5 text-[12px] font-bold text-sub">
                {t('المضاف:')} {units.length} {t('وحدة')} · {Object.keys(facilityCounts).length} {t('مرفق')}
              </p>
            )}
            <button type="button" onClick={goNext} className={`h-12 w-full rounded-field text-[14px] font-extrabold text-white ${units.length ? 'bg-brand hover:bg-brand-dark' : 'bg-[#9BA8A5]'}`}>
              {t('اضغط هنا لإكمال عملية التسجيل')}
            </button>
          </div>
          ) : undefined
        }
      >
        {notice && <p className="mb-3 rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-bold text-brand">{notice}</p>}
        {entry === DATA ? (
          <div>
            <Field label={t('اسم العقار')} required value={name} onChange={setName} hint={`${t('مثال:')} ${t(propertyType)} ${t('الياسمين')}`} />
            {subOptions.length > 0 && <SelectField label={t('النوع')} value={meta[PROPERTY_SUBTYPE_KEY] ?? ''} options={subOptions} onChange={(v) => setM({ [PROPERTY_SUBTYPE_KEY]: v })} />}
            <p className="mt-1 mb-2 text-[13px] font-extrabold text-title">{t('بيانات العقار')}</p>
            {OFFICIAL_FIELDS.map((f) => (
              <div key={f.key}>
                {f.options ? (
                  <SelectField label={t(f.label)} value={meta[f.key] ?? ''} options={f.options} required={REQUIRED_META.includes(f.key)} onChange={(v) => setM({ [f.key]: v })} />
                ) : f.key === 'مساحة العين' ? (
                  <AreaField label={t(f.label)} value={meta[f.key] ?? ''} unit={meta[AREA_UNIT_KEY] ?? ''} onChange={(v) => setM({ [f.key]: v })} onUnit={(u) => setM({ [AREA_UNIT_KEY]: u })} />
                ) : (
                  <Field label={t(f.label)} value={meta[f.key] ?? ''} required={REQUIRED_META.includes(f.key)} numeric={f.numeric} onChange={(v) => setM({ [f.key]: v })} />
                )}
                {f.key === 'المنطقة' && (
                  <>
                    <Field label={t(PLACE_DESC_KEY)} value={meta[PLACE_DESC_KEY] ?? ''} onChange={(v) => setM({ [PLACE_DESC_KEY]: v })} multiline />
                    {single && <Field label={t(INNER_FACILITIES_KEY)} value={meta[INNER_FACILITIES_KEY] ?? ''} onChange={(v) => setM({ [INNER_FACILITIES_KEY]: v })} multiline />}
                  </>
                )}
              </div>
            ))}
            <MeterFields values={meta} onChange={setM} />
            <Field label={t('الملاحظات')} value={description} onChange={setDescription} multiline />
            {error && <p className="mb-3 whitespace-pre-line rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
            <button type="button" onClick={dataNext} className="h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
              {t('التالي')}
            </button>
          </div>
        ) : facilityKey ? (
          <FacilityForm
            facility={facilityKey}
            count={facForms[facilityKey]?.count ?? ''}
            notes={facForms[facilityKey]?.notes ?? ''}
            added={(facilityCounts[facilityKey] ?? 0) > 0 ? `${t('مضاف حاليًا:')} ${facilityCounts[facilityKey]}${facilityNotes[facilityKey] ? ` — ${facilityNotes[facilityKey]}` : ''}` : undefined}
            error={error ? t(error) : undefined}
            onChange={(count, notes) => setFacForms((x) => ({ ...x, [facilityKey]: { count, notes } }))}
            onCommit={() => commitFacility(facilityKey)}
          />
        ) : (
          <UnitForm
            key={entry}
            type={entry}
            form={formOf(entry)}
            onChange={(f) => setForms((x) => ({ ...x, [entry]: f }))}
            wizard
            singleUnit={single}
            areaFeet={areaFeet}
            error={error ? t(error) : undefined}
            onCommit={() => commitUnit()}
          />
        )}
      </Panel>
      {pending && <UnitReviewSheet type={pending.type} rows={pending.rows} onBack={() => setPending(null)} onConfirm={confirmUnits} />}
      <Confirm
        open={!!unfinished}
        title={`${t('لم تُضف')} ${t(unfinished ?? '')} ${t('بعد')}`}
        message={`${t('اضغط')} «${t('إضافة')} ${t(unfinished ?? '')}» ${t('أولًا ليتسنى لك إضافة وحدة أخرى، وتستطيع التعديل في أي وقت.')}`}
        confirmLabel={`${t('إضافة')} ${t(unfinished ?? '')} ${t('الآن')}`}
        onCancel={() => setUnfinished(null)}
        onConfirm={() => {
          const type = unfinished!
          setUnfinished(null)
          commitUnit(type)
        }}
      />
    </>
  )
}
