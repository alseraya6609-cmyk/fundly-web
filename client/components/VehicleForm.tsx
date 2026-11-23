import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Loader2, MinusCircle, Paperclip, Plus, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { useCurrency } from '@/lib/data'
import { usePageContracts } from '@/lib/delegatedAssets'
import { errorText } from '@/lib/supabase'
import { FileError, uploadDeviceFile } from '@/lib/files'
import { AssetError } from '@/lib/assetWrite'
import {
  EQ,
  EQUIP_LEADS,
  VEHICLES_TITLE,
  VEHICLE_LAND,
  VEHICLE_MARINE,
  VEHICLE_TYPES,
  buildAnnexes,
  buildVehicleMeta,
  createVehicle,
  displayDate,
  formKeys,
  inputDate,
  isEquipment,
  isMarine,
  isRoadVehicle,
  updateVehicle,
  validateVehicle,
  type VehicleDraft,
} from '@/lib/vehicleWrite'
import { Sheet } from './ui'
import { namedFile } from '@/components/DocName'

/*
  «إضافة مركبة» كما في التطبيق: التصنيف (برية / بحرية) ثم النوع
  (_pickVehicleType)، ثم نموذج المركبة (_AddEquipmentScreen) بحقول تتغيّر
  بالنوع، ثم مراجعة كل ما أُدخل وتأكيد قبل الحفظ. والتعديل بالنموذج نفسه.
*/

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

/** منتقي التصنيف ثم النوع — بلا ما أخفته الإدارة. */
export function VehicleTypePicker({ onClose, onPick }: { onClose: () => void; onPick: (vehicleClass: string, type: string) => void }) {
  const { t } = useI18n()
  const { hidden } = useSession()
  const [group, setGroup] = useState<string | null>(null)
  const shown = (item: string) => !hidden.has(`item:assets:${VEHICLES_TITLE}:${item}`)
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[19px] font-extrabold text-title">{t(group ?? 'المركبات ووسائل النقل')}</p>
      <p className="mt-1 text-[12.5px] font-semibold text-sub">{t(group ? 'اختر نوع المركبة' : 'اختر التصنيف')}</p>
      <div className="mt-4 flex flex-col gap-2">
        {group === null
          ? [VEHICLE_LAND, VEHICLE_MARINE].filter(shown).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className="flex h-13 items-center justify-between rounded-inner border border-line bg-white px-4 py-3.5 text-[14px] font-extrabold text-title hover:border-brand"
              >
                {t(g)}
                <ChevronLeft className="size-4 text-muted rtl:rotate-0 ltr:rotate-180" />
              </button>
            ))
          : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {VEHICLE_TYPES[group].filter(shown).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onPick(group, type)}
                      className="flex h-12 items-center justify-center rounded-inner border border-line bg-white px-2 text-[13px] font-bold text-ink hover:border-brand hover:text-brand"
                    >
                      {t(type)}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setGroup(null)} className="mt-1 text-[12.5px] font-bold text-brand">
                  {t('رجوع')}
                </button>
              </>
            )}
      </div>
    </Sheet>
  )
}

type Props = {
  vehicleClass: string
  vehicleType: string
  /** عند التعديل: المركبة ومعرّفها. */
  initial?: VehicleDraft
  assetId?: string
  onClose: () => void
  onDone: (message: string) => void
}

export function VehicleForm({ vehicleClass, vehicleType, initial, assetId, onClose, onDone }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const currency = useCurrency()
  const contracts = usePageContracts()
  const editing = !!initial
  const marine = isMarine(vehicleClass)
  const road = isRoadVehicle(vehicleClass, vehicleType)
  const equipment = isEquipment(vehicleClass, vehicleType)
  const initialMeta = initial?.meta ?? {}
  const [name, setName] = useState(initial?.name ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [serial, setSerial] = useState(initial?.serial ?? '')
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(formKeys(vehicleClass, vehicleType).map((k) => [k, initialMeta[k] ?? ''])))
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [accessories, setAccessories] = useState<{ name: string; count: string }[]>(() => {
    const rows = Object.entries(initial?.annexes ?? {}).map(([n, c]) => ({ name: n, count: String(c) }))
    return rows.length ? rows : [{ name: '', count: '' }]
  })
  const [otherDocs, setOtherDocs] = useState<string[]>(() => (initialMeta[EQ.otherDocs] ?? '').split('\n').map((x) => x.trim()).filter(Boolean))
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<VehicleDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }))
  // «أكمل: رقم التواصل، البريد الإلكتروني» تُترجم أجزاؤها.
  const tr = (m: string) => (m.startsWith('أكمل: ') ? `${t('أكمل:')} ${m.slice(6).split('، ').map((x) => t(x)).join('، ')}` : t(m))
  const pick = (key: string) => choices[key] ?? ((initialMeta[key] ?? '') === '' ? 'قبل شهر' : initialMeta[key])

  function submit() {
    setError('')
    const problem = validateVehicle(name, values)
    if (problem) return setError(problem)
    const meta = buildVehicleMeta({ initial: initialMeta, vehicleClass, vehicleType, model, values, choices, otherDocs })
    setReview({ name: name.trim(), model: model.trim(), serial: serial.trim(), meta, annexes: buildAnnexes(accessories) })
  }

  async function save() {
    if (!review) return
    setBusy(true)
    setError('')
    try {
      if (editing && assetId) await updateVehicle(assetId, review, contracts.data ?? [])
      else await createVehicle(review, currency)
      await qc.invalidateQueries({ queryKey: ['assets'] })
      await qc.invalidateQueries({ queryKey: ['store'] })
      onDone(editing ? 'تم حفظ التعديل بنجاح' : 'تمت إضافة المركبة')
    } catch (e) {
      setReview(null)
      setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  const label = (text: string, required = false) => (
    <span className="text-[12px] font-bold text-sub">
      {t(text)}
      {required && <span className="text-danger"> *</span>}
    </span>
  )
  const text = (title: string, value: string, onChange: (v: string) => void, opts: { required?: boolean; numeric?: boolean; hint?: string; wide?: boolean } = {}) => (
    <label className={`flex flex-col gap-1 ${opts.wide === false ? '' : 'col-span-2'}`}>
      {label(title, opts.required)}
      <input dir="auto" inputMode={opts.numeric ? 'decimal' : undefined} value={value} placeholder={opts.hint ? t(opts.hint) : undefined} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </label>
  )
  const dateField = (title: string, key: string) => (
    <label className="flex flex-col gap-1">
      {label(title)}
      <span className="relative">
        <input type="date" value={inputDate(values[key] ?? '')} onChange={(e) => set(key, displayDate(e.target.value))} className={inputClass} />
        {values[key] && (
          <button type="button" aria-label={t('مسح')} onClick={() => set(key, '')} className="absolute top-1/2 left-9 -translate-y-1/2 text-muted hover:text-danger">
            <X className="size-4" />
          </button>
        )}
      </span>
    </label>
  )
  const lead = (key: string, customKey: string) => {
    const current = EQUIP_LEADS.includes(pick(key)) ? pick(key) : 'قبل شهر'
    return (
      <label className="flex flex-col gap-1">
        {label('تذكير قبل الانتهاء')}
        <select value={current} onChange={(e) => setChoices((x) => ({ ...x, [key]: e.target.value }))} className={inputClass}>
          {EQUIP_LEADS.map((o) => (
            <option key={o} value={o}>
              {o === 'مخصص' && values[customKey] ? `${t('مخصص')} (${values[customKey]} ${t('يوم')})` : t(o)}
            </option>
          ))}
        </select>
        {current === 'مخصص' && (
          <input
            inputMode="numeric"
            dir="ltr"
            value={values[customKey] ?? ''}
            placeholder={t('عدد الأيام قبل الانتهاء')}
            onChange={(e) => set(customKey, e.target.value.replace(/[^0-9]/g, ''))}
            className={inputClass}
          />
        )}
      </label>
    )
  }

  const reviewRows = (d: VehicleDraft): [string, string][] => {
    const skip = new Set<string>([EQ.vehicleClass, EQ.vehicleType, EQ.model, EQ.otherDocs])
    const rows: [string, string][] = [['تصنيف المركبة', vehicleClass]]
    if (vehicleType) rows.push(['نوع المركبة', vehicleType])
    rows.push(['الاسم', d.name])
    if (d.model) rows.push(['الموديل', d.model])
    if (d.serial) rows.push([marine ? 'رقم الهيكل (HIN)' : 'رقم الشاصي / الرقم التسلسلي', d.serial])
    for (const [k, v] of Object.entries(d.meta)) {
      if (skip.has(k) || !v.trim()) continue
      rows.push([k, /[\\/]/.test(v) && /\.[A-Za-z0-9]{2,5}$/.test(v) ? v.split(/[\\/]/).pop()! : v])
    }
    for (const [n, c] of Object.entries(d.annexes)) rows.push(['إكسسوار', `${n} × ${c}`])
    if (otherDocs.length) rows.push(['مستندات أخرى', String(otherDocs.length)])
    return rows
  }

  const title = editing ? (marine ? 'تعديل المركبة البحرية' : 'تعديل المركبة البرية') : marine ? 'إضافة مركبة بحرية' : 'إضافة مركبة برية'

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t(title)}</p>
      <p className="mt-1 rounded-inner bg-surface px-3 py-2 text-[12.5px] font-bold text-sub">
        {t(vehicleClass)}
        {vehicleType ? ` › ${t(vehicleType)}` : ''}
      </p>

      {review ? (
        <div className="mt-4">
          <p className="text-[14px] font-extrabold text-title">{t(editing ? 'مراجعة تعديل المركبة' : 'مراجعة المركبة قبل الإضافة')}</p>
          <div className="mt-2 flex flex-col gap-1 rounded-inner bg-surface p-3">
            {reviewRows(review).map(([k, v], i) => (
              <div key={`${k}-${i}`} className="flex justify-between gap-3 text-[12.5px]">
                <span className="text-sub">{t(k)}</span>
                <span dir="auto" className="text-end font-bold text-ink">
                  {t(v)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] font-bold text-title">{t(editing ? 'هل أنت متأكد من حفظ التعديل بهذه البيانات؟' : 'هل أنت متأكد من إضافة المركبة بهذه البيانات؟')}</p>
          {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{tr(error)}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={busy} onClick={() => setReview(null)} className="h-12 flex-1 rounded-field border border-line text-[14px] font-extrabold text-ink">
              {t('رجوع')}
            </button>
            <button type="button" disabled={busy} onClick={save} className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t(editing ? 'نعم، احفظ التعديل' : 'نعم، أضف المركبة')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {text(marine ? 'اسم المركبة البحرية' : road ? 'اسم المركبة' : 'اسم المعدة / الآلية', name, setName, {
              required: true,
              hint: marine ? 'اسم القارب / اليخت – رقمه' : road ? 'مثال: تويوتا لاندكروزر – رقم المركبة' : 'اسم المعدة – رقم المعدة – نوع المعدة',
            })}
            {text(marine ? 'الموديل / الطول / الشركة المصنّعة' : road ? 'الماركة / الموديل / سنة الصنع' : 'موديل المعدة / نوعها / حجمها', model, setModel)}
            {road && text('رقم اللوحة', values[EQ.plate] ?? '', (v) => set(EQ.plate, v))}
            {marine && (
              <>
                {text('رقم التسجيل البحري', values[EQ.registration] ?? '', (v) => set(EQ.registration, v), { wide: false })}
                {text('السعة (عدد الركاب)', values[EQ.capacity] ?? '', (v) => set(EQ.capacity, v), { wide: false, numeric: true })}
                {text('المرسى / الميناء', values[EQ.marina] ?? '', (v) => set(EQ.marina, v))}
              </>
            )}
            {text(marine ? 'رقم الهيكل (HIN)' : road ? 'رقم الشاصي (الهيكل)' : 'رقم الشاصي / الرقم التسلسلي', serial, setSerial)}
          </div>

          <p className="mt-5 mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
            <span className="h-4 w-1 rounded-full bg-gold" />
            {t('إكسسوارات المركبة')}
          </p>
          <div className="flex flex-col gap-2">
            {accessories.map((row, i) => (
              <div key={i} className="flex items-end gap-2">
                <label className="flex flex-[3] flex-col gap-1">
                  {label('نوع الإكسسوار')}
                  <input dir="auto" value={row.name} onChange={(e) => setAccessories((x) => x.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} className={inputClass} />
                </label>
                <label className="flex flex-[2] flex-col gap-1">
                  {label('العدد')}
                  <input inputMode="numeric" dir="ltr" value={row.count} onChange={(e) => setAccessories((x) => x.map((r, j) => (j === i ? { ...r, count: e.target.value } : r)))} className={inputClass} />
                </label>
                {accessories.length > 1 && (
                  <button type="button" aria-label={t('حذف')} onClick={() => setAccessories((x) => x.filter((_, j) => j !== i))} className="mb-3 text-danger">
                    <MinusCircle className="size-5" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setAccessories((x) => [...x, { name: '', count: '' }])} className="flex items-center gap-1 self-start text-[12.5px] font-extrabold text-brand">
              <Plus className="size-4" />
              {t('إضافة إكسسوار آخر')}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {text('رقم التواصل', values[EQ.contactPhone] ?? '', (v) => set(EQ.contactPhone, v), { required: true, numeric: true, wide: false })}
            {text('البريد الإلكتروني', values[EQ.contactEmail] ?? '', (v) => set(EQ.contactEmail, v), { required: true, wide: false })}
            {dateField(marine ? 'انتهاء رخصة الملاحة / الملكية' : road ? 'انتهاء الاستمارة / الملكية' : 'تاريخ انتهاء الملكية', EQ.ownershipEnd)}
            {lead(EQ.ownershipReminder, EQ.ownershipCustom)}
            {!equipment && (
              <>
                {dateField('تاريخ انتهاء التأمين', EQ.insuranceEnd)}
                {lead(EQ.insuranceReminder, EQ.insuranceCustom)}
              </>
            )}
            {dateField('تاريخ انتهاء الضمان (إن وجد)', EQ.warrantyEnd)}
            {lead(EQ.warrantyReminder, EQ.warrantyCustom)}
          </div>

          <div className="mt-5 flex flex-col gap-2">
            {otherDocs.map((doc, i) => (
              <span key={`${doc}-${i}`} className="flex h-11 items-center justify-between gap-2 rounded-field bg-field px-3 text-[12.5px] font-bold text-ink">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Paperclip className="size-4 shrink-0 text-brand" />
                  <span className="truncate" dir="auto">
                    {doc.split(/[\\/]/).pop()}
                  </span>
                </span>
                <button type="button" aria-label={t('إزالة')} onClick={() => setOtherDocs((x) => x.filter((_, j) => j !== i))} className="text-danger">
                  <X className="size-4" />
                </button>
              </span>
            ))}
            <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-field border border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft">
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
              {t('إرفاق مستندات أخرى')}
              <input
                type="file"
                className="hidden"
                accept="image/*,application/pdf"
                disabled={uploading}
                onChange={async (e) => {
                  const file = await namedFile(e.target.files?.[0])
                  e.target.value = ''
                  if (!file) return
                  setUploading(true)
                  setError('')
                  try {
                    const stored = await uploadDeviceFile(file)
                    setOtherDocs((x) => [...x, stored])
                  } catch (err) {
                    setError(err instanceof FileError ? err.message : 'تعذّر رفع الملف. حاول مرة أخرى.')
                  } finally {
                    setUploading(false)
                  }
                }}
              />
            </label>
          </div>

          {error && <p className="mt-3 whitespace-pre-line rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{tr(error)}</p>}
          <button type="button" disabled={uploading} onClick={submit} className="mt-5 flex w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50">
            {t(editing ? 'حفظ التعديل' : 'إضافة المركبة')}
          </button>
        </>
      )}
    </Sheet>
  )
}
