import { supabase } from './supabase'
import type { Asset, UnitContract } from './data'
import { AssetError } from './assetWrite'
import { joinLogs, splitLogs, uid, withColumnFallback } from './vehicleWrite'
import { delegatedFresh, isUnitScoped, saveDelegatedUnits } from './delegatedAssets'

/*
  العقارات (projects_activities_screen.dart):
  - «إضافة عقار» (_openAddPropertyWizard): نوع الملكية ← نوع العقار
    (_PropertyTypeGridScreen) ← بيانات العقار والوحدات والمرافق
    (_AddPropertyStep1Screen) ← المراجعة (_PropertyReviewScreen) ← الإنشاء.
  - «تعديل عقار» (_PropertyFullEditScreen ← _openPropertyFullEdit): البيانات،
    كل وحدة بحقولها، المرافق العامة، و«إضافة وحدة جديدة»؛ وسطر في السجل بما
    تغيّر، وتغيير اسم الوحدة يُحدَّث في عقودها.
  - «إضافة وحدة» من صفحة العقار (_addUnit ← _UnitsEntryScreen) تُحفظ فورًا.
  - أوامر الوحدة (_onUnitMenuAction): تجميد / إلغاء التجميد، وأرشفة الشاغرة.
  الوحدات كلها (الحية والمؤرشفة) في units_json، والبيانات الرسمية في سطر
  ##meta## داخل logs_json كما يكتبها التطبيق.
*/

const UNSET = 'غير محدد'

export const PROPERTY_TYPE_KEY = 'نوع العقار'
export const PROPERTY_SUBTYPE_KEY = 'تصنيف العقار'
export const PLACE_DESC_KEY = 'وصف المكان وموقع المكان'
export const INNER_FACILITIES_KEY = 'المرافق الداخلية للوحدة'
export const AREA_UNIT_KEY = 'وحدة مساحة العين'
export const AREA_UNITS = ['م²', 'قدم²']
export const ELECTRIC_COUNT = 'عدد عدادات الكهرباء'
export const ELECTRIC_METERS = 'عدادات الكهرباء'
export const WATER_COUNT = 'عدد عدادات المياه'
export const WATER_METERS = 'عدادات المياه'
export const ARCHIVED_AT_KEY = 'تاريخ الأرشفة'
export const PINNED_KEY = '__key'
const UNIT_LOG_KEY = '__سجل الوحدة'

/** (مفتاح العدد، مفتاح الأرقام، عنوان العدد، عنوان الرقم) — _kMeterCountFields */
export const METER_FIELDS: [string, string, string, string][] = [
  [ELECTRIC_COUNT, ELECTRIC_METERS, 'عدد عدادات الكهرباء', 'رقم عداد الكهرباء'],
  [WATER_COUNT, WATER_METERS, 'عدد عدادات المياه', 'رقم عداد المياه'],
]

/** _kRequiredPropertyMeta */
export const REQUIRED_META = ['المدينة', 'المنطقة', 'نوع العين']

/** خيارات «نوع العين» (LeaseContractData.propertyFields). */
export const PREMISES_TYPES = ['سكني', 'تجاري', 'استثماري', 'صناعي', 'زراعي', 'أخرى']

/** حقول البيانات الرسمية الظاهرة في نموذج العقار بترتيب عقد الإيجار. */
export const OFFICIAL_FIELDS: { key: string; label: string; numeric?: boolean; options?: string[] }[] = [
  { key: 'المدينة', label: 'المدينة' },
  { key: 'المنطقة', label: 'المنطقة' },
  { key: 'نوع العين', label: 'نوع العين', options: PREMISES_TYPES },
  { key: 'مساحة العين', label: 'مساحة العين', numeric: true },
  { key: 'رقم العقار', label: 'رقم الوحدة الرسمية' },
]

/** _kAddPropertyMetaKeys — ما يكتبه نموذج الإضافة والتعديل في البيانات. */
export const EDIT_META_KEYS = [PROPERTY_SUBTYPE_KEY, 'المدينة', 'المنطقة', 'مساحة العين', 'نوع العين', 'رقم العقار', ELECTRIC_COUNT, ELECTRIC_METERS, WATER_COUNT, WATER_METERS]

/** _propertyTypeOptions */
export const PROPERTY_TYPES = ['عمارة', 'فيلا', 'شقة', 'استديو', 'غرفة', 'دور', 'محل', 'مكتب', 'ميزانين', 'مستودع', 'أرض', 'موقف', 'مجمع', 'شاليه', 'محطة بترول', 'مساحة خاصة للتأجير']

export const UNIT = {
  apartment: 'شقة',
  studio: 'استديو',
  shop: 'محل',
  office: 'مكتب',
  warehouse: 'مستودع',
  room: 'غرفة',
  parking: 'موقف خاص',
  fullFloor: 'دور كامل',
  showroom: 'معرض',
  mezzanine: 'ميزانين',
  land: 'أرض',
  chalet: 'شاليه',
  station: 'محطة بترول',
  adSpace: 'مساحة إعلانية',
  roofSpace: 'مساحة على سطح العمارة',
  telecom: 'موقع أجهزة اتصال',
} as const

const MULTI = [UNIT.apartment, UNIT.studio, UNIT.room, UNIT.mezzanine, UNIT.fullFloor, UNIT.shop, UNIT.warehouse, UNIT.office]

/** _kPropertyTypeUnits */
export const PROPERTY_TYPE_UNITS: Record<string, string[]> = {
  عمارة: MULTI,
  فيلا: MULTI,
  مجمع: MULTI,
  شقة: [UNIT.apartment],
  استديو: [UNIT.studio],
  غرفة: [UNIT.room],
  دور: [UNIT.fullFloor],
  محل: [UNIT.shop],
  مكتب: [UNIT.office],
  ميزانين: [UNIT.mezzanine],
  مستودع: [UNIT.warehouse],
  أرض: [UNIT.land],
  موقف: [UNIT.parking],
  شاليه: [UNIT.chalet],
  'محطة بترول': [UNIT.station],
  'مساحة خاصة للتأجير': [UNIT.adSpace, UNIT.roofSpace, UNIT.telecom],
}

/** _unitTypesForPropertyType: نوع قديم غير معروف ← كل أنواع العمارة. */
export function unitTypesFor(propertyType: string): string[] {
  const approved = PROPERTY_TYPE_UNITS[propertyType]
  if (approved) return approved
  return [UNIT.apartment, UNIT.studio, UNIT.fullFloor, UNIT.room, UNIT.office, UNIT.shop, UNIT.showroom, UNIT.mezzanine, UNIT.warehouse, UNIT.parking]
}

/** العقار الذي هو وحدة واحدة (شقة، محل...). */
export const singleUnitProperty = (propertyType: string) => (PROPERTY_TYPE_UNITS[propertyType]?.length ?? 0) === 1

/** _propertySubTypeOptions — سطر «النوع». */
export function subTypeOptions(propertyType: string): string[] {
  if (propertyType === 'موقف') return ['موقف بري', 'موقف بحري']
  if (propertyType === 'مجمع') return ['مجمع تجاري', 'مجمع سكني', 'مجمع صناعي']
  if (propertyType === 'أرض') return ['زراعي', 'صناعي', 'تجاري', 'أخرى']
  return []
}

/** _kCommonFacilities */
export const COMMON_FACILITIES = [
  'مواقف سيارات عامة',
  'المصعد',
  'الدرج',
  'المداخل / اللوبي',
  'الممرات',
  'السطح',
  'الحوش / الساحة',
  'غرفة الحارس',
  'غرفة الكهرباء',
  'غرفة الاتصالات',
  'غرفة المياه والمضخات',
  'خزانات المياه',
  'غرفة النفايات',
  'النادي الرياضي',
  'المسبح',
  'مستودع تخزين',
  'مكتب إداري',
  'ميزانين',
  'غرفة الخدمات',
  'أخرى',
]

export const hasRooms = (type: string) => type === UNIT.apartment || type === UNIT.office || type === UNIT.fullFloor || type === UNIT.chalet
export const isResidential = (type: string) => hasRooms(type) || type === UNIT.studio || type === UNIT.room
/** _unitTypeRoomsFor */
export const roomsFor = (type: string, entered: number) => (type === UNIT.studio || type === UNIT.room ? 1 : hasRooms(type) ? entered : 0)

export type PropertyUnit = {
  type: string
  name: string
  unitNumber: string
  area: string
  rooms: number
  halls: number
  balconies: number
  bathrooms: number
  parkingCount: number
  hasParking: boolean
  notes: string
  status: string
  extras: Record<string, string>
}

const int = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** _PropertyUnit.fromMap */
export function unitFromMap(map: Record<string, unknown>): PropertyUnit {
  const extras = map['extras'] && typeof map['extras'] === 'object' && !Array.isArray(map['extras']) ? Object.fromEntries(Object.entries(map['extras'] as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])) : {}
  return {
    type: String(map['type'] ?? UNIT.apartment),
    name: String(map['name'] ?? ''),
    unitNumber: String(map['unitNumber'] ?? ''),
    area: String(map['area'] ?? ''),
    rooms: int(map['rooms']),
    halls: int(map['halls']),
    balconies: int(map['balconies']),
    bathrooms: int(map['bathrooms']),
    parkingCount: int(map['parkingCount']),
    hasParking: map['hasParking'] === true,
    notes: String(map['notes'] ?? ''),
    status: String(map['status'] ?? 'شاغرة'),
    extras,
  }
}

/** _PropertyUnit.toMap — بنفس ترتيب المفاتيح. */
export const unitToMap = (u: PropertyUnit) => ({
  type: u.type,
  name: u.name,
  unitNumber: u.unitNumber,
  area: u.area,
  rooms: u.rooms,
  halls: u.halls,
  balconies: u.balconies,
  bathrooms: u.bathrooms,
  parkingCount: u.parkingCount,
  hasParking: u.hasParking,
  notes: u.notes,
  status: u.status,
  extras: u.extras,
})

export const unitKey = (u: PropertyUnit) => {
  const pinned = (u.extras[PINNED_KEY] ?? '').trim()
  return pinned || `${u.type}|${u.name}|${u.unitNumber}`
}

export const unitIsLive = (u: PropertyUnit) => u.status !== 'مؤرشفة' && u.status !== 'محذوفة'

export function decodeUnits(raw: string | null | undefined): PropertyUnit[] {
  if (!raw || !String(raw).trim()) return []
  try {
    const list = JSON.parse(String(raw))
    return Array.isArray(list) ? list.filter((m) => m && typeof m === 'object' && !Array.isArray(m)).map((m) => unitFromMap(m as Record<string, unknown>)) : []
  } catch {
    return []
  }
}

export const encodeUnits = (units: PropertyUnit[]) => JSON.stringify(units.map(unitToMap))

/** _nextUnitNumber */
export function nextUnitNumber(units: PropertyUnit[], type: string) {
  let max = 0
  for (const u of units) {
    if (u.type !== type) continue
    const n = parseInt(u.unitNumber.trim(), 10)
    if (/^\d+$/.test(u.unitNumber.trim()) && n > max) max = n
  }
  return max + 1
}

/** _duplicateUnitNames */
export function duplicateUnitNames(existing: PropertyUnit[], type: string, baseName: string, first: number, count: number) {
  const keys = new Set(existing.map(unitKey))
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const name = count === 1 ? baseName : `${baseName} ${first + i}`
    if (keys.has(`${type}|${name}|${first + i}`)) out.push(name)
  }
  return out
}

/** _meterExtrasFrom */
export function meterExtras(meters: Record<string, string>, withNumbers: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [countKey, numbersKey] of METER_FIELDS) {
    const count = parseInt((meters[countKey] ?? '').trim(), 10) || 0
    if (count <= 0) continue
    out[countKey] = String(count)
    const numbers = meters[numbersKey] ?? ''
    if (withNumbers && numbers.trim()) out[numbersKey] = numbers
  }
  return out
}

/** _parseLatLngFromMapLink */
export function parseLatLng(input: string): [number, number] | null {
  const text = input.trim()
  if (!text) return null
  const patterns = [/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, /[?&](?:q|ll|query)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, /^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/]
  for (const p of patterns) {
    const m = p.exec(text)
    if (m) {
      const lat = Number(m[1])
      const lng = Number(m[2])
      if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng]
    }
  }
  return null
}

/** LeaseContractData.metaLabel */
export function metaLabel(key: string) {
  switch (key) {
    case 'رقم تسجيل الوحدة':
      return 'رقم عداد الكهرباء'
    case 'معرف العقار':
      return 'رقم عداد المياه'
    case 'تصنيف العقار':
      return 'النوع'
    case 'عدادات الكهرباء':
      return 'أرقام عدادات الكهرباء'
    case 'عدادات المياه':
      return 'أرقام عدادات المياه'
    default:
      return key
  }
}

const two = (n: number) => String(n).padStart(2, '0')
/** «… — 08/11/2026 الساعة 10:22» (_stampedLogLine). */
export function stamped(line: string, now = new Date()) {
  return `${line} — ${two(now.getDate())}/${two(now.getMonth() + 1)}/${now.getFullYear()} الساعة ${two(now.getHours())}:${two(now.getMinutes())}`
}

const isoToday = () => {
  const d = new Date()
  return `${String(d.getFullYear()).padStart(4, '0')}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

const dartNow = () => {
  const d = new Date()
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/* ===== نموذج الوحدات المشترك بين الإضافة والتعديل ===== */

export type UnitFormValues = {
  count: string
  firstNumber: string
  lastNumber: string
  name: string
  area: string
  rooms: string
  halls: string
  balconies: string
  bathrooms: string
  parking: string
  notes: string
  meters: Record<string, string>
  /** في العقار متعدد الوحدات (معالج الإضافة): نوع العين، رقم الوحدة الرسمية، المرافق الداخلية، وحدة المساحة. */
  unitMeta: Record<string, string>
}

export const emptyUnitForm = (first: number): UnitFormValues => ({
  count: '',
  firstNumber: String(first),
  lastNumber: '',
  name: '',
  area: '',
  rooms: '',
  halls: '',
  balconies: '',
  bathrooms: '',
  parking: '',
  notes: '',
  meters: {},
  unitMeta: {},
})

const n = (v: string) => parseInt(v.trim(), 10) || 0

/** _rangeUnitCount (الإضافة السريعة دائمًا مفعّلة). */
export function rangeCount(f: UnitFormValues) {
  const first = parseInt(f.firstNumber.trim(), 10) || 1
  const last = parseInt(f.lastNumber.trim(), 10) || 0
  if (last >= first && last > 0) return last - first + 1
  return n(f.count)
}

export const formInProgress = (f: UnitFormValues | undefined) =>
  !!f && [f.count, f.name, f.area, f.rooms, f.halls, f.balconies, f.bathrooms, f.parking, f.notes].some((v) => v.trim() !== '')

export type UnitBuild = { units: PropertyUnit[]; review: [string, string][]; error?: undefined } | { error: string; units?: undefined; review?: undefined }

/**
  وحدات النوع المفتوح من نموذجه:
  - wizard (_AddPropertyStep1Screen._commitUnit): بيانات الوحدة كالعقار
    المستقل في العقار متعدد الوحدات، وقدم المساحة.
  - غير ذلك (_UnitsEntryScreen): الصالات للشقة والدور الكامل.
*/
export function buildUnits(args: { type: string; form: UnitFormValues; existing: PropertyUnit[]; wizard: boolean; singleUnit: boolean; areaFeet: boolean }): UnitBuild {
  const { type, form, existing, wizard, singleUnit, areaFeet } = args
  const count = rangeCount(form)
  if (count <= 0) return { error: 'أدخل العدد أولًا' }
  const countOnly = type === UNIT.parking
  if (!countOnly && !form.name.trim()) return { error: `اكتب اسم ${type} — الاسم إلزامي` }
  const first = parseInt(form.firstNumber.trim(), 10) || 1
  const baseName = form.name.trim() || type
  const dup = duplicateUnitNames(existing, type, baseName, first, count)
  if (dup.length) return { error: `موجودة مسبقًا: ${dup.slice(0, 5).join('، ')} — غيّر رقم البداية (المتاح ${nextUnitNumber(existing, type)})` }
  const showFull = wizard ? type === UNIT.fullFloor : type === UNIT.apartment || type === UNIT.fullFloor
  const residential = isResidential(type)
  const rooms = hasRooms(type)
  const unitMeta: Record<string, string> = {}
  if (wizard && !singleUnit && !countOnly) {
    for (const key of ['نوع العين', 'رقم العقار', INNER_FACILITIES_KEY]) {
      const value = (form.unitMeta[key] ?? '').trim()
      if (value && (key !== 'رقم العقار' || count === 1)) unitMeta[key] = value
    }
  }
  const feet = wizard && (singleUnit ? areaFeet : (form.unitMeta[AREA_UNIT_KEY] ?? '').trim() === 'قدم²')
  const review: [string, string][] = [['النوع', type], ['العدد', String(count)]]
  if (!countOnly) review.push(['الاسم', baseName])
  if (!countOnly && count > 1) review.push(['الترقيم', `من ${first} إلى ${first + count - 1}`])
  else if (!countOnly) review.push(['الرقم', String(first)])
  if (!countOnly && form.area.trim()) review.push(['مساحة كل وحدة', `${form.area.trim()} ${feet ? 'قدم مربع' : 'متر مربع'}`])
  for (const [k, v] of Object.entries(unitMeta)) review.push([k === 'رقم العقار' ? 'رقم الوحدة الرسمية' : k, v])
  if (!countOnly && rooms) review.push(['عدد الغرف', String(n(form.rooms))])
  if (!countOnly && (rooms || showFull)) review.push(['عدد البلكونات', String(n(form.balconies))])
  if (!countOnly && showFull) review.push(['عدد الصالات', String(n(form.halls))])
  if (!countOnly && residential) review.push(['عدد الحمامات', String(n(form.bathrooms))])
  if (!countOnly && residential) review.push(['مواقف السيارات الخاصة', String(n(form.parking))])
  if (form.notes.trim()) review.push(['الملاحظات', form.notes.trim()])
  const units: PropertyUnit[] = []
  for (let i = 0; i < count; i++) {
    units.push({
      type,
      name: count === 1 ? baseName : `${baseName} ${first + i}`,
      unitNumber: String(first + i),
      area: wizard && countOnly ? '' : form.area.trim(),
      rooms: roomsFor(type, n(form.rooms)),
      halls: showFull ? n(form.halls) : 0,
      balconies: n(form.balconies),
      bathrooms: residential ? n(form.bathrooms) : 0,
      parkingCount: residential ? n(form.parking) : 0,
      hasParking: residential && n(form.parking) > 0,
      notes: form.notes.trim(),
      status: 'شاغرة',
      extras: {
        ...meterExtras(form.meters, count === 1),
        ...unitMeta,
        ...(feet && !countOnly && form.area.trim() ? { [AREA_UNIT_KEY]: 'قدم²' } : {}),
      },
    })
  }
  return { units, review }
}

/* ===== إنشاء العقار ===== */

export type PropertyDraft = {
  isSublease: boolean
  propertyType: string
  name: string
  /** «الملاحظات» */
  description: string
  units: PropertyUnit[]
  facilities: Record<string, number>
  facilityNotes: Record<string, string>
  /** القيم غير الفارغة فقط. */
  officialMeta: Record<string, string>
}

/** الموقع = «المنطقة، المدينة» (بلا خانة بحث عن الموقع). */
export const draftAddress = (meta: Record<string, string>) => [meta['المنطقة'] ?? '', meta['المدينة'] ?? ''].map((x) => x.trim()).filter(Boolean).join('، ')

export function draftSubType(d: PropertyDraft) {
  if (d.propertyType.trim()) return d.propertyType
  return d.units.length > 1 ? 'عمارة' : d.units[0]?.type ?? ''
}

/** _openAddPropertyWizard ← _createAssetRemote */
export async function createProperty(d: PropertyDraft, currencySuffix: string): Promise<string> {
  const user = await uid()
  const address = draftAddress(d.officialMeta)
  const unitsLabel = d.units.length ? `${d.units.length} وحدة` : 'بدون وحدات'
  const facilityNames = Object.keys(d.facilities)
  const logs = [
    ...Object.entries(d.facilityNotes).map(([k, v]) => `ملاحظة مرفق ${k}: ${v}`),
    `تمت إضافة العقار بـ ${unitsLabel}${facilityNames.length ? ` ومرافق: ${facilityNames.join('، ')}` : ''}`,
  ]
  const meta = { ...d.officialMeta, [PROPERTY_TYPE_KEY]: d.propertyType }
  const row = {
    user_id: user,
    title: d.name.trim() || d.description.trim() || 'عقار جديد',
    sub_type: draftSubType(d),
    category: 'real_estate',
    status: 'نشط',
    location_or_type: address || UNSET,
    amount_label: `0 ${currencySuffix}`,
    followup_note: 'تم الإنشاء وبانتظار استكمال البيانات',
    owner: UNSET,
    tenant: UNSET,
    rent_value: UNSET,
    end_date: null,
    annual_yield: UNSET,
    occupancy_rate: 0,
    contract_progress: 0,
    payment_progress: 0,
    documents_progress: 0,
    needs_attention: false,
    icon_color: null,
    cover_url: null,
    description: d.description.trim(),
    annexes: { ...d.facilities },
    map_link: '',
    quick_add_enabled: true,
    units_json: encodeUnits(d.units),
    employees_json: '[]',
    serial_number: '',
    is_frozen: false,
    is_pinned: false,
    is_sublease: d.isSublease,
    latitude: null,
    longitude: null,
    logs_json: joinLogs(meta, logs),
  }
  const created = await withColumnFallback<{ id: string }>(row, (body) => supabase.from('project_assets').insert(body).select('id').single())
  return created?.id ?? ''
}

/* ===== التعديل ===== */

type Fresh = {
  id: string
  title: string
  sub_type: string
  description: string | null
  location_or_type: string | null
  owner: string | null
  map_link: string | null
  latitude: number | null
  longitude: number | null
  annexes: Record<string, unknown> | null
  units_json: string | null
  logs_json: string | null
  updated_at: string
}

const FRESH_COLUMNS = 'id, title, sub_type, description, location_or_type, owner, map_link, latitude, longitude, annexes, units_json, logs_json, updated_at'

async function readFresh(assetId: string): Promise<Fresh> {
  // المفوَّض على وحدات بعينها: العقار بوحداته وحدها من الخادم.
  if (isUnitScoped(assetId)) {
    const row = await delegatedFresh<Fresh>(assetId)
    if (!row) throw new AssetError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    return row
  }
  const { data, error } = await supabase.from('project_assets').select(FRESH_COLUMNS).eq('id', assetId).maybeSingle()
  if (error) throw error
  if (!data) throw new AssetError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
  return data as unknown as Fresh
}

const annexMap = (raw: unknown): Record<string, number> =>
  raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, Math.trunc(Number(v) || 0)])) : {}

const sortedJson = (m: Record<string, number>) => JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]))

async function writeGuarded(assetId: string, updatedAt: string, patch: Record<string, unknown>) {
  // updateAsset للمفوَّض على وحدات: تُحفظ بيانات وحداته فقط (fundly_save_delegated_units).
  if (isUnitScoped(assetId)) {
    if (Object.keys(patch).some((k) => k !== 'units_json')) throw new AssetError('أنت مفوَّض على وحدات بعينها — بيانات العقار يعدّلها صاحبه')
    await saveDelegatedUnits(assetId, String(patch.units_json ?? '[]'))
    return true
  }
  const saved = await withColumnFallback<{ id: string }[]>(patch, (body) => supabase.from('project_assets').update(body).eq('id', assetId).eq('updated_at', updatedAt).select('id'))
  return !!saved && saved.length > 0
}

/** بيانات شاشة التعديل من السجل. */
export type PropertyEditState = {
  name: string
  description: string
  address: string
  owner: string
  mapLink: string
  meta: Record<string, string>
  /** الوحدات الحية بترتيبها، والمضافة من «إضافة وحدة جديدة» بعدها. */
  units: PropertyUnit[]
  /** عدد الوحدات الحية عند فتح الشاشة (ما بعده مضاف الآن). */
  baseCount: number
  facilities: Record<string, string>
  facilityNames: string[]
  /** units_json عند الفتح: يُرفض الحفظ إن تغيّرت الوحدات في الأثناء. */
  baseUnitsJson: string
}

export function editStateOf(asset: Asset): PropertyEditState {
  const a = asset as Asset & { description?: string | null; map_link?: string | null; units_json?: string | null }
  const { meta } = splitLogs(a.logs_json)
  const live = decodeUnits(a.units_json).filter(unitIsLive)
  const annexes = annexMap(a.annexes)
  const facilityNames = [...COMMON_FACILITIES, ...Object.keys(annexes).filter((k) => !COMMON_FACILITIES.includes(k) && !k.startsWith('أخرى: '))]
  return {
    name: a.title,
    description: a.description ?? '',
    address: (a.location_or_type ?? '') === UNSET ? '' : a.location_or_type ?? '',
    owner: (a.owner ?? '') === UNSET ? '' : a.owner ?? '',
    mapLink: a.map_link ?? '',
    meta: Object.fromEntries(EDIT_META_KEYS.map((k) => [k, meta[k] ?? ''])),
    units: live,
    baseCount: live.length,
    facilities: Object.fromEntries(facilityNames.map((f) => [f, (annexes[f] ?? 0) > 0 ? String(annexes[f]) : ''])),
    facilityNames,
    baseUnitsJson: encodeUnits(live),
  }
}

/** «تم تعديل بيانات العقار (…) — 08/11/2026 الساعة 10:22» */
export const editLogLine = (fields: string[]) => stamped(`تم تعديل بيانات العقار (${[...new Set(fields)].join('، ')})`)

/** _PropertyFullEditScreen._save — رسالة الخطأ ونوع اللوح الذي يُفتح. */
export function validateEdit(s: PropertyEditState, unitsOnly: boolean): { error: string; focus: string } | null {
  if (!s.name.trim()) return { error: 'أدخل اسم العقار', focus: '__data' }
  if (!unitsOnly) {
    const missing = REQUIRED_META.filter((k) => !(s.meta[k] ?? '').trim())
    if (missing.length) return { error: `أكمل الحقول الإلزامية: ${missing.join('، ')}`, focus: '__data' }
  }
  const nameless = s.units.find((u) => !u.name.trim())
  if (nameless) return { error: 'اكتب اسم كل وحدة — لا تُحفظ وحدة بلا اسم', focus: nameless.type }
  return null
}

/**
  حفظ التعديل الكامل على أحدث نسخة: الوحدات المعدّلة (بمفتاحها المثبّت إن
  تغيّر اسمها أو رقمها) + الوحدات المؤرشفة كما هي، والمرافق، والبيانات،
  وسطر السجل بما تغيّر، ثم اسم الوحدة في عقودها.
  originals: الوحدات كما كانت عند الفتح (لمقارنة الاسم والرقم).
  focusKey: الوحدة التي فُتح التعديل من صفحتها — تغيير اسمها يُسجَّل في سجلها.
*/
export async function saveFullEdit(assetId: string, s: PropertyEditState, originals: PropertyUnit[], focusKey?: string): Promise<{ contractsError?: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const fresh = await readFresh(assetId)
    const all = decodeUnits(fresh.units_json)
    const freshLive = all.filter(unitIsLive)
    if (encodeUnits(freshLive) !== s.baseUnitsJson) throw new AssetError('تغيّرت وحدات العقار أثناء التعديل — أغلق الشاشة وافتحها من جديد')
    const shelved = all.filter((u) => !unitIsLive(u))
    const renamed: Record<string, string> = {}
    const units: PropertyUnit[] = s.units.map((edited, i) => {
      const before = i < originals.length ? originals[i] : edited
      const newName = edited.name.trim()
      const newNumber = edited.unitNumber.trim()
      const extras = { ...edited.extras }
      if (i < originals.length && (newName !== before.name || newNumber !== before.unitNumber)) {
        if (!(extras[PINNED_KEY] ?? '').trim()) extras[PINNED_KEY] = unitKey(before)
      }
      if (i < originals.length && newName !== before.name) {
        renamed[unitKey(before)] = newName
        if (focusKey && unitKey(before) === focusKey && before.name.trim()) {
          let rows: unknown[] = []
          try {
            const decoded = JSON.parse(extras[UNIT_LOG_KEY] ?? '[]')
            if (Array.isArray(decoded)) rows = decoded
          } catch {
            rows = []
          }
          rows.push({ type: 'rename', at: dartNow(), from: before.name.trim(), to: newName })
          extras[UNIT_LOG_KEY] = JSON.stringify(rows)
        }
      }
      const residential = isResidential(edited.type)
      const parking = residential ? edited.parkingCount : before.parkingCount
      for (const [countKey, numbersKey] of METER_FIELDS) {
        for (const key of [countKey, numbersKey]) if (!(extras[key] ?? '').trim()) delete extras[key]
      }
      return {
        ...edited,
        name: newName,
        unitNumber: newNumber,
        area: edited.type === UNIT.parking ? before.area : edited.area.trim(),
        rooms: hasRooms(edited.type) ? edited.rooms : before.rooms,
        halls: edited.type === UNIT.fullFloor ? edited.halls : before.halls,
        balconies: hasRooms(edited.type) || edited.type === UNIT.fullFloor ? edited.balconies : before.balconies,
        bathrooms: residential ? edited.bathrooms : before.bathrooms,
        parkingCount: parking,
        hasParking: residential ? parking > 0 : before.hasParking,
        notes: edited.notes.trim(),
        extras,
      }
    })
    const freshAnnexes = annexMap(fresh.annexes)
    const annexes: Record<string, number> = Object.fromEntries(Object.entries(freshAnnexes).filter(([k]) => k.startsWith('أخرى: ')))
    for (const [name, value] of Object.entries(s.facilities)) {
      const count = n(value)
      if (count > 0) annexes[name] = count
    }
    const { meta: freshMeta, logs } = splitLogs(fresh.logs_json)
    const meta = { ...freshMeta }
    for (const key of EDIT_META_KEYS) {
      const value = (s.meta[key] ?? '').trim()
      if (value) meta[key] = value
      else delete meta[key]
    }
    const mapLink = s.mapLink.trim()
    const coords = parseLatLng(mapLink)
    const address = s.address.trim()
    const owner = s.owner.trim()
    const next = {
      title: s.name.trim(),
      description: s.description.trim(),
      location_or_type: address || UNSET,
      owner: owner || UNSET,
      map_link: mapLink,
    }
    const label = (key: string) => (key === 'رقم العقار' ? 'رقم الوحدة الرسمية' : metaLabel(key))
    const changed = [
      fresh.title !== next.title && 'اسم العقار',
      (fresh.location_or_type ?? UNSET) !== next.location_or_type && 'الموقع',
      (fresh.description ?? '') !== next.description && 'الملاحظات',
      (fresh.owner ?? UNSET) !== next.owner && 'المالك',
      (fresh.map_link ?? '') !== next.map_link && 'رابط الخريطة',
      ...[...new Set([...Object.keys(freshMeta), ...Object.keys(meta)])].filter((k) => !k.startsWith('__') && !k.startsWith('#') && (freshMeta[k] ?? '').trim() !== (meta[k] ?? '').trim()).map(label),
      encodeUnits(freshLive) !== encodeUnits(units) && 'الوحدات',
      sortedJson(freshAnnexes) !== sortedJson(annexes) && 'المرافق العامة',
    ].filter((x): x is string => !!x)
    const patch = {
      ...next,
      latitude: coords?.[0] ?? fresh.latitude,
      longitude: coords?.[1] ?? fresh.longitude,
      annexes,
      units_json: encodeUnits([...units, ...shelved]),
      logs_json: joinLogs(meta, changed.length ? [editLogLine(changed), ...logs] : logs),
    }
    if (!(await writeGuarded(assetId, fresh.updated_at, patch))) continue
    // اسم الوحدة مكتوب أيضًا في عقودها.
    const keys = Object.keys(renamed)
    if (keys.length) {
      try {
        for (const key of keys) {
          const { error } = await supabase.from('property_unit_contracts').update({ unit_name: renamed[key] }).eq('asset_id', assetId).eq('unit_key', key)
          if (error) throw error
        }
      } catch (e) {
        return { contractsError: String((e as { message?: string }).message ?? e) }
      }
    }
    return {}
  }
  throw new AssetError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

/** «إضافة وحدة» من صفحة العقار: تُضاف الوحدات وتُجمع أعداد المرافق، وسطر بتاريخه. */
export async function addUnitsNow(assetId: string, newUnits: PropertyUnit[], annexes: Record<string, number>, logLine: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const fresh = await readFresh(assetId)
    const all = decodeUnits(fresh.units_json)
    const live = all.filter(unitIsLive)
    const dup = newUnits.filter((u) => live.some((x) => unitKey(x) === unitKey(u)))
    if (dup.length) throw new AssetError(`موجودة مسبقًا: ${dup.slice(0, 5).map((u) => u.name).join('، ')}`)
    const merged = annexMap(fresh.annexes)
    for (const [k, v] of Object.entries(annexes)) merged[k] = (merged[k] ?? 0) + v
    const { meta, logs } = splitLogs(fresh.logs_json)
    const patch = {
      units_json: encodeUnits([...live, ...newUnits, ...all.filter((u) => !unitIsLive(u))]),
      annexes: merged,
      logs_json: joinLogs(meta, [stamped(logLine), ...logs]),
    }
    if (await writeGuarded(assetId, fresh.updated_at, patch)) return
  }
  throw new AssetError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

/* ===== أوامر الوحدة ===== */

const contractClosed = (c: UnitContract) => c.status === 'expired' || c.status === 'ended' || c.status === 'cancelled'

/** عقد قائم لم يُغلق بعد على الوحدة (_hasOpenContract). */
export const unitHasOpenContract = (assetId: string, key: string, contracts: UnitContract[]) => contracts.some((c) => c.asset_id === assetId && c.unit_key === key && !contractClosed(c))

async function mutateUnit(assetId: string, key: string, change: (u: PropertyUnit) => PropertyUnit) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const fresh = await readFresh(assetId)
    const all = decodeUnits(fresh.units_json)
    const index = all.findIndex((u) => unitIsLive(u) && unitKey(u) === key)
    if (index < 0) throw new AssetError('الوحدة غير موجودة — ربما عُدّلت من التطبيق')
    const next = [...all]
    next[index] = change(all[index])
    // الحية أولًا ثم المؤرشفة (_updateItem → shelvedUnits).
    const ordered = [...next.filter(unitIsLive), ...next.filter((u) => !unitIsLive(u))]
    if (await writeGuarded(assetId, fresh.updated_at, { units_json: encodeUnits(ordered) })) return
  }
  throw new AssetError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

/** حالة الوحدة بعد حفظ عقدها (_setUnitStatus): «مسودة» أو «مؤجرة». */
export async function setUnitStatus(assetId: string, key: string, status: string) {
  let units: string | null = null
  if (isUnitScoped(assetId)) units = (await delegatedFresh<Fresh>(assetId))?.units_json ?? null
  else {
    const { data, error } = await supabase.from('project_assets').select('units_json').eq('id', assetId).maybeSingle()
    if (error) throw error
    units = (data as { units_json: string | null } | null)?.units_json ?? null
  }
  const unit = decodeUnits(units).find((u) => unitIsLive(u) && unitKey(u) === key)
  if (!unit || unit.status === status) return
  await mutateUnit(assetId, key, (u) => ({ ...u, status }))
}

/** حالة عدة وحدات معًا (عقد متعدد الوحدات) في كتابة واحدة. */
export async function setUnitsStatus(assetId: string, keys: string[], status: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const fresh = await readFresh(assetId)
    const all = decodeUnits(fresh.units_json)
    let changed = false
    const next = all.map((u) => {
      if (!unitIsLive(u) || !keys.includes(unitKey(u)) || u.status === status) return u
      changed = true
      return { ...u, status }
    })
    if (!changed) return
    if (await writeGuarded(assetId, fresh.updated_at, { units_json: encodeUnits(next) })) return
  }
  throw new AssetError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

/** تجميد الوحدة أو إلغاء تجميدها (شاغرة). */
export const toggleUnitFreeze = (assetId: string, key: string) => mutateUnit(assetId, key, (u) => ({ ...u, status: u.status === 'مجمّدة' ? 'شاغرة' : 'مجمّدة' }))

/** أرشفة الوحدة: لا أرشفة وعليها عقد قائم. */
export async function archiveUnit(assetId: string, key: string, contracts: UnitContract[]) {
  if (unitHasOpenContract(assetId, key, contracts)) throw new AssetError('على الوحدة عقد إيجار قائم — قم بتسويته وإلغائه أولًا ثم أرشف الوحدة.')
  await mutateUnit(assetId, key, (u) => ({ ...u, status: 'مؤرشفة', extras: { ...u.extras, [ARCHIVED_AT_KEY]: isoToday() } }))
}

/** بيانات الوحدة للعرض (_archiveUnitDetails): الحقول ثم extras النصية. */
export function unitInfoRows(u: PropertyUnit): [string, string][] {
  const rows: [string, string][] = []
  if (u.unitNumber.trim()) rows.push(['رقم الوحدة', u.unitNumber])
  if (u.area.trim()) rows.push(['المساحة', `${u.area} ${u.extras[AREA_UNIT_KEY] ?? 'م²'}`])
  if (u.rooms > 0) rows.push(['عدد الغرف', String(u.rooms)])
  if (u.halls > 0) rows.push(['عدد الصالات', String(u.halls)])
  if (u.balconies > 0) rows.push(['عدد البلكونات', String(u.balconies)])
  if (u.bathrooms > 0) rows.push(['عدد الحمامات', String(u.bathrooms)])
  if (u.parkingCount > 0) rows.push(['مواقف السيارات', String(u.parkingCount)])
  if (u.notes.trim()) rows.push(['ملاحظات', u.notes])
  for (const [k, v] of Object.entries(u.extras)) {
    const text = v.trim()
    if (k.startsWith('__') || k === AREA_UNIT_KEY || !text || text.startsWith('[') || text.startsWith('{')) continue
    rows.push([metaLabel(k), text])
  }
  return rows
}
