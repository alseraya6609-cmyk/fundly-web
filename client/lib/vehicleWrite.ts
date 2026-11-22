import { supabase } from './supabase'
import type { Asset, UnitContract } from './data'
import { changeReminders, isoOf, reminderDays, type Reminder } from './reminders'
import { AssetError } from './assetWrite'

/*
  المركبات ووسائل النقل (projects_activities_screen.dart ← _openAddEquipment،
  _AddEquipmentScreen، _equipmentItemFrom، _editEquipment،
  _syncEquipmentReminders): التصنيف (برية / بحرية) ثم النوع، ثم نموذج
  بياناتها. البيانات كلها في سطر ##meta## داخل logs_json، والإكسسوارات في
  annexes، وتذكيرات الملكية والتأمين والضمان في تذكيرات الانتهاء بمعرّف
  'equip-<hashCode اسم المركبة في Dart>-<نوع التذكير>' كما يكتبها التطبيق.
*/

export const VEHICLE_LAND = 'مركبات برية'
export const VEHICLE_MARINE = 'مركبات بحرية'
export const VEHICLES_TITLE = 'المركبات ووسائل النقل'

export const VEHICLE_TYPES: Record<string, string[]> = {
  [VEHICLE_LAND]: ['سيارة صغيرة', 'دفع رباعي', 'بيك أب', 'حافلة', 'شاحنة', 'دراجة نارية', 'معدات خفيفة', 'معدات متوسطة', 'معدات ثقيلة', 'أخرى'],
  [VEHICLE_MARINE]: ['قارب', 'طراد', 'يخت', 'جت سكي', 'قارب صيد', 'عبّارة / سفينة', 'أخرى'],
}

/** _EquipKeys */
export const EQ = {
  vehicleClass: 'تصنيف المركبة',
  vehicleType: 'نوع المركبة',
  model: 'الموديل',
  plate: 'رقم اللوحة',
  registration: 'رقم التسجيل البحري',
  insuranceEnd: 'تاريخ انتهاء التأمين',
  insuranceReminder: 'تذكير التأمين',
  insuranceCustom: 'أيام تذكير التأمين',
  marina: 'المرسى / الميناء',
  capacity: 'السعة',
  ownershipEnd: 'تاريخ انتهاء الملكية',
  ownershipReminder: 'تذكير انتهاء الملكية',
  ownershipCustom: 'أيام تذكير الملكية',
  warrantyEnd: 'تاريخ الضمان',
  warrantyReminder: 'تذكير الضمان',
  warrantyCustom: 'أيام تذكير الضمان',
  condition: 'حالة المعدة',
  operation: 'طريقة التشغيل',
  monthReminder: 'تذكير نهاية الشهر',
  monthCustom: 'أيام تذكير نهاية الشهر',
  company: 'اسم الشركة',
  projectLocation: 'موقع المشروع',
  contactPhone: 'رقم التواصل',
  contactEmail: 'البريد الإلكتروني',
  projectStart: 'بدء المشروع',
  safetyCertEnd: 'انتهاء شهادة السلامة',
  warrantyCertEnd: 'انتهاء شهادة الضمان',
  operatorCertEnd: 'انتهاء شهادة المشغل',
  otherDocs: 'مستندات أخرى',
  operatorCertReminder: 'تذكير شهادة المشغل',
  safetyCertReminder: 'تذكير شهادة السلامة',
} as const

/** _equipReminderOptions */
export const EQUIP_LEADS = ['قبل يوم', 'قبل 3 أيام', 'قبل أسبوع', 'قبل شهر', 'مخصص']

export const META_PREFIX = '##meta##'
const UNSET = 'غير محدد'
const MODULE = 'المركبات ووسائل النقل'

export type VehicleDraft = {
  name: string
  /** «الموديل / النوع» (equipmentType). */
  model: string
  serial: string
  meta: Record<string, string>
  annexes: Record<string, number>
}

export const isMarine = (vehicleClass: string) => vehicleClass === VEHICLE_MARINE
/** معدات (خفيفة/متوسطة/ثقيلة) أو سجل قديم بلا نوع. */
export const isEquipment = (vehicleClass: string, type: string) => !isMarine(vehicleClass) && (type === '' || type.startsWith('معدات'))
export const isRoadVehicle = (vehicleClass: string, type: string) => !isMarine(vehicleClass) && !isEquipment(vehicleClass, type)

/** String.hashCode في Dart VM (StringHasher: Jenkins لكل وحدة UTF-16 ثم 30 بت). */
export function dartStringHash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h + text.charCodeAt(i)) >>> 0
    h = (h + (h << 10)) >>> 0
    h = (h ^ (h >>> 6)) >>> 0
  }
  h = (h + (h << 3)) >>> 0
  h = (h ^ (h >>> 11)) >>> 0
  h = (h + (h << 15)) >>> 0
  h = h & ((1 << 30) - 1)
  return h === 0 ? 1 : h
}

/** يوم/شهر/سنة كما يحفظها نموذج المركبة (بلا أصفار). */
export const displayDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : ''
}
/** يوم/شهر/سنة ← سنة-شهر-يوم لحقل التاريخ. */
export const inputDate = (display: string) => {
  const iso = isoOf(display)
  return iso ? iso.slice(0, 10) : ''
}

/** _equipReminderDays */
const leadDays = (option: string, custom: string) => (option === 'مخصص' ? parseInt(custom.trim(), 10) || 0 : reminderDays(option))

const dartIso = (d: Date) => {
  const two = (n: number) => String(n).padStart(2, '0')
  const ms = d.getMilliseconds()
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(ms).padStart(3, '0')}`
}

/** _syncEquipmentReminders: يعيد ما يُحدَّث وما يُزال. */
export function vehicleReminders(name: string, meta: Record<string, string>): { upserts: Reminder[]; removes: string[] } {
  const base = `equip-${dartStringHash(name)}`
  const upserts: Reminder[] = []
  const removes: string[] = []
  const one = (id: string, title: string, expiry: string | null, days: number) => {
    if (!expiry) removes.push(`${base}-${id}`)
    else upserts.push({ id: `${base}-${id}`, title: `${name} — ${title}`, module: MODULE, expiryDate: expiry, remindBeforeDays: days })
  }
  const dateOf = (key: string) => isoOf(meta[key] ?? '')
  one('owner', 'انتهاء الملكية', dateOf(EQ.ownershipEnd), leadDays(meta[EQ.ownershipReminder] ?? '', meta[EQ.ownershipCustom] ?? ''))
  one('warranty', 'انتهاء الضمان', dateOf(EQ.warrantyEnd), leadDays(meta[EQ.warrantyReminder] ?? '', meta[EQ.warrantyCustom] ?? ''))
  one('insurance', 'انتهاء التأمين', dateOf(EQ.insuranceEnd), leadDays(meta[EQ.insuranceReminder] ?? '', meta[EQ.insuranceCustom] ?? ''))
  const certDays = (key: string) => {
    const value = meta[key] ?? ''
    return value === '' ? 30 : leadDays(value, '')
  }
  const certDate = (endKey: string, reminderKey: string) => (meta[reminderKey] === 'بلا تذكير' ? null : dateOf(endKey))
  one('safety', 'شهادة السلامة', certDate(EQ.safetyCertEnd, EQ.safetyCertReminder), certDays(EQ.safetyCertReminder))
  one('operator', 'شهادة المشغل', certDate(EQ.operatorCertEnd, EQ.operatorCertReminder), certDays(EQ.operatorCertReminder))
  one('wcert', 'شهادة الضمان', dateOf(EQ.warrantyCertEnd), 30)
  let monthEnd: string | null = null
  if ((meta[EQ.operation] ?? '') === 'شهري') {
    const startIso = dateOf(EQ.projectStart)
    const start = startIso ? new Date(Number(startIso.slice(0, 4)), Number(startIso.slice(5, 7)) - 1, Number(startIso.slice(8, 10))) : new Date()
    const today = new Date()
    let next = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds())
    while (!(next.getTime() > today.getTime())) next = new Date(next.getFullYear(), next.getMonth() + 1, next.getDate(), next.getHours(), next.getMinutes(), next.getSeconds(), next.getMilliseconds())
    monthEnd = dartIso(next)
  }
  one('month', 'نهاية شهر التشغيل', monthEnd, leadDays(meta[EQ.monthReminder] ?? '', meta[EQ.monthCustom] ?? ''))
  return { upserts, removes }
}

/** سطر ##meta## من logs_json وبقية الأسطر. */
export function splitLogs(raw: string | null | undefined): { meta: Record<string, string>; logs: string[] } {
  let list: unknown[] = []
  try {
    const decoded = JSON.parse(String(raw ?? '[]'))
    if (Array.isArray(decoded)) list = decoded
  } catch {
    list = []
  }
  let meta: Record<string, string> = {}
  const logs: string[] = []
  for (const line of list) {
    const text = String(line)
    if (text.startsWith(META_PREFIX)) {
      try {
        const map = JSON.parse(text.slice(META_PREFIX.length))
        if (map && typeof map === 'object' && !Object.keys(meta).length) meta = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, String(v ?? '')]))
      } catch {
        // سطر تالف يُسقط كما يفعل _stripPropertyMeta.
      }
      continue
    }
    logs.push(text)
  }
  return { meta, logs }
}

/** _logsWithPropertyMeta */
export const joinLogs = (meta: Record<string, string>, logs: string[]) =>
  JSON.stringify(Object.keys(meta).length ? [`${META_PREFIX}${JSON.stringify(meta)}`, ...logs] : logs)

/** _assetToRecord: تاريخ يوم/شهر/سنة ← سنة-شهر-يوم، وغير المفهوم null. */
export const endDateColumn = (display: string) => {
  const iso = isoOf(display)
  return iso ? iso.slice(0, 10) : null
}

export function annexesOf(asset: Asset): Record<string, number> {
  const raw = asset.annexes
  if (!raw || typeof raw !== 'object') return {}
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.trunc(Number(v) || 0)]))
}

/** بيانات المركبة الحالية لنموذج التعديل (_editEquipment). */
export function vehicleDraftOf(asset: Asset): VehicleDraft {
  const { meta } = splitLogs(asset.logs_json)
  return { name: asset.title, model: meta[EQ.model] ?? asset.sub_type, serial: asset.serial_number ?? '', meta, annexes: annexesOf(asset) }
}

export const vehicleClassOf = (asset: Asset) => splitLogs(asset.logs_json).meta[EQ.vehicleClass] || VEHICLE_LAND
export const vehicleTypeOf = (asset: Asset) => splitLogs(asset.logs_json).meta[EQ.vehicleType] ?? ''

/** _submit: الاسم ورقم التواصل والبريد إلزامية. */
export function validateVehicle(name: string, values: Record<string, string>): string | null {
  if (!name.trim()) return 'أدخل اسم المركبة'
  const missing = [!(values[EQ.contactPhone] ?? '').trim() && 'رقم التواصل', !(values[EQ.contactEmail] ?? '').trim() && 'البريد الإلكتروني'].filter(Boolean)
  return missing.length ? `أكمل: ${missing.join('، ')}` : null
}

/** الحقول الظاهرة في النموذج لهذا النوع (مفاتيح _c التي تُكتب ولو فارغة). */
export function formKeys(vehicleClass: string, type: string): string[] {
  const keys: string[] = []
  if (isRoadVehicle(vehicleClass, type)) keys.push(EQ.plate)
  if (isMarine(vehicleClass)) keys.push(EQ.registration, EQ.capacity, EQ.marina)
  keys.push(EQ.contactPhone, EQ.contactEmail, EQ.ownershipEnd, EQ.ownershipCustom)
  if (!isEquipment(vehicleClass, type)) keys.push(EQ.insuranceEnd, EQ.insuranceCustom)
  keys.push(EQ.warrantyEnd, EQ.warrantyCustom)
  return keys
}

/** meta النهائية كما يبنيها _submit. */
export function buildVehicleMeta(args: {
  initial: Record<string, string>
  vehicleClass: string
  vehicleType: string
  model: string
  values: Record<string, string>
  choices: Record<string, string>
  otherDocs: string[]
}): Record<string, string> {
  const { initial, vehicleClass, vehicleType, model, values, choices, otherDocs } = args
  const pick = (key: string, fallback: string) => choices[key] ?? ((initial[key] ?? '') === '' ? fallback : initial[key])
  const meta: Record<string, string> = { ...initial }
  for (const key of formKeys(vehicleClass, vehicleType)) meta[key] = (values[key] ?? '').trim()
  meta[EQ.ownershipReminder] = pick(EQ.ownershipReminder, 'قبل شهر')
  meta[EQ.warrantyReminder] = pick(EQ.warrantyReminder, 'قبل شهر')
  if (!isEquipment(vehicleClass, vehicleType)) meta[EQ.insuranceReminder] = pick(EQ.insuranceReminder, 'قبل شهر')
  meta[EQ.vehicleClass] = vehicleClass
  meta[EQ.vehicleType] = vehicleType
  meta[EQ.model] = model.trim()
  meta[EQ.otherDocs] = otherDocs.join('\n')
  for (const key of Object.keys(meta)) if (meta[key] === '') delete meta[key]
  return meta
}

/** الإكسسوارات: النوع ← العدد (الأسطر الفارغة تُترك، وأقل عدد 1). */
export function buildAnnexes(rows: { name: string; count: string }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    const count = parseInt(row.count.trim(), 10)
    const n = Number.isNaN(count) ? 1 : count
    out[name] = (out[name] ?? 0) + (n < 1 ? 1 : n)
  }
  return out
}

/** يكتب الصف، وكلما رفض الخادم عمودًا غير موجود استبعده وأعاد (_writeWithColumnFallback). */
export async function withColumnFallback<T>(payload: Record<string, unknown>, write: (body: Record<string, unknown>) => PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  let body = { ...payload }
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await write(body)
    if (!error) return data
    const message = String((error as { message?: string }).message ?? '')
    const column = /column ['"]?([a-z_]+)['"]? (?:of relation|does not exist)|find the '([a-z_]+)' column/i.exec(message)
    const name = column?.[1] ?? column?.[2]
    if (!name || !(name in body)) throw error
    delete body[name]
    body = { ...body }
  }
  throw new AssetError('تعذّر حفظ السجل بعد استبعاد الأعمدة المرفوضة.')
}

export async function uid() {
  const { data } = await supabase.auth.getUser()
  const id = data.user?.id
  if (!id) throw new AssetError('سجّل الدخول أولًا')
  return id
}

const of = (meta: Record<string, string>, key: string) => (meta[key] ?? '').trim()

/** _openAddEquipment ← _equipmentItemFrom ثم _createAssetRemote ثم _syncEquipmentReminders. */
export async function createVehicle(draft: VehicleDraft, currencySuffix: string): Promise<string> {
  const user = await uid()
  const meta = draft.meta
  const notes = [
    of(meta, EQ.ownershipEnd) && `انتهاء الملكية ${of(meta, EQ.ownershipEnd)}`,
    of(meta, EQ.warrantyEnd) && `الضمان حتى ${of(meta, EQ.warrantyEnd)}`,
    of(meta, EQ.operation) && `التشغيل: ${of(meta, EQ.operation)}`,
  ].filter(Boolean)
  const vehicleType = of(meta, EQ.vehicleType)
  const title = draft.name.trim() || 'مركبة جديدة'
  const row = {
    user_id: user,
    title,
    sub_type: vehicleType || draft.model.trim() || 'معدة',
    category: 'equipment',
    status: 'تعمل',
    location_or_type: of(meta, EQ.projectLocation) || UNSET,
    amount_label: `0 ${currencySuffix}`,
    followup_note: notes.length ? notes.join(' • ') : 'تم الإنشاء وبانتظار استكمال البيانات',
    owner: UNSET,
    tenant: of(meta, EQ.company) || UNSET,
    rent_value: UNSET,
    end_date: endDateColumn(of(meta, EQ.ownershipEnd)),
    annual_yield: of(meta, EQ.condition) || UNSET,
    occupancy_rate: 0,
    contract_progress: 0,
    payment_progress: 0,
    documents_progress: 0,
    needs_attention: false,
    icon_color: null,
    cover_url: null,
    description: '',
    annexes: draft.annexes,
    map_link: null,
    quick_add_enabled: false,
    units_json: '[]',
    employees_json: '[]',
    serial_number: draft.serial.trim(),
    is_frozen: false,
    is_pinned: false,
    is_sublease: false,
    latitude: null,
    longitude: null,
    logs_json: joinLogs(meta, [`تم إنشاء المركبة: ${draft.name.trim()}`]),
  }
  const created = await withColumnFallback<{ id: string }>(row, (body) => supabase.from('project_assets').insert(body).select('id').single())
  const r = vehicleReminders(draft.name.trim(), meta)
  await changeReminders(r.upserts, r.removes).catch(() => {})
  return created?.id ?? ''
}

/** عقد قائم على المركبة (_contractHolds). */
export function contractHolds(c: UnitContract, today = new Date()): boolean {
  if (['expired', 'ended', 'cancelled', 'pending'].includes(c.status)) return false
  if (!c.end_date) return true
  const end = new Date(`${c.end_date.slice(0, 10)}T00:00:00`)
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return !(end.getTime() < day.getTime())
}

/** _editEquipment: الحقول التي يغيّرها التعديل فقط، على أحدث نسخة وبشرط عدم تغيّرها. */
export async function updateVehicle(assetId: string, draft: VehicleDraft, contracts: UnitContract[]) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('project_assets').select('id, tenant, logs_json, updated_at').eq('id', assetId).maybeSingle()
    if (error) throw error
    const fresh = data as { id: string; tenant: string | null; logs_json: string | null; updated_at: string } | null
    if (!fresh) throw new AssetError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    const { logs } = splitLogs(fresh.logs_json)
    const meta = draft.meta
    const tenant = (fresh.tenant ?? '').trim()
    const holds = contracts.some((c) => c.asset_id === assetId && c.unit_key === 'equipment' && contractHolds(c))
    const patch = {
      title: draft.name.trim(),
      sub_type: of(meta, EQ.vehicleType) || draft.model.trim() || 'معدة',
      serial_number: draft.serial.trim(),
      annexes: draft.annexes,
      end_date: endDateColumn(of(meta, EQ.ownershipEnd)),
      tenant: holds && tenant && tenant !== UNSET ? tenant : of(meta, EQ.company) || UNSET,
      location_or_type: of(meta, EQ.projectLocation) || UNSET,
      annual_yield: of(meta, EQ.condition) || UNSET,
      logs_json: joinLogs(meta, logs),
    }
    const saved = await withColumnFallback<{ id: string }[]>(patch, (body) => supabase.from('project_assets').update(body).eq('id', assetId).eq('updated_at', fresh.updated_at).select('id'))
    if (saved && saved.length) {
      const r = vehicleReminders(draft.name.trim(), meta)
      await changeReminders(r.upserts, r.removes).catch(() => {})
      return
    }
  }
  throw new AssetError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

/** _kEquipUnitKey: عقود تأجير المركبة على «الوحدة» equipment. */
export const VEHICLE_UNIT_KEY = 'equipment'

/** بعد حفظ عقد التأجير: المستأجر على المركبة (_item.copyWith(tenant)). */
export async function setVehicleTenant(assetId: string, tenant: string) {
  if (!tenant || tenant === 'بلا اسم') return
  const { data, error } = await supabase.from('project_assets').select('tenant').eq('id', assetId).maybeSingle()
  if (error) throw error
  if (!data || (data as { tenant: string | null }).tenant === tenant) return
  const { error: saveError } = await supabase.from('project_assets').update({ tenant }).eq('id', assetId)
  if (saveError) throw saveError
}

/* ===== عقد تأجير المركبة القديم (_openLegacyEquipContractForm) ===== */

export const EQUIP_RENT_BASES = ['شهري', 'يومي', 'بالساعات']
export const equipRatePer = (basis: string) => (basis === 'يومي' ? 'يوم' : basis === 'بالساعات' ? 'ساعة' : 'شهر')

/** _equipContractExtra: الأساس والمبلغ والملاحظة من notes. */
export function equipContractExtra(notes: string | null): Record<string, string> {
  const text = (notes ?? '').trim()
  if (!text.startsWith('{')) return text ? { note: text } : {}
  try {
    const decoded = JSON.parse(text)
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(decoded)) if (k !== '__equip__') out[k] = String(v ?? '')
    return out
  } catch {
    return {}
  }
}

/** _equipMonthsBetween */
export function equipMonthsBetween(start: Date, end: Date | null): number {
  if (!end || !(end > start)) return 0
  let months = 0
  let cursor = start
  while (cursor < end && months < 120) {
    months++
    cursor = new Date(start.getFullYear(), start.getMonth() + months, start.getDate())
  }
  return months
}

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
  حفظ العقد القديم: notes {__equip__, basis, rate, note}، والقيمة = المبلغ × الأشهر
  في الشهري، والدفعات الشهرية تلقائيًا إن طُلبت، والمستأجر على المركبة.
*/
export async function saveLegacyVehicleContract(o: {
  assetId: string
  assetTitle: string
  existing: { id: string; status: string }
  company: string
  phone: string
  start: Date
  end: Date | null
  basis: string
  rateText: string
  note: string
  autoPay: boolean
}) {
  const rate = parseFloat(o.rateText.replace(/,/g, '').replace(/٬/g, '')) || 0
  const months = equipMonthsBetween(o.start, o.end)
  const total = o.basis === 'شهري' && months > 0 ? rate * months : rate
  const notes = JSON.stringify({ __equip__: 1, basis: o.basis, rate: o.rateText, note: o.note })
  const { error } = await supabase
    .from('property_unit_contracts')
    .update({
      unit_name: o.assetTitle,
      tenant_name: o.company,
      tenant_phone: o.phone,
      annual_rent: total,
      payment_cycle: o.basis,
      start_date: isoDate(o.start),
      end_date: o.end ? isoDate(o.end) : null,
      status: o.existing.status || 'active',
      notes,
    })
    .eq('id', o.existing.id)
  if (error) throw error
  if (o.autoPay && o.basis === 'شهري' && rate > 0 && o.end) {
    const user = await uid()
    const rows = []
    for (let i = 0; i < months; i++) {
      let due = new Date(o.start.getFullYear(), o.start.getMonth() + i + 1, o.start.getDate())
      if (due > o.end) due = o.end
      rows.push({
        user_id: user,
        contract_id: o.existing.id,
        due_date: isoDate(due),
        amount_due: rate,
        amount_paid: 0,
        status: 'pending',
        notes: JSON.stringify({ __pay__: 1, 'نوع البند': 'دفعة إيجارية', 'اسم البند': `إيجار الشهر ${i + 1}` }),
      })
    }
    if (rows.length) {
      const { error: payError } = await supabase.from('property_unit_payments').insert(rows)
      if (payError) throw payError
    }
  }
  if (o.company) await setVehicleTenant(o.assetId, o.company).catch(() => {})
}
