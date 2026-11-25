import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Printer, Calculator, Car, CheckSquare, Edit3, FileText, Landmark, Loader2, Pencil, Plus, Shield, Square, Trash2, User, Users, Wand2, X, ListChecks } from 'lucide-react'
import { cn } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { useCurrency, usePeopleAll, useStore, type Asset, type UnitContract } from '@/lib/data'
import { usePageContracts } from '@/lib/delegatedAssets'
import { ACTIVITY_UNIT_KEY, activityMetaFromLease, activityReminders, createActivityAsset, createBranchAsset, mergeActivityMeta } from '@/lib/activityWrite'
import { errorText, supabase } from '@/lib/supabase'
import { AssetError } from '@/lib/assetWrite'
import { VEHICLE_UNIT_KEY, setVehicleTenant, splitLogs } from '@/lib/vehicleWrite'
import { discardDraftContract } from '@/lib/leaseActions'
import { AREA_UNIT_KEY, INNER_FACILITIES_KEY, METER_FIELDS, setUnitStatus, setUnitsStatus, unitKey, type PropertyUnit } from '@/lib/propertyWrite'
import {
  ACTIVITY_REMINDERS,
  ACTIVITY_REQUIRED,
  DRIVER_KEY,
  DRIVER_OPTIONS,
  SUBJECT_VEHICLE,
  VEHICLE_CONTRACT_FIELDS,
  VEHICLE_REQUIRED,
  VEHICLE_TERMS_FIELDS,
  LEGAL_FORMS,
  LICENSE_CLASSES,
  PURPOSES,
  TERM_MODES,
  activityMissing,
  ADMIN_FEE_FIELDS,
  COLLECT_METHODS,
  CONTRACT_FIELDS,
  CONTRACT_REQUIRED,
  DEPOSIT_FIELDS,
  DISTRIBUTE_PERIODS,
  K,
  LESSOR_FIELDS,
  METER_GROUPS,
  PAYMENT_FIELDS,
  PROPERTY_FIELDS,
  REMINDER_CUSTOM,
  REP_FIELDS,
  SCOPE_PAYMENTS_ONLY,
  SCOPE_WITH_FEES,
  TENANT_FIELDS,
  UTILITY_PAYERS,
  adminFeeTaxOf,
  adminFeesTaxRate,
  adminFeesTaxable,
  cloneLease,
  contractNumber,
  contractNumbers,
  decodeLease,
  distribute,
  ensureRowIds,
  syncLeasePeople,
  fillPropertyFrom,
  includesAdminFees,
  isoDay,
  meterCountOf,
  meterLines,
  mergeMobileIntoPhone,
  migrateMeters,
  missingRequired,
  num,
  parseDay,
  paymentTaxOf,
  pretty,
  rentTaxable,
  rowProblem,
  saveUnitLease,
  sequenceTitle,
  shareText,
  signatureStrokes,
  syncChequeDue,
  syncDerived,
  syncEndDate,
  taxRate,
  totals,
  type FieldSpec,
  type Lease,
  type Row,
} from '@/lib/lease'
import { Confirm } from './Confirm'
import { ContractDocsBox } from './ContractDocs'
import { leasePrintTitle, useLeasePrint } from './LeasePrint'
import { Sheet } from './ui'

/*
  عقد إيجار الوحدة (LeaseContractFormScreen) بأقسامه: بيانات العقد، العقار،
  المؤجر، المستأجر، ممثل المستأجر، التأمين، دفعات الإيجار (بالضريبة والتوزيع
  التلقائي)، الرسوم الإدارية، الملخص المالي، والملاحظات. الحفظ: طريقة
  التوقيع ← مراجعة النص ← العقد والدفعات والتذكيرات والأفراد والجهات.
*/

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

type Scope = 'contract' | 'property' | 'lessor' | 'tenant' | 'rep' | 'license'
const storeOf = (l: Lease, scope: Scope): Row => (scope === 'rep' ? l.representative : (l[scope] as Row))

/** بيانات العقار والوحدة لعقد الإيجار (_leaseMeta). */
function leaseMetaOf(asset: Asset, unit: PropertyUnit): Row {
  const meta: Row = {}
  for (const [k, v] of Object.entries(splitLogs(asset.logs_json).meta)) if (v.trim()) meta[k] = v.trim()
  for (const key of ['نوع العين', 'رقم العقار', INNER_FACILITIES_KEY]) if ((unit.extras[key] ?? '').trim()) meta[key] = unit.extras[key]
  if (unit.area.trim()) {
    meta['مساحة العين'] = unit.area.trim()
    meta[AREA_UNIT_KEY] = unit.extras[AREA_UNIT_KEY] ?? 'م²'
  }
  for (const [countKey, numbersKey] of METER_FIELDS) {
    if ((unit.extras[countKey] ?? '').trim()) meta[countKey] = unit.extras[countKey]
    if ((unit.extras[numbersKey] ?? '').trim()) meta[numbersKey] = unit.extras[numbersKey]
  }
  return meta
}

/** expireId: عقد النشاط السابق يصبح «منتهيًا» بعد حفظ التجديد (_openActivityLease). */
export type Renewal = { notes: string | null; start: Date; end: Date; oldNo: string; expireId?: string }

/** vehicle: عقد تأجير المركبة (_openEquipContractForm) — بيانات المركبة مكان العقار وبلا ممثل، و«شروط التأجير». */
export type VehicleMode = { fields: string[]; values: Row; meta: Row; vehicleClass: string; template?: string }

type Mode = { multi?: { key: string; name: string }[]; activity?: { prefill?: string }; vehicle?: VehicleMode; document?: LeaseDocument }

/** عقد من «قوالب المستندات» (saveAsDocument): يُحفظ مستندًا لا عقد وحدة، وعملته تُختار له. */
export type LeaseDocument = { title: string; prefill: string; currencies: string[]; save: (lease: Lease, draft: boolean) => Promise<void> }
export const DOC_CURRENCY_KEY = 'العملة'

function initialLease(asset: Asset | undefined, unit: PropertyUnit | undefined, existing: UnitContract | undefined, renewal: Renewal | undefined, mode: Mode): Lease {
  const l = decodeLease(existing?.notes ?? renewal?.notes ?? mode.document?.prefill ?? mode.activity?.prefill ?? mode.vehicle?.template)
  // التجديد: نسخة من السابق بلا تواريخه ورقمه وتوقيعه ودفعاته ورسومه.
  if (!existing && renewal) {
    const oldNo = (l.contract[K.newNo] ?? '').trim()
    for (const key of [K.startDate, K.endDate, K.newNo, K.signedAt, K.signedBy]) delete l.contract[key]
    delete l.signature
    delete l.stamp
    if (oldNo) l.contract[K.oldNo] = oldNo
    l.payments = []
    l.adminFees = []
    for (const row of l.deposits) {
      if ((row[K.collectMethod] ?? '').trim() === 'شيك') {
        delete row[K.paymentChequeDate]
        delete row[K.paymentDue]
      }
    }
    l.contract[K.startDate] = isoDay(renewal.start)
    l.contract[K.endDate] = isoDay(renewal.end)
    if (renewal.oldNo.trim()) l.contract[K.oldNo] = renewal.oldNo.trim()
  }
  if (asset) {
    if (unit) fillPropertyFrom(l, leaseMetaOf(asset, unit))
    else if (mode.multi) {
      const meta: Row = {}
      for (const [k, v] of Object.entries(splitLogs(asset.logs_json).meta)) if (v.trim()) meta[k] = v.trim()
      fillPropertyFrom(l, meta)
    }
  }
  if (existing) {
    if (!(l.contract[K.value] ?? '') && Number(existing.annual_rent) > 0) l.contract[K.value] = Number(existing.annual_rent).toFixed(2)
    if (!(l.contract[K.startDate] ?? '') && existing.start_date) l.contract[K.startDate] = existing.start_date.slice(0, 10)
    if (!(l.contract[K.endDate] ?? '') && existing.end_date) l.contract[K.endDate] = existing.end_date.slice(0, 10)
    if (!(l.tenant[K.name] ?? '') && (existing.tenant_name ?? '')) l.tenant[K.name] = existing.tenant_name!
    if (!(l.tenant[K.phone] ?? '') && (existing.tenant_phone ?? '')) l.tenant[K.phone] = existing.tenant_phone!
  }
  if (mode.vehicle) {
    l.contract[K.subject] = SUBJECT_VEHICLE
    delete l.contract[K.purpose]
    fillPropertyFrom(l, mode.vehicle.values)
    return l
  }
  if (mode.activity) {
    // التذكيران «قبل شهر» افتراضيًا في العقد الجديد.
    if (!existing) for (const key of [K.leaseReminder, K.licenseReminder]) if (!(l.license[key] ?? '').trim()) l.license[key] = 'قبل شهر'
    return l
  }
  migrateMeters(l.property)
  if (mode.multi) {
    if (!existing) {
      if (!(l.contract[K.termMode] ?? '').trim()) l.contract[K.termMode] = 'سنوي'
      syncEndDate(l.contract)
    }
    return l
  }
  if (!unit) return l
  if (!(l.property['رقم العين'] ?? '')) l.property['رقم العين'] = unit.name
  if (!(l.property['بيانات العين المؤجرة'] ?? '').trim()) l.property['بيانات العين المؤجرة'] = unit.name
  return l
}

/**
  asset: العقار أو النشاط (بلا قيمة = نشاط تجاري جديد يُنشأ من رخصته).
  unit: الوحدة (لا في متعدد الوحدات ولا في النشاط).
*/
export function LeaseForm({
  asset,
  unit,
  propertyType,
  existing,
  renewal,
  multi,
  activity,
  vehicle,
  document: doc,
  onClose,
  onDone,
}: {
  asset?: Asset
  unit?: PropertyUnit
  propertyType: string
  existing?: UnitContract
  renewal?: Renewal
  multi?: { key: string; name: string }[]
  /** branch: «إضافة فرع» لنشاط رئيسي (_addBranch) — يُنشأ الفرع من رخصته عند الحفظ. */
  activity?: { classOptions: string[]; prefill?: string; branch?: { parent: Asset; count: number } }
  vehicle?: VehicleMode
  document?: LeaseDocument
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const contracts = usePageContracts()
  const store = useStore()
  const currency = useCurrency()
  const isMulti = !!multi && !existing
  const key = unit ? unitKey(unit) : activity ? ACTIVITY_UNIT_KEY : vehicle ? VEHICLE_UNIT_KEY : ''
  const unitName = unit?.name ?? ((activity || vehicle) && asset ? asset.title : '')
  const branch = !asset ? activity?.branch : undefined
  const propertyTitle = asset?.title ?? (branch ? `${t('فرع جديد لنشاط:')} ${branch.parent.title}` : 'نشاط تجاري جديد')
  const numbers = useMemo(() => contractNumbers((contracts.data ?? []).filter((c) => !!asset && c.asset_id === asset.id), key, existing), [contracts.data, asset, key, existing])
  const [lease, setLease] = useState<Lease>(() => initialLease(asset, unit, existing, renewal, { multi, activity, vehicle, document: doc }))
  const [chosen, setChosen] = useState<string[]>([])
  const chosenList = (multi ?? []).filter((u) => chosen.includes(u.key))
  const [lines, setLines] = useState<string[]>(() => {
    const list = (lease.license[K.activities] ?? '').split('\n').map((x) => x.trim()).filter(Boolean)
    while (list.length < 3) list.push('')
    return list
  })
  const tradeName = (lease.license[K.tradeName] ?? '').trim()
  const subjectName = unitName.trim() ? unitName : tradeName || propertyTitle
  // _fillContractNumbers: بعد تحميل العقود، مرة واحدة.
  const loaded = contracts.isSuccess
  useEffect(() => {
    if (!loaded || existing || doc) return
    setLease((prev) => {
      const next = cloneLease(prev)
      const current = (next.contract[K.newNo] ?? '').trim()
      if (!current || current.length > 6) next.contract[K.newNo] = numbers.next
      if (!(next.contract[K.oldNo] ?? '').trim() && numbers.previous) next.contract[K.oldNo] = numbers.previous
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])
  const oldLocked = (!!numbers.previous || !!renewal?.oldNo.trim()) && !!(lease.contract[K.oldNo] ?? '').trim()
  const update = (fn: (l: Lease) => void) =>
    setLease((prev) => {
      const next = cloneLease(prev)
      fn(next)
      return next
    })
  const [picker, setPicker] = useState<{ scope: Scope; nameKey: string } | null>(null)
  const [rowEdit, setRowEdit] = useState<{ list: 'deposits' | 'payments' | 'adminFees'; index: number | null } | null>(null)
  const [taxAsk, setTaxAsk] = useState<{ fees: boolean; then: () => void } | null>(null)
  const [distributing, setDistributing] = useState(false)
  const [signing, setSigning] = useState(false)
  const [review, setReview] = useState<{ draft: boolean } | null>(null)
  // طباعة العقد بكل إدخالاته على ورقة A4 (buildLeasePdf).
  const leasePrint = useLeasePrint()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // «إلغاء المسودة» (_discardDraft): للعقد المحفوظ مسودة إذا فُتح للإكمال.
  const openDraft = !!existing && existing.status === 'pending'
  const [discarding, setDiscarding] = useState(false)
  const [discardError, setDiscardError] = useState('')
  async function discardDraft() {
    if (!existing) return
    setBusy(true)
    setDiscardError('')
    try {
      const keys = await discardDraftContract(existing)
      if (!activity && !vehicle) await setUnitsStatus(existing.asset_id, keys, 'شاغرة').catch(() => {})
      await Promise.all(['assets', 'unit-contracts', 'unit-payments'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      setDiscarding(false)
      onDone('أُلغيت المسودة')
    } catch (e) {
      setDiscardError(`${t('تعذّر إلغاء المسودة. حاول مرة أخرى.')} ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }
  // نشاط أُنشئ ثم تعذّر حفظ عقده: لا يُنشأ مرة ثانية.
  const [createdId, setCreatedId] = useState('')
  const tot = totals(lease)

  /* ---------- الحقول ---------- */
  const fieldInput = (scope: Scope, spec: FieldSpec) => {
    const s = storeOf(lease, scope)
    const required = vehicle
      ? (VEHICLE_REQUIRED[scope] ?? []).includes(spec.key) || (scope !== 'property' && (CONTRACT_REQUIRED[scope] ?? []).includes(spec.key))
      : ((activity ? ACTIVITY_REQUIRED : CONTRACT_REQUIRED)[scope] ?? []).includes(spec.key)
    const label = (
      <span className="text-[12px] font-bold text-sub">
        {t(spec.label)}
        {required && <span className="text-danger"> *</span>}
      </span>
    )
    const set = (value: string) =>
      update((l) => {
        const st = storeOf(l, scope)
        st[spec.key] = value
        if (scope === 'contract' && (spec.key === K.termMode || spec.key === K.startDate)) syncEndDate(st)
      })
    if (spec.options) {
      return (
        <label className="flex flex-col gap-1">
          {label}
          <select value={spec.options.includes(s[spec.key] ?? '') ? s[spec.key] : ''} onChange={(e) => set(e.target.value)} className={inputClass}>
            <option value="">—</option>
            {spec.options.map((o) => (
              <option key={o} value={o}>
                {t(o)}
              </option>
            ))}
          </select>
        </label>
      )
    }
    if (spec.time) {
      return (
        <label className="flex flex-col gap-1">
          {label}
          <input type="time" value={s[spec.key] ?? ''} onChange={(e) => set(e.target.value)} className={inputClass} />
        </label>
      )
    }
    if (spec.date) {
      const raw = (s[spec.key] ?? '').slice(0, 10)
      return (
        <label className="flex flex-col gap-1">
          {label}
          <span className="relative">
            <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''} onChange={(e) => set(e.target.value)} className={inputClass} />
            {raw && (
              <button type="button" aria-label={t('مسح')} onClick={() => update((l) => void delete storeOf(l, scope)[spec.key])} className="absolute top-1/2 left-9 -translate-y-1/2 text-muted hover:text-danger">
                <X className="size-4" />
              </button>
            )}
          </span>
        </label>
      )
    }
    const locked = oldLocked && scope === 'contract' && spec.key === K.oldNo
    return (
      <label className="flex flex-col gap-1">
        {label}
        {spec.multiline ? (
          <textarea dir="auto" rows={3} value={s[spec.key] ?? ''} onChange={(e) => set(e.target.value)} className={cn(inputClass, 'h-auto min-h-20 py-2.5')} />
        ) : (
          <input dir="auto" readOnly={locked} inputMode={spec.numeric ? 'decimal' : undefined} value={s[spec.key] ?? ''} onChange={(e) => set(e.target.value)} className={cn(inputClass, locked && 'bg-[#E6ECEA]')} />
        )}
      </label>
    )
  }

  /** عدد العدادات وتحته لكل عداد رقمه وعلى من. */
  const meterBlock = (spec: FieldSpec) => {
    const [numbersKey, payersKey, numberLabel] = METER_GROUPS[spec.key]
    const s = lease.property
    const count = meterCountOf(s, spec.key)
    const nums = meterLines(s[numbersKey], count)
    const payers = meterLines(s[payersKey], count)
    return (
      <div className="col-span-2 rounded-inner bg-surface p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t(spec.label)}</span>
          <input
            inputMode="numeric"
            value={s[spec.key] ?? ''}
            onChange={(e) =>
              update((l) => {
                const value = e.target.value.replace(/[^0-9]/g, '')
                l.property[spec.key] = value
                const n = meterCountOf(l.property, spec.key)
                l.property[numbersKey] = meterLines(l.property[numbersKey], n).join('\n')
                l.property[payersKey] = meterLines(l.property[payersKey], n).join('\n')
              })
            }
            className={inputClass}
          />
        </label>
        {nums.map((value, i) => (
          <div key={i} className="mt-2 grid grid-cols-2 gap-2">
            <input
              dir="auto"
              value={value}
              placeholder={`${t(numberLabel)}${count > 1 ? ` ${i + 1}` : ''}`}
              onChange={(e) =>
                update((l) => {
                  const lines = meterLines(l.property[numbersKey], meterCountOf(l.property, spec.key))
                  lines[i] = e.target.value
                  l.property[numbersKey] = lines.join('\n')
                })
              }
              className={inputClass}
            />
            <select
              value={UTILITY_PAYERS.includes(payers[i]) ? payers[i] : ''}
              onChange={(e) =>
                update((l) => {
                  const lines = meterLines(l.property[payersKey], meterCountOf(l.property, spec.key))
                  lines[i] = e.target.value
                  l.property[payersKey] = lines.join('\n')
                })
              }
              className={inputClass}
            >
              <option value="">{t('على من')}</option>
              {UTILITY_PAYERS.map((o) => (
                <option key={o} value={o}>
                  {t(o)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    )
  }

  /** التذكير: مدد ثابتة أو مخصص — لا يظهر في العقد. */
  const reminderField = (key: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">{t('التذكير')}</span>
      <select value={ACTIVITY_REMINDERS.includes(lease.license[key] ?? '') ? lease.license[key] : ''} onChange={(e) => update((l) => void (l.license[key] = e.target.value))} className={inputClass}>
        <option value="">—</option>
        {ACTIVITY_REMINDERS.map((o) => (
          <option key={o} value={o}>
            {t(o)}
          </option>
        ))}
      </select>
      <span className="text-[10.5px] font-semibold text-muted">{t('لا يظهر في العقد')}</span>
    </label>
  )

  const card = (title: string, Icon: typeof User, body: ReactNode, action?: ReactNode) => (
    <div className="mb-3 rounded-card border border-line bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-[18px] w-1 rounded-full bg-gold" />
        <Icon className="size-4 text-brand" />
        <p className="min-w-0 flex-1 text-[14.5px] font-extrabold text-title">{t(title)}</p>
        {action}
      </div>
      {body}
    </div>
  )

  const section = (title: string, Icon: typeof User, scope: Scope, fields: FieldSpec[], nameKey?: string) =>
    card(
      title,
      Icon,
      <div className="grid grid-cols-2 gap-2.5">
        {fields.map((spec) =>
          scope === 'property' && METER_GROUPS[spec.key] ? (
            <div key={spec.key} className="col-span-2">
              {meterBlock(spec)}
            </div>
          ) : (
            <div key={spec.key} className={spec.multiline || spec.key === K.name || spec.key === K.lessorCapacity || spec.key === K.repName ? 'col-span-2' : ''}>
              {fieldInput(scope, spec)}
            </div>
          ),
        )}
      </div>,
      nameKey ? (
        <button type="button" onClick={() => setPicker({ scope, nameKey })} className="flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1.5 text-[11.5px] font-extrabold text-brand">
          <Users className="size-3.5" />
          {t('جلب من الأفراد')}
        </button>
      ) : undefined,
    )

  /* ---------- الضريبة ---------- */
  const taxBox = (fees: boolean) => {
    const enabled = fees ? adminFeesTaxable(lease) : rentTaxable(lease)
    const rateKey = fees ? K.adminFeesTaxRate : K.taxRate
    return (
      <div className="mb-3 flex items-center gap-3 rounded-inner bg-surface px-3 py-2">
        <span className="text-[13px] font-extrabold text-title">{t('الضريبة')}</span>
        {enabled && (
          <span className="flex items-center gap-1">
            <input inputMode="decimal" value={lease.contract[rateKey] ?? ''} placeholder="0" onChange={(e) => update((l) => void (l.contract[rateKey] = e.target.value))} className="h-9 w-20 rounded-field border border-line bg-white px-2 text-center text-[13px] font-bold outline-none focus:border-gold" />
            <span className="text-[12px] font-bold text-sub">%</span>
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('الضريبة')}
          onClick={() => update((l) => void (l.contract[fees ? K.adminFeesTaxable : K.rentTaxable] = enabled ? 'لا' : 'نعم'))}
          className={cn('relative h-6 w-11 rounded-full transition', enabled ? 'bg-brand' : 'bg-line')}
        >
          <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', enabled ? 'start-[22px]' : 'start-0.5')} />
        </button>
      </div>
    )
  }

  /** _taxGate: نسبة غير مكتوبة مع ضريبة مفعّلة، ثم تأكيد. */
  const withTaxGate = (fees: boolean, then: () => void) => {
    const enabled = fees ? adminFeesTaxable(lease) : rentTaxable(lease)
    const rate = fees ? adminFeesTaxRate(lease) : taxRate(lease)
    setError('')
    if (enabled && rate <= 0) return setError(`${t('اكتب نسبة الضريبة في مستطيل')} ${t(fees ? 'مبالغ رسوم إدارية' : 'مبالغ دفعات الإيجار')} ${t('أولًا')}`)
    setTaxAsk({ fees, then })
  }

  const money = (v: number) => v.toFixed(2)
  const line = (label: string, value: number, strong = false) => (
    <div className={cn('flex justify-between gap-2 text-[12.5px]', strong ? 'font-extrabold text-title' : 'font-bold text-sub')}>
      <span>{t(label)}</span>
      <span dir="ltr">{money(value)}</span>
    </div>
  )
  const netAndGross = (net: number, tax: number) => (
    <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
      {line('الإجمالي بدون ضريبة', net, tax <= 0)}
      {tax > 0 && (
        <>
          {line('الضريبة', tax)}
          {line('الإجمالي بضريبة', net + tax, true)}
        </>
      )}
    </div>
  )

  const rowsCard = (o: {
    title: string
    Icon: typeof User
    list: 'deposits' | 'payments' | 'adminFees'
    addLabel: string
    lines: (row: Row) => string[]
    header?: ReactNode
    footer?: ReactNode
    headerAction?: ReactNode
    taxGate?: boolean
  }) => {
    const rows = lease[o.list]
    return card(
      o.title,
      o.Icon,
      <div>
        {o.header}
        {rows.length === 0 && <p className="mb-2 text-[12px] text-muted">{t('لا توجد بيانات حالياً')}</p>}
        {rows.map((row, i) => (
          <div key={i} className="mb-2 flex items-start gap-2 rounded-inner bg-surface px-3 py-2">
            <div className="min-w-0 flex-1">
              {o.lines(row).map((text, j) => (
                <p key={j} dir="auto" className={j === 0 ? 'text-[13px] font-extrabold text-title' : 'text-[11.5px] font-semibold text-sub'}>
                  {text}
                </p>
              ))}
            </div>
            <button type="button" aria-label={t('تعديل')} onClick={() => setRowEdit({ list: o.list, index: i })} className="text-brand">
              <Pencil className="size-4" />
            </button>
            <button type="button" aria-label={t('حذف')} onClick={() => update((l) => void l[o.list].splice(i, 1))} className="text-danger">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => (o.taxGate === undefined ? setRowEdit({ list: o.list, index: null }) : withTaxGate(o.taxGate, () => setRowEdit({ list: o.list, index: null })))}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-field border border-dashed border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft"
        >
          <Plus className="size-4" />
          {t(o.addLabel)}
        </button>
        {o.footer}
      </div>,
      o.headerAction,
    )
  }

  /* ---------- الحفظ ---------- */
  function startSave(asDraft: boolean) {
    setError('')
    const start = parseDay(lease.contract[K.startDate])
    const end = parseDay(lease.contract[K.endDate])
    if (start && end && end.getTime() < start.getTime()) return setError('تاريخ نهاية العقد قبل تاريخ بدايته — صحّحه أولًا')
    if (isMulti && chosen.length < 2) return setError('اختر وحدتين على الأقل في «اختر الوحدات المشمولة»')
    if (activity && !asset && !doc && !tradeName) return setError('اكتب الاسم التجاري في «بيانات الرخصة»')
    const probe = cloneLease(lease)
    if (activity) {
      probe.license[K.activities] = lines.map((x) => x.trim()).filter(Boolean).join('\n')
      if (!(probe.tenant[K.name] ?? '').trim() && tradeName) probe.tenant[K.name] = tradeName
      if (!asDraft) {
        const missing = activityMissing(probe)
        if (missing.length) return setError(`${t('أكمل الحقول الإلزامية:')} ${missing.join('، ')}`)
      }
    }
    if (isMulti) {
      const names = chosenList.map((u) => u.name).join('، ')
      probe.contract[K.multiUnits] = names
      if (!(probe.property['بيانات العين المؤجرة'] ?? '').trim()) probe.property['بيانات العين المؤجرة'] = names
    }
    syncDerived(probe)
    setLease(probe)
    if (asDraft) {
      update((l) => {
        delete l.contract[K.signedAt]
        delete l.contract[K.signedBy]
        delete l.signature
        delete l.stamp
      })
      setReview({ draft: true })
    } else setSigning(true)
  }

  function marked(sign: boolean, stamp: boolean) {
    setSigning(false)
    update((l) => {
      if (sign || stamp) {
        const now = new Date()
        l.contract[K.signedAt] = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`
        l.contract[K.signedBy] = [sign && 'توقيع', stamp && 'ختم'].filter(Boolean).join(' و')
        // التوقيع والختم المختاران داخل العقد نفسه: يصل موقَّعًا لمن يُشارَك معه.
        const d = store.data ?? {}
        const strokes = sign ? signatureStrokes(d['user_signature_strokes_v1']) : []
        const stampImage = stamp && typeof d['user_stamp_image_v1'] === 'string' ? (d['user_stamp_image_v1'] as string) : ''
        if (strokes.length) l.signature = JSON.stringify(strokes)
        else delete l.signature
        if (stampImage) l.stamp = stampImage
        else delete l.stamp
      } else {
        delete l.contract[K.signedAt]
        delete l.contract[K.signedBy]
        delete l.signature
        delete l.stamp
      }
    })
    setReview({ draft: false })
  }

  async function save(markedDraft: boolean) {
    setBusy(true)
    setError('')
    try {
      const draft = missingRequired(lease).length > 0 || markedDraft
      const l = cloneLease(lease)
      if (doc) {
        ensureRowIds(l)
        await doc.save(l, draft)
        await syncLeasePeople(l, doc.title).catch(() => {})
        await qc.invalidateQueries({ queryKey: ['people'] })
        onDone(draft ? 'حُفظت المسودة — افتحها من «النماذج المحفوظة» لإكمالها' : 'تم حفظ العقد')
        return
      }
      let assetId = asset?.id ?? createdId
      let createdTitle = ''
      if (!assetId && activity) {
        const created = branch ? await createBranchAsset(l, branch.parent, branch.count) : await createActivityAsset(l, currency)
        assetId = created.id
        createdTitle = created.title
        setCreatedId(created.id)
      }
      const { saved, paymentsIssue } = await saveUnitLease({
        lease: l,
        draft,
        assetId: assetId!,
        unitKey: key,
        unitName: activity ? subjectName : unitName,
        propertyTitle,
        existing,
        multi: isMulti ? chosenList : undefined,
        peopleSource: activity ? `عقد إيجار النشاط — ${subjectName}` : undefined,
      })
      if (renewal?.expireId && renewal.expireId !== saved.id) {
        await supabase.from('property_unit_contracts').update({ status: 'expired' }).eq('id', renewal.expireId)
      }
      if (activity) {
        const leaseMeta = activityMetaFromLease(l)
        await activityReminders(assetId!, createdTitle || asset?.title || subjectName, leaseMeta)
        if (asset) await mergeActivityMeta(asset.id, leaseMeta).catch(() => {})
      } else if (vehicle) {
        // المستأجر على المركبة نفسها كما في التطبيق.
        await setVehicleTenant(assetId!, (saved.tenant_name ?? '').trim()).catch(() => {})
      } else if (isMulti) {
        await setUnitsStatus(assetId!, chosenList.map((u) => u.key), saved.status === 'pending' ? 'مسودة' : 'مؤجرة').catch(() => {})
      } else await setUnitStatus(assetId!, key, saved.status === 'pending' ? 'مسودة' : 'مؤجرة').catch(() => {})
      await Promise.all(['assets', 'unit-contracts', 'unit-payments', 'store'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      const missing = missingRequired(l)
      const base = draft
        ? missing.length
          ? `${t('حُفظ العقد كمسودة — ينقصه:')} ${missing.map((m) => t(m)).join('، ')}`
          : t('حُفظ العقد كمسودة.')
        : renewal
          ? `${t('تم تجديد العقد بنجاح — رقم العقد الجديد')} ${contractNumber(saved)} (${t('السابق')} ${renewal.oldNo})`
          : branch
            ? `${t('تم إنشاء الفرع:')} ${createdTitle || tradeName}`
            : activity && !asset
              ? t('تمت إضافة النشاط التجاري وعقد الإيجار')
            : t('تم حفظ العقد')
      onDone(paymentsIssue ? `${base}\n${t('حُفظ العقد، وتعذّر توليد الدفعات الآن')} (${paymentsIssue})` : base)
    } catch (e) {
      setReview(null)
      setError(e instanceof AssetError ? e.message : `${t('تعذّر حفظ العقد:')} ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const title = doc ? doc.title : renewal ? 'تجديد العقد' : vehicle ? `${t('عقد تأجير')} ${t(vehicle.vehicleClass)}` : multi && !existing ? 'عقد متعدد الوحدات' : branch ? 'عقد إيجار الفرع' : activity ? 'عقد إيجار النشاط' : 'عقد الإيجار'
  const printTitle = activity ? title : leasePrintTitle(lease, false, title)
  const vehicleMeta = vehicle?.meta
  const payDue = (row: Row) => {
    const cheque = (row[K.collectMethod] ?? '') === 'شيك' ? (row[K.paymentChequeDate] ?? '').trim() : ''
    const due = cheque || (row[K.paymentDue] ?? '').trim()
    return `${t('تاريخ الاستحقاق:')} ${due ? pretty(due) : t('غير محدد')}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-deep/40 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" className="flex h-[96vh] w-full flex-col overflow-hidden rounded-t-card bg-page shadow-2xl sm:h-[92vh] sm:max-w-3xl sm:rounded-card">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-3">
          <p className="min-w-0 flex-1 text-[17px] font-extrabold text-title">{t(title)}</p>
          <button type="button" onClick={() => leasePrint.open({ lease, title: printTitle, activity: !!activity, assetMeta: vehicleMeta, assetId: asset?.id })} aria-label={t('طباعة العقد')} title={t('طباعة العقد')} className="grid size-9 place-items-center rounded-full bg-surface text-brand">
            <Printer className="size-4" />
          </button>
          {leasePrint.ui}
          <button type="button" onClick={onClose} aria-label={t('إغلاق')} className="grid size-9 place-items-center rounded-full bg-surface text-body">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {doc ? (
            <div className="mb-3 rounded-card border border-line bg-white p-4">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-bold text-sub">{t('العملة')}</span>
                <select value={lease.contract[DOC_CURRENCY_KEY] ?? ''} onChange={(e) => update((l) => void (l.contract[DOC_CURRENCY_KEY] = e.target.value))} className={inputClass}>
                  <option value="">—</option>
                  {doc.currencies.map((c) => (
                    <option key={c} value={c}>
                      {t(c)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
          <div className="mb-3 flex items-center gap-3 rounded-card border border-line bg-white p-4">
            <FileText className="size-6 text-brand" />
            <div className="min-w-0">
              <p dir="auto" className="text-[14px] font-extrabold text-title">
                {[propertyType && t(propertyType), propertyTitle].filter(Boolean).join(' / ')}
              </p>
              {isMulti ? (
                <p dir="auto" className="text-[12.5px] font-bold text-sub">
                  {chosenList.length ? `${t('الوحدات:')} ${chosenList.map((u) => u.name).join('، ')}` : t('عقد متعدد الوحدات')}
                </p>
              ) : unit ? (
                <p dir="auto" className="text-[12.5px] font-bold text-sub">
                  {unit.type ? `${t(unit.type)} / ${unit.name}` : `${t('الوحدة')}: ${unit.name}`}
                </p>
              ) : activity && unitName ? (
                <p dir="auto" className="text-[12.5px] font-bold text-sub">
                  {t('النشاط')}: {unitName}
                </p>
              ) : vehicle && unitName ? (
                <p dir="auto" className="text-[12.5px] font-bold text-sub">
                  {t('المركبة')}: {unitName}
                </p>
              ) : null}
            </div>
          </div>
          )}
          {isMulti &&
            card(
              'اختر الوحدات المشمولة بالعقد *',
              Landmark,
              <div>
                <div className="flex flex-wrap gap-2">
                  {multi!.map((u) => {
                    const on = chosen.includes(u.key)
                    return (
                      <button key={u.key} type="button" onClick={() => setChosen((x) => (on ? x.filter((k) => k !== u.key) : [...x, u.key]))} className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-extrabold', on ? 'border-brand bg-brand/15 text-brand' : 'border-line text-ink')}>
                        <span dir="auto">{u.name}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-[11.5px] font-semibold leading-relaxed text-muted">{t('اختر وحدتين على الأقل. الدفعات والتأمين تُسجَّل على أول وحدة مختارة، والإيجار السنوي يُوزَّع على الوحدات بالتساوي.')}</p>
              </div>,
              <span className="text-[13px] font-extrabold text-brand">{chosen.length}</span>,
            )}
          {activity ? (
            <>
              {card(
                'بيانات عقد الإيجار',
                FileText,
                <div className="grid grid-cols-2 gap-2.5">
                  {fieldInput('contract', { key: K.newNo, label: 'رقم العقد الجديد' })}
                  {fieldInput('contract', { key: K.oldNo, label: 'رقم العقد المنتهي' })}
                  {fieldInput('contract', { key: K.termMode, label: 'نمط مدة الإيجار', options: TERM_MODES })}
                  {fieldInput('contract', { key: K.purpose, label: 'الغرض من الإيجار', options: PURPOSES })}
                  {fieldInput('contract', { key: K.startDate, label: 'تاريخ بداية العقد', date: true })}
                  {fieldInput('contract', { key: K.endDate, label: 'تاريخ نهاية العقد', date: true })}
                  {reminderField(K.leaseReminder)}
                  {(lease.license[K.leaseReminder] ?? '') === 'مخصص' ? fieldInput('license', { key: K.leaseReminderDays, label: 'عدد الأيام قبل الانتهاء', numeric: true }) : <span />}
                </div>,
              )}
              {card(
                'بيانات الرخصة',
                Shield,
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="col-span-2">{fieldInput('license', { key: K.tradeName, label: 'الاسم التجاري' })}</div>
                  <div className="col-span-2">{fieldInput('license', { key: K.activityLocation, label: 'موقع النشاط' })}</div>
                  {fieldInput('license', { key: K.activityClass, label: 'تصنيف النشاط', options: [...activity.classOptions, ...((lease.license[K.activityClass] ?? '') && !activity.classOptions.includes(lease.license[K.activityClass]) ? [lease.license[K.activityClass]] : [])] })}
                  {fieldInput('license', { key: K.legalForm, label: 'الشكل القانوني', options: LEGAL_FORMS })}
                  {fieldInput('license', { key: K.licenseNo, label: 'رقم الرخصة التجارية' })}
                  {fieldInput('license', { key: K.licenseIssue, label: 'تاريخ الإصدار', date: true })}
                  {fieldInput('license', { key: K.licenseEnd, label: 'تاريخ الانتهاء', date: true })}
                  {reminderField(K.licenseReminder)}
                  {(lease.license[K.licenseReminder] ?? '') === 'مخصص' && (
                    <>
                      <span />
                      {fieldInput('license', { key: K.licenseReminderDays, label: 'عدد الأيام قبل الانتهاء', numeric: true })}
                    </>
                  )}
                  {fieldInput('license', { key: K.chamber, label: 'عضوية الغرفة' })}
                  {fieldInput('license', { key: K.licenseClass, label: 'فئة الرخصة', options: LICENSE_CLASSES })}
                  <div className="col-span-2 flex flex-col gap-1">
                    <span className="text-[12px] font-bold text-sub">{t('الأنشطة التجارية')}</span>
                    <div className="flex flex-col gap-1.5 rounded-inner bg-surface p-2">
                      {lines.map((value, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-5 text-[12px] font-extrabold text-muted">{i + 1}.</span>
                          <input dir="auto" value={value} onChange={(e) => setLines((x) => x.map((v, j) => (j === i ? e.target.value : v)))} className="h-10 flex-1 rounded-field bg-white px-3 text-[13px] font-bold text-title outline-none focus:ring-1 focus:ring-gold" />
                        </div>
                      ))}
                      <button type="button" onClick={() => setLines((x) => [...x, ''])} className="flex items-center gap-1 self-start text-[12px] font-extrabold text-brand">
                        <Plus className="size-4" />
                        {t('المزيد')}
                      </button>
                    </div>
                  </div>
                  {fieldInput('license', { key: K.capital, label: 'رأس المال', numeric: true })}
                </div>,
              )}
            </>
          ) : vehicle ? (
            <>
              {card(
                'بيانات عقد الإيجار',
                FileText,
                <div className="grid grid-cols-2 gap-2.5">
                  {VEHICLE_CONTRACT_FIELDS.map((spec) => (
                    <div key={spec.key} className={spec.key === K.termMode ? 'col-span-2' : ''}>
                      {fieldInput('contract', spec)}
                    </div>
                  ))}
                </div>,
                // بسائق أو بدون سائق بجانب العنوان (_driverPicker).
                <select
                  aria-label={t('بسائق أو بدون سائق')}
                  value={lease.contract[DRIVER_KEY] ?? ''}
                  onChange={(e) => update((l) => void (l.contract[DRIVER_KEY] = e.target.value))}
                  className={cn('h-8 rounded-full border px-2 text-[11.5px] font-extrabold outline-none', (lease.contract[DRIVER_KEY] ?? '') ? 'border-brand bg-brand-soft text-brand' : 'border-danger text-danger')}
                >
                  <option value="">{t('بسائق أو بدون سائق')} *</option>
                  {DRIVER_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </select>,
              )}
              {section('بيانات المركبة', Car, 'property', vehicle.fields.map((k) => ({ key: k, label: k })))}
            </>
          ) : (
            <>
              {section('بيانات عقد الإيجار', FileText, 'contract', CONTRACT_FIELDS)}
              {section('بيانات العقار', Landmark, 'property', PROPERTY_FIELDS.map((f) => (f.key === 'مساحة العين' && (lease.property[K.areaUnit] ?? '').trim() && lease.property[K.areaUnit] !== 'م²' ? { ...f, label: `مساحة العين (${lease.property[K.areaUnit]})` } : f)))}
            </>
          )}
          {section('بيانات المؤجر', Landmark, 'lessor', LESSOR_FIELDS, K.name)}
          {section('بيانات المستأجر', User, 'tenant', TENANT_FIELDS, K.name)}
          {!activity && !vehicle && section('بيانات ممثل المستأجر', User, 'rep', REP_FIELDS, K.repName)}
          {vehicle && section('شروط التأجير', ListChecks, 'contract', VEHICLE_TERMS_FIELDS)}
          {/* مستندات العقار/المركبة (شروطك مثلًا) تُختار وتُرفق بالعقد. */}
          {asset && (
            <ContractDocsBox
              assetId={asset.id}
              label={vehicle ? (vehicle.vehicleClass === 'مركبات بحرية' ? 'مستندات المركبة البحرية' : 'مستندات المركبة البرية') : 'مستندات العقار'}
              value={lease.contract[K.attachedDocs] ?? ''}
              onChange={(v) =>
                update((l) => {
                  if (v.trim()) l.contract[K.attachedDocs] = v
                  else delete l.contract[K.attachedDocs]
                })
              }
            />
          )}
          {rowsCard({
            title: 'قيمة التأمين على العين',
            Icon: Shield,
            list: 'deposits',
            addLabel: 'تسجيل تأمين',
            lines: (row) => {
              const receipt = row['رقم الإيصال'] ?? ''
              const first = `${row[K.depositAmount] ?? '0'} · ${t(row[K.collectMethod] ?? '')}`
              if ((row[K.collectMethod] ?? '') === 'شيك') {
                const no = (row[K.paymentCheque] ?? '').trim()
                const date = (row[K.paymentChequeDate] ?? '').trim()
                return [first, [no && `${t('شيك رقم')} ${no}`, date ? `${t('تاريخ الشيك:')} ${pretty(date)}` : t('بلا تاريخ'), receipt && `${t('إيصال رقم')} ${receipt}`].filter(Boolean).join(' · ')]
              }
              const date = row['تاريخ تحصيل التأمين'] ?? ''
              return [first, `${t('تاريخ التحصيل:')} ${date ? pretty(date) : t('غير محدد')}${receipt ? ` · ${t('إيصال رقم')} ${receipt}` : ''}`]
            },
            footer: (
              <>
                <div className="mt-2">{line('مجموع التأمين', tot.depositsTotal, true)}</div>
                <p className="mt-1 text-[11px] font-semibold leading-relaxed text-muted">{t('مبلغ مُحتجز يُرد عند انتهاء العقد بعد خصم ما يستحق — لا ضريبة عليه ولا يدخل في قيمة العقد.')}</p>
              </>
            ),
          })}
          {rowsCard({
            title: 'مبالغ دفعات الإيجار *',
            Icon: Landmark,
            list: 'payments',
            addLabel: 'تسجيل دفعة',
            taxGate: false,
            headerAction: (
              <button type="button" onClick={() => withTaxGate(false, () => setDistributing(true))} className="flex items-center gap-1 text-[12px] font-extrabold text-brand">
                <Wand2 className="size-4" />
                {t('توزيع تلقائي')}
              </button>
            ),
            header: (
              <div className="mb-3">
                {taxBox(false)}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-inner bg-surface px-3 py-2">
                    <p className="text-[11px] font-bold text-muted">{t('قيمة عقد الإيجار')}</p>
                    <p className="text-[14px] font-extrabold text-title">{money(tot.paymentsTotal)}</p>
                  </div>
                  <div className="rounded-inner bg-surface px-3 py-2">
                    <p className="text-[11px] font-bold text-muted">{t('عدد الدفعات')}</p>
                    <p className="text-[14px] font-extrabold text-title">{lease.payments.length}</p>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] font-semibold text-muted">{t('القيمة والعدد يُحسبان تلقائيًا من الدفعات التي تسجّلها.')}</p>
              </div>
            ),
            lines: (row) => {
              const amount = num(row[K.paymentAmount])
              const tax = paymentTaxOf(lease, row)
              return [(row[K.paymentFee] ?? '').trim() || t('دفعة'), `${t('المبلغ')} ${amount.toFixed(2)} + ${t('الضريبة')} ${tax.toFixed(2)} = ${t('الإجمالي')} ${(amount + tax).toFixed(2)}`, payDue(row)]
            },
            footer: (
              <>
                {netAndGross(tot.paymentsTotal, tot.paymentsTax)}
                <textarea dir="auto" rows={1} placeholder={t('ملاحظات')} value={lease.contract[K.paymentsNote] ?? ''} onChange={(e) => update((l) => void (l.contract[K.paymentsNote] = e.target.value))} className={cn(inputClass, 'mt-2 h-auto min-h-11 py-2.5')} />
              </>
            ),
          })}
          {rowsCard({
            title: 'مبالغ رسوم إدارية',
            Icon: Edit3,
            list: 'adminFees',
            addLabel: 'تسجيل رسم إداري',
            taxGate: true,
            header: taxBox(true),
            lines: (row) => {
              const tax = adminFeeTaxOf(lease, row)
              const due = row[K.adminFeeDue] ?? ''
              const method = row[K.collectMethod] ?? ''
              const who = row['على من'] ?? ''
              const receipt = row['رقم الإيصال'] ?? ''
              return [
                `${t(row[K.adminFeeType] ?? 'رسم')} · ${row[K.adminFeeAmount] ?? '0'}${tax > 0 ? ` + ${t('ضريبة')} ${tax.toFixed(2)}` : ''}`,
                `${t('الاستحقاق:')} ${due ? pretty(due) : t('غير محدد')}${method ? ` · ${t(method)}` : ''}${who ? ` · ${t('يتحمّلها')} ${t(who)}` : ''}${receipt ? ` · ${t('إيصال')} ${receipt}` : ''}`,
              ]
            },
            footer: (
              <>
                {netAndGross(tot.adminFeesTotal, tot.adminFeesTax)}
                <p className="mt-1 text-[11px] font-semibold leading-relaxed text-muted">{t('تُدفع مرة واحدة عند التوقيع، وخارج قيمة الإيجار — لأن الإيجار مبلغ متكرر يُقسَّط، والرسم حدث واحد لا يتكرر.')}</p>
              </>
            ),
          })}
          {card(
            'الملخص المالي للعقد *',
            Calculator,
            <div>
              <p className="mb-2 text-[12.5px] font-extrabold text-title">{t('محتوى العقد *')}</p>
              <div className="mb-3 grid grid-cols-2 gap-2">
                {[SCOPE_PAYMENTS_ONLY, SCOPE_WITH_FEES].map((option) => {
                  const selected = (lease.contract[K.contractScope] ?? '').trim() === option
                  return (
                    <button key={option} type="button" onClick={() => update((l) => void (l.contract[K.contractScope] = option))} className={cn('rounded-inner border px-3 py-2.5 text-start text-[12px] font-extrabold', selected ? 'border-brand bg-brand/5 text-brand' : 'border-line text-ink')}>
                      {t(option)}
                    </button>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['الدفعات الإيجارية', tot.paymentsTotal, tot.paymentsTax, 'قيمة الدفعات'],
                  ...(includesAdminFees(lease) ? [['الرسوم الإدارية', tot.adminFeesTotal, tot.adminFeesTax, 'قيمة الرسوم']] : []),
                ].map(([label, net, tax, netLabel]) => (
                  <div key={String(label)} className="flex flex-col gap-1 rounded-inner bg-surface p-3 text-center">
                    <p className="text-[12px] font-extrabold text-brand">{t(String(label))}</p>
                    <p className="text-[11px] text-muted">{t(String(netLabel))}</p>
                    <p className="text-[13px] font-bold">{money(Number(net))}</p>
                    <p className="text-[11px] text-muted">{t('قيمة الضريبة')}</p>
                    <p className="text-[13px] font-bold">{money(Number(tax))}</p>
                    <p className="text-[11px] text-muted">{t('الإجمالي')}</p>
                    <p className="text-[14px] font-extrabold text-title">{money(Number(net) + Number(tax))}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-1">
                {line('إجمالي المبلغ', tot.gross, true)}
                {tot.depositsTotal > 0 && line('التأمين (مسترد، خارج الإجمالي)', tot.depositsTotal)}
              </div>
            </div>,
          )}
          <div className="mb-3 rounded-card border border-line bg-white p-4">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-sub">{t('ملاحظات على العقد')}</span>
              <textarea dir="auto" rows={3} value={lease.note} onChange={(e) => update((l) => void (l.note = e.target.value))} className={cn(inputClass, 'h-auto min-h-20 py-2.5')} />
            </label>
          </div>
        </div>
        <div className="border-t border-line bg-white px-4 py-3">
          {error && <p className="mb-2 whitespace-pre-line rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
          <div className="flex gap-2">
            {openDraft && (
              <button type="button" disabled={busy} onClick={() => (setDiscardError(''), setDiscarding(true))} className="h-12 flex-1 rounded-field border border-danger text-[14px] font-extrabold text-danger disabled:opacity-60">
                {t('إلغاء المسودة')}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => startSave(true)} className="h-12 flex-1 rounded-field border border-gold text-[14px] font-extrabold text-gold-dark disabled:opacity-60">
              {t('حفظ كمسودة')}
            </button>
            <button type="button" disabled={busy} onClick={() => startSave(false)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t(busy ? 'جارٍ الحفظ...' : renewal ? 'تجديد العقد' : activity ? 'حفظ عقد النشاط' : 'حفظ العقد')}
            </button>
          </div>
        </div>
      </div>

      {picker && (
        <DirectoryPicker
          onClose={() => setPicker(null)}
          onPick={(name, details) => {
            const { scope, nameKey } = picker
            setPicker(null)
            update((l) => {
              const st = storeOf(l, scope)
              st[nameKey] = name
              for (const [k, v] of Object.entries(details)) if (String(v ?? '').trim()) st[k] = String(v).trim()
              if (scope === 'lessor' || scope === 'tenant') mergeMobileIntoPhone(st)
            })
          }}
        />
      )}
      {rowEdit && (
        <RowEditor
          list={rowEdit.list}
          initial={rowEdit.index === null ? undefined : lease[rowEdit.list][rowEdit.index]}
          number={rowEdit.index === null ? lease[rowEdit.list].length + 1 : rowEdit.index + 1}
          onClose={() => setRowEdit(null)}
          onSave={(row, another) => {
            const { list, index } = rowEdit
            update((l) => {
              if (index === null) l[list].push(row)
              else l[list][index] = row
            })
            setRowEdit(another ? { list, index: null } : null)
          }}
        />
      )}
      <Confirm
        open={discarding}
        title="إلغاء المسودة"
        message={t('ستُحذف هذه المسودة وما فيها من دفعات، وتعود الوحدة شاغرة. لا يمكن التراجع. هل تريد إلغاء المسودة؟')}
        confirmLabel="إلغاء المسودة"
        danger
        busy={busy}
        error={discardError}
        onConfirm={discardDraft}
        onCancel={() => setDiscarding(false)}
      />
      {taxAsk && (
        <Confirm
          open
          title="تأكيد الضريبة"
          message={
            (taxAsk.fees ? adminFeesTaxable(lease) : rentTaxable(lease))
              ? `${t('سيُسجَّل البند بضريبة')} ${(() => {
                  const r = taxAsk.fees ? adminFeesTaxRate(lease) : taxRate(lease)
                  return r.toFixed(r % 1 === 0 ? 0 : 2)
                })()}%. ${t('هل تريد المتابعة؟')}`
              : t('الضريبة غير مفعّلة، فسيُسجَّل البند بلا ضريبة. إن أردت ضريبة فعّل خيار الضريبة في أعلى المستطيل.')
          }
          confirmLabel="متابعة"
          onCancel={() => setTaxAsk(null)}
          onConfirm={() => {
            const then = taxAsk.then
            setTaxAsk(null)
            then()
          }}
        />
      )}
      {distributing && (
        <DistributeSheet
          startDate={lease.contract[K.startDate] ?? ''}
          total={lease.contract[K.value] ?? ''}
          existing={lease.payments.length}
          onClose={() => setDistributing(false)}
          onDone={(rows) => {
            setDistributing(false)
            update((l) => void l.payments.splice(0, l.payments.length, ...rows))
          }}
        />
      )}
      {signing && <SignatureChoice store={store.data ?? {}} onClose={() => setSigning(false)} onPick={marked} />}
      {review && (
        <Sheet open onClose={() => (busy ? undefined : setReview(null))}>
          <p className="text-[17px] font-extrabold text-title">{t('مراجعة العقد قبل الحفظ')}</p>
          {lease.payments.length > 0 && (
            <div className="mt-3 rounded-inner bg-brand-soft p-3">
              <p className="text-[12.5px] font-extrabold text-brand">
                {t('الدفعات الإيجارية')} ({lease.payments.length})
              </p>
              {lease.payments.map((row, i) => (
                <p key={i} dir="auto" className="text-[12px] leading-relaxed text-ink">
                  {[row[K.paymentFee] || t('دفعة'), row[K.paymentAmount] || '0', (row[K.paymentDue] ?? '') && pretty(row[K.paymentDue]), (row[K.collectMethod] ?? '') && t(row[K.collectMethod])].filter(Boolean).join(' · ')}
                </p>
              ))}
            </div>
          )}
          {(missingRequired(lease).length > 0 || review.draft) && (
            <p className="mt-3 rounded-inner bg-gold/10 px-3 py-2 text-[12px] font-bold leading-relaxed text-gold-dark">
              {missingRequired(lease).length ? `${t('سيُحفظ العقد كمسودة لوجود حقول إلزامية لم تُعبّأ:')} ${missingRequired(lease).map((m) => t(m)).join('، ')}.` : t('سيُحفظ العقد كمسودة كما اخترت.')}
            </p>
          )}
          <pre dir="auto" className="mt-3 max-h-[42vh] overflow-y-auto whitespace-pre-wrap rounded-inner border border-line bg-white p-3 font-[inherit] text-[12px] leading-relaxed text-ink">
            {shareText(lease)}
          </pre>
          {error && <p className="mt-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => setReview(null)} className="h-12 flex-1 rounded-field border border-line text-[13px] font-extrabold text-ink">
              {t('رجوع للتعديل')}
            </button>
            {(missingRequired(lease).length > 0 || review.draft) && (
              <button type="button" disabled={busy} onClick={() => save(true)} className="flex h-12 flex-1 items-center justify-center gap-1 rounded-field border border-gold text-[13px] font-extrabold text-gold-dark">
                {busy && <Loader2 className="size-4 animate-spin" />}
                {t('احفظ كمسودة')}
              </button>
            )}
            <button
              type="button"
              disabled={busy || missingRequired(lease).length > 0 || review.draft}
              onClick={() => save(false)}
              className="flex h-12 flex-1 items-center justify-center gap-1 rounded-field bg-brand text-[13px] font-extrabold text-white disabled:bg-[#D5DBDA] disabled:text-[#8C9A97]"
            >
              {busy && !review.draft && <Loader2 className="size-4 animate-spin" />}
              {t('تأكيد الحفظ')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

/** _pickFromDirectory: من الأفراد والجهات بالاسم أو التصنيف. */
function DirectoryPicker({ onClose, onPick }: { onClose: () => void; onPick: (name: string, details: Record<string, string>) => void }) {
  const { t } = useI18n()
  const people = usePeopleAll()
  const [query, setQuery] = useState('')
  const all = people.data ?? []
  const q = query.trim()
  const list = all.filter((p) => !q || p.fullName.includes(q) || String((p as { categoryName?: string }).categoryName ?? '').includes(q))
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t('اختر من الأفراد والجهات')}</p>
      {people.isSuccess && !all.length ? (
        <p className="mt-3 text-[13px] text-muted">{t('لا يوجد أفراد أو جهات مسجّلة بعد')}</p>
      ) : (
        <>
          <input dir="auto" value={query} placeholder={t('ابحث بالاسم أو التصنيف')} onChange={(e) => setQuery(e.target.value)} className={cn(inputClass, 'mt-3')} />
          <div className="mt-2 flex max-h-80 flex-col divide-y divide-line overflow-y-auto">
            {list.map((p, i) => {
              const details = (p.details ?? {}) as Record<string, string>
              const phone = String(details['رقم الجوال'] ?? '').trim() || String(details['رقم الهاتف'] ?? '').trim()
              const category = String((p as { categoryName?: string }).categoryName ?? '')
              return (
                <button key={`${p.fullName}-${i}`} type="button" onClick={() => onPick(p.fullName, details)} className="flex flex-col items-start px-1 py-2.5 text-start hover:bg-surface">
                  <span dir="auto" className="text-[13.5px] font-extrabold text-title">
                    {p.fullName}
                  </span>
                  <span className="text-[11.5px] text-muted">{phone ? `${t(category)} · ${phone}` : t(category)}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </Sheet>
  )
}

/** _editRow: سطر تأمين أو دفعة أو رسم. */
export function RowEditor({ list, initial, number, onClose, onSave }: { list: 'deposits' | 'payments' | 'adminFees'; initial?: Row; number: number; onClose: () => void; onSave: (row: Row, another: boolean) => void }) {
  const { t } = useI18n()
  const fields = list === 'deposits' ? DEPOSIT_FIELDS : list === 'payments' ? PAYMENT_FIELDS : ADMIN_FEE_FIELDS
  const addLabel = list === 'deposits' ? 'تسجيل تأمين' : list === 'payments' ? 'تسجيل دفعة' : 'تسجيل رسم إداري'
  const [row, setRow] = useState<Row>(() => ({ ...(initial ?? {}) }))
  const [error, setError] = useState('')
  const seq = sequenceTitle(addLabel, number)
  const method = row[K.collectMethod] ?? ''
  const shown = fields.filter((f) => (!f.chequeOnly || method === 'شيك') && (!f.hideForCheque || method !== 'شيك') && (!f.customReminderOnly || (row[K.paymentReminder] ?? '') === REMINDER_CUSTOM))
  const set = (k: string, v: string) => setRow((r) => ({ ...r, [k]: v }))
  const submit = (another: boolean) => {
    const next: Row = {}
    for (const [k, v] of Object.entries(row)) next[k] = fields.some((f) => f.key === k) && !fields.find((f) => f.key === k)?.options && !fields.find((f) => f.key === k)?.date ? v.trim() : v
    syncChequeDue(next)
    const problem = rowProblem(fields, next)
    if (problem) return setError(problem)
    if (K.paymentAmount in next || list === 'payments') if (!(next[K.paymentStatus] ?? '').trim()) next[K.paymentStatus] = 'مستحقة'
    onSave(next, another)
  }
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{initial ? t(addLabel) : t(seq.title)}</p>
      {!initial && seq.note && <p className="mt-1 text-[12px] font-bold text-brand">{t(seq.note)}</p>}
      <div className="mt-3 flex flex-col gap-2.5">
        {shown.map((f) => {
          const label = f.key === K.collectMethod && list === 'deposits' ? `${t(f.label)} *` : t(f.label)
          return (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-sub">{label}</span>
              {f.options ? (
                <select value={f.options.includes(row[f.key] ?? '') ? row[f.key] : ''} onChange={(e) => set(f.key, e.target.value)} className={inputClass}>
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </select>
              ) : f.date ? (
                <input type="date" value={(row[f.key] ?? '').slice(0, 10)} onChange={(e) => set(f.key, e.target.value)} className={inputClass} />
              ) : f.multiline ? (
                <textarea dir="auto" rows={3} value={row[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} className={cn(inputClass, 'h-auto min-h-20 py-2.5')} />
              ) : (
                <input dir="auto" inputMode={f.numeric ? 'decimal' : undefined} value={row[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} className={inputClass} />
              )}
            </label>
          )
        })}
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      {list === 'payments' && (
        <button type="button" onClick={() => submit(true)} className="mt-4 h-12 w-full rounded-field border border-brand text-[13.5px] font-extrabold text-brand">
          {t('حفظ وإضافة دفعة أخرى')}
        </button>
      )}
      <button type="button" onClick={() => submit(false)} className="mt-2 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
        {t('حفظ')}
      </button>
    </Sheet>
  )
}

/** _autoDistributePayments */
function DistributeSheet({ startDate, total: initialTotal, existing, onClose, onDone }: { startDate: string; total: string; existing: number; onClose: () => void; onDone: (rows: Row[]) => void }) {
  const { t } = useI18n()
  const [total, setTotal] = useState(initialTotal)
  const [count, setCount] = useState('12')
  const [period, setPeriod] = useState('شهري')
  const [method, setMethod] = useState('كاش')
  const [first, setFirst] = useState(() => (parseDay(startDate) ? startDate.slice(0, 10) : isoDay(new Date())))
  const [error, setError] = useState('')
  const sum = num(total)
  const n = parseInt(count.trim(), 10) || 0
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t('توزيع الدفعات تلقائيًا')}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-sub">{t('اكتب الإجمالي وعدد الدفعات، ويوزّعها النظام بالتساوي على التواريخ. بعدها راجعها وعدّل أيّ دفعة كما تريد.')}</p>
      <div className="mt-3 flex flex-col gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('إجمالي مبلغ الإيجار')}</span>
          <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('عدد الدفعات')}</span>
            <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('كل دفعة')}</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass}>
              {Object.keys(DISTRIBUTE_PERIODS).map((o) => (
                <option key={o} value={o}>
                  {t(o)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('تاريخ أول دفعة')}</span>
          <input type="date" value={first} onChange={(e) => e.target.value && setFirst(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('طريقة التحصيل')}</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {COLLECT_METHODS.map((o) => (
              <option key={o} value={o}>
                {t(o)}
              </option>
            ))}
          </select>
        </label>
        {n > 0 && sum > 0 && (
          <p className="text-[12.5px] font-extrabold text-brand">
            {n} {t('دفعات')} × {(sum / n).toFixed(2)} — {t(period === 'شهري' ? 'كل شهر' : period)}
          </p>
        )}
        {existing > 0 && (
          <p className="text-[12px] font-bold text-gold-dark">
            {t('تنبيه: سيحلّ التوزيع محلّ الدفعات المسجلة')} ({existing}).
          </p>
        )}
        {error && <p className="rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <button
          type="button"
          onClick={() => {
            if (sum <= 0) return setError('اكتب إجمالي المبلغ.')
            if (n < 1 || n > 120) return setError('عدد الدفعات من 1 إلى 120.')
            onDone(distribute(sum, n, period, parseDay(first) ?? new Date(), method))
          }}
          className="h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark"
        >
          {t('توزيع الدفعات')}
        </button>
      </div>
    </Sheet>
  )
}

/** _askSignature: التوقيع والختم المحفوظان في «المزيد» (من بيانات المستخدم). */
function SignatureChoice({ store, onClose, onPick }: { store: Record<string, unknown>; onClose: () => void; onPick: (sign: boolean, stamp: boolean) => void }) {
  const { t } = useI18n()
  const strokes = signatureStrokes(store['user_signature_strokes_v1'])
  const stampRaw = typeof store['user_stamp_image_v1'] === 'string' ? (store['user_stamp_image_v1'] as string) : ''
  const hasSign = strokes.length > 0
  const hasStamp = !!stampRaw
  const [sign, setSign] = useState(hasSign)
  const [stamp, setStamp] = useState(hasStamp)
  const [none, setNone] = useState(!hasSign && !hasStamp)
  const chosen = sign || stamp || none
  const option = (title: string, value: boolean, enabled: boolean, onChange: (v: boolean) => void, note?: string) => (
    <button type="button" disabled={!enabled} onClick={() => onChange(!value)} className={cn('flex items-center gap-2 rounded-inner border px-3 py-3 text-start text-[13px] font-extrabold', value ? 'border-brand text-brand' : 'border-line text-ink', !enabled && 'opacity-50')}>
      {value ? <CheckSquare className="size-5" /> : <Square className="size-5 text-muted" />}
      {t(title)}
      {note && <span className="text-[11px] font-semibold text-muted">({t(note)})</span>}
    </button>
  )
  const xs = strokes.flat().map((p) => p[0])
  const ys = strokes.flat().map((p) => p[1])
  const box = hasSign ? [Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) - Math.min(...xs) + 8, Math.max(...ys) - Math.min(...ys) + 8] : [0, 0, 1, 1]
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t('كيف تريد حفظ العقد؟')}</p>
      <div className="mt-3 flex flex-col gap-2">
        {option('بتوقيع إلكتروني', sign, hasSign, (v) => (setSign(v), v && setNone(false)), hasSign ? undefined : 'غير مسجَّل في المزيد')}
        {option('بختم إلكتروني', stamp, hasStamp, (v) => (setStamp(v), v && setNone(false)), hasStamp ? undefined : 'غير مسجَّل في المزيد')}
        {option('بدون توقيع ولا ختم', none, true, (v) => (setNone(v), v && (setSign(false), setStamp(false))))}
      </div>
      {((sign && hasSign) || (stamp && hasStamp)) && (
        <div className="mt-3 flex h-[100px] gap-2 rounded-inner border border-line bg-white p-2">
          {sign && hasSign && (
            <svg viewBox={box.join(' ')} className="h-full flex-1" preserveAspectRatio="xMidYMid meet">
              {strokes.map((s, i) => (
                <polyline key={i} points={s.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#0F1F1C" strokeWidth={Math.max(box[2], box[3]) / 80} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>
          )}
          {stamp && hasStamp && <img src={`data:image/png;base64,${stampRaw}`} alt={t('بختم إلكتروني')} className="h-full flex-1 object-contain" />}
        </div>
      )}
      <button type="button" disabled={!chosen} onClick={() => onPick(sign, stamp)} className="mt-4 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50">
        {t('متابعة')}
      </button>
    </Sheet>
  )
}

/** طباعة نص العقد على A4 (أو حفظه PDF من المتصفح). */
export function printText(title: string, text: string) {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  doc.open()
  doc.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:16mm}body{font-family:Cairo,Tahoma,sans-serif;font-size:12.5px;line-height:1.9;color:#0F1F1C;white-space:pre-wrap}</style></head><body>${esc(text)}</body></html>`)
  doc.close()
  window.setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(() => frame.remove(), 1000)
  }, 300)
}
