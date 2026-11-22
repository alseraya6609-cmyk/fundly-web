import { supabase } from './supabase'
import type { UnitContract, UnitPayment } from './data'
import { AssetError, payExtra } from './assetWrite'
import { changeReminders, type Reminder } from './reminders'
import { upsertDirectoryPerson } from './peopleWrite'
import { uid } from './vehicleWrite'

/*
  عقد إيجار الوحدة (lease_contract_data.dart + lease_contract_form_screen.dart
  + syncLeasePaymentRecords في rent_payments_view.dart):
  - العقد كله نص JSON في عمود notes بعلامة __lease__ (العقد، العقار، المؤجر،
    المستأجر، الممثل، التأمينات، الدفعات، الرسوم الإدارية، الملاحظات).
  - الدفعات والرسوم والتأمين تُربط بجدول property_unit_payments بمعرّف السطر
    (__rid): ما سُدِّد لا يُمس، وما حُذف من العقد يُحذف سجله إن لم يُحصَّل منه.
  - نقص الحقول الإلزامية = مسودة (pending)، وإلا ساري (active).
*/

export type Row = Record<string, string>

const K_TERM = 'نمط مدة الإيجار'
const K_START = 'تاريخ بداية العقد'
const K_END = 'تاريخ نهاية العقد'
const K_TRADE = 'الاسم التجاري'
const K_LIC_ISSUE = 'تاريخ إصدار الرخصة'
const K_LIC_END = 'تاريخ انتهاء الرخصة'

export type Lease = {
  contract: Row
  property: Row
  lessor: Row
  tenant: Row
  representative: Row
  license: Row
  deposits: Row[]
  payments: Row[]
  adminFees: Row[]
  note: string
}

export const K = {
  startDate: 'تاريخ بداية العقد',
  endDate: 'تاريخ نهاية العقد',
  value: 'قيمة عقد الإيجار',
  installments: 'عدد الدفعات',
  newNo: 'رقم العقد الجديد',
  oldNo: 'رقم العقد المنتهي',
  termMode: 'نمط مدة الإيجار',
  lessorCapacity: 'صفة المؤجر',
  electricityOn: 'الكهرباء على',
  waterOn: 'المياه على',
  electricCount: 'عدد عدادات الكهرباء',
  electricMeters: 'عدادات الكهرباء',
  waterCount: 'عدد عدادات المياه',
  waterMeters: 'عدادات المياه',
  name: 'الإسم',
  repName: 'اسم ممثل المستأجر',
  mobile: 'رقم الجوال',
  phone: 'رقم الهاتف',
  paymentsNote: 'ملاحظات الدفعات',
  depositAmount: 'مبلغ التأمين',
  adminFeeType: 'نوع الرسم',
  adminFeeAmount: 'قيمة الرسم',
  adminFeeDue: 'تاريخ الاستحقاق',
  paymentAmount: 'قيمة الدفعة',
  paymentFee: 'نوع الرسوم',
  paymentDue: 'تاريخ الاستحقاق',
  paymentReminder: 'التذكير',
  paymentReminderDays: 'أيام التذكير المخصص',
  paymentCheque: 'رقم الشيك',
  paymentChequeDate: 'تاريخ الشيك',
  paymentBank: 'اسم البنك',
  paymentNote: 'ملاحظات الدفعة',
  collectMethod: 'طريقة التحصيل',
  bankAccount: 'رقم الحساب',
  bankBranch: 'اسم الفرع',
  bankIban: 'الآيبان',
  paymentStatus: 'حالة الدفعة',
  taxRate: 'نسبة الضريبة %',
  rentTaxable: 'الإيجار خاضع للضريبة',
  adminFeesTaxable: 'الرسوم الإدارية خاضعة للضريبة',
  adminFeesTaxRate: 'نسبة ضريبة الرسوم %',
  signedAt: 'تاريخ التوقيع والختم',
  signedBy: 'وقّع وختم',
  multiUnits: 'الوحدات المشمولة',
  multiPrimary: 'الوحدة الرئيسية للعقد',
  contractScope: 'محتوى العقد',
  areaUnit: 'وحدة مساحة العين',
  rowId: '__rid',
  subject: 'محل العقد',
  attachedDocs: 'المستندات المرفقة',
  purpose: 'الغرض من الإيجار',
  tenantClass: 'تصنيف المستأجر',
  tradeName: 'الاسم التجاري',
  activityClass: 'تصنيف النشاط',
  legalForm: 'الشكل القانوني',
  licenseNo: 'رقم الرخصة التجارية',
  licenseIssue: 'تاريخ إصدار الرخصة',
  licenseEnd: 'تاريخ انتهاء الرخصة',
  licenseReminder: 'تذكير انتهاء الرخصة',
  licenseReminderDays: 'أيام تذكير الرخصة',
  licenseClass: 'فئة الرخصة',
  chamber: 'عضوية الغرفة',
  activities: 'الأنشطة التجارية',
  capital: 'رأس المال',
  leaseReminder: 'تذكير نهاية العقد',
  leaseReminderDays: 'أيام تذكير نهاية العقد',
  activityLocation: 'موقع النشاط',
} as const

/* ===== عقد إيجار النشاط التجاري ===== */
export const PURPOSES = ['تجاري', 'سكني', 'صناعي', 'مستودع', 'زراعي', 'أخرى']
export const ACTIVITY_REMINDERS = ['بلا تذكير', 'قبل أسبوعين', 'قبل شهر', 'قبل شهرين', 'مخصص']
export const LEGAL_FORMS = ['مؤسسة فردية', 'شركة ذات مسؤولية محدودة', 'شركة مساهمة', 'شركة تضامن', 'فرع شركة', 'أخرى']
export const LICENSE_CLASSES = ['تاجر', 'وطني']
export const ACTIVITY_TYPES = ['الخدمات', 'الأنشطة الفورية', 'زراعية', 'التكنولوجيا', 'الحرفية', 'المقاولات', 'المهنية', 'تجارة واستثمار', 'أخرى']

/** activityRequired */
export const ACTIVITY_REQUIRED: Record<string, string[]> = {
  contract: [K_TERM, K_START, K_END],
  license: [K_TRADE, K_LIC_ISSUE, K_LIC_END],
  lessor: ['الإسم', 'رقم الهوية', 'تاريخ انتهاء الهوية', 'صادرة من', 'رقم الهاتف'],
  tenant: ['الإسم', 'رقم الهوية', 'تاريخ انتهاء الهوية', 'صادرة من', 'رقم الهاتف'],
}

/** _activityMissing: «الحقل (القسم)». */
export function activityMissing(l: Lease): string[] {
  const sections: Record<string, string> = { contract: 'عقد الإيجار', license: 'الرخصة', lessor: 'المؤجر', tenant: 'المستأجر' }
  const labels: Record<string, string> = {
    [K_TERM]: 'نمط مدة الإيجار',
    [K_START]: 'تاريخ بداية العقد',
    [K_END]: 'تاريخ نهاية العقد',
    [K_TRADE]: 'الاسم التجاري',
    [K_LIC_ISSUE]: 'تاريخ الإصدار',
    [K_LIC_END]: 'تاريخ الانتهاء',
    'الإسم': 'الإسم',
    'رقم الهاتف': 'رقم الهاتف',
  }
  const out: string[] = []
  for (const [scope, section] of Object.entries(sections)) {
    const store = (l as unknown as Record<string, Row>)[scope]
    for (const key of ACTIVITY_REQUIRED[scope]) if (!(store[key] ?? '').trim()) out.push(`${labels[key] ?? key} (${section})`)
  }
  return out
}

export const TERM_MODES = ['يومي', 'شهري', 'سنوي', 'مخصص']
export const LESSOR_CAPACITIES = ['مالك', 'مستثمر']
export const UTILITY_PAYERS = ['المستأجر', 'المؤجر']
export const COLLECT_METHODS = ['كاش', 'شيك', 'تحويل بنكي', 'أخرى']
export const REMINDER_NONE = 'بلا تذكير'
export const REMINDER_CUSTOM = 'مخصص'
export const PAYMENT_REMINDERS = [REMINDER_NONE, 'قبل شهر', 'قبل شهرين', REMINDER_CUSTOM]
export const SCOPE_PAYMENTS_ONLY = 'الدفعات الإيجارية فقط'
export const SCOPE_WITH_FEES = 'الدفعات الإيجارية + الرسوم الإدارية'
export const ADMIN_FEE_TYPES = ['رسوم تسجيل العقد', 'رسوم إدارية', 'رسوم خدمات', 'رسوم توثيق', 'عمولة', 'رسوم أخرى']
export const USAGE_TYPES = ['تجاري', 'سكني', 'صناعي', 'مستودع', 'زراعي', 'أخرى']
export const USAGE_PURPOSES = ['سكن عائلة', 'محل ملابس', 'مكتب تخزين', 'تخزين بضائع', 'أخرى']
export const AREA_UNITS = ['م²', 'قدم²']

export type FieldSpec = {
  key: string
  label: string
  numeric?: boolean
  date?: boolean
  multiline?: boolean
  options?: string[]
  chequeOnly?: boolean
  hideForCheque?: boolean
  customReminderOnly?: boolean
  time?: boolean
}

/** contractFields */
export const CONTRACT_FIELDS: FieldSpec[] = [
  { key: K.lessorCapacity, label: 'مالك أو مستثمر', options: LESSOR_CAPACITIES },
  { key: K.newNo, label: 'رقم العقد الجديد' },
  { key: K.oldNo, label: 'رقم العقد المنتهي' },
  { key: K.termMode, label: 'نمط مدة الإيجار', options: TERM_MODES },
  { key: K.startDate, label: 'تاريخ بداية عقد الإيجار', date: true },
  { key: K.endDate, label: 'تاريخ نهاية عقد الإيجار', date: true },
]

/* ===== عقد تأجير المركبة (محل العقد «مركبة») ===== */
export const SUBJECT_VEHICLE = 'مركبة'
export const isVehicleLease = (l: Lease) => (l.contract[K.subject] ?? '').trim() === SUBJECT_VEHICLE
export const START_TIME_KEY = 'ساعة بداية العقد'
export const END_TIME_KEY = 'ساعة نهاية العقد'
export const DRIVER_KEY = 'السائق'
export const DRIVER_OPTIONS = ['بسائق', 'بدون سائق']
export const VEHICLE_TERM_MODES = ['بالساعات', 'يومي', 'شهري', 'سنوي', 'مخصص']
export const TERMS_PARTIES = ['على المؤجر', 'على المستأجر']

/** vehicleContractFields: الرقمان، نمط المدة (مع «بالساعات»)، التاريخان وساعتاهما. */
export const VEHICLE_CONTRACT_FIELDS: FieldSpec[] = [
  { key: K.newNo, label: 'رقم العقد الجديد' },
  { key: K.oldNo, label: 'رقم العقد المنتهي' },
  { key: K.termMode, label: 'نمط مدة الإيجار', options: VEHICLE_TERM_MODES },
  { key: K.startDate, label: 'تاريخ بداية عقد الإيجار', date: true },
  { key: K.endDate, label: 'تاريخ نهاية عقد الإيجار', date: true },
  { key: START_TIME_KEY, label: 'من الساعة', time: true },
  { key: END_TIME_KEY, label: 'إلى الساعة', time: true },
]

/** vehicleTermsFields: شروط التأجير في بيانات العقد نفسه. */
export const VEHICLE_TERMS_FIELDS: FieldSpec[] = [
  { key: 'موقع التأجير', label: 'موقع التأجير / المشروع' },
  { key: 'رقم التواصل', label: 'رقم التواصل', numeric: true },
  { key: 'الصيانة على', label: 'الصيانة على', options: TERMS_PARTIES },
  { key: 'الوقود على', label: 'الوقود على', options: TERMS_PARTIES },
  { key: 'نقل المركبة على', label: 'نقل المركبة على', options: TERMS_PARTIES },
  { key: 'شروط التأجير', label: 'شروط التأجير', multiline: true },
]

/** vehicleRequired */
export const VEHICLE_REQUIRED: Record<string, string[]> = {
  contract: [K.termMode],
  property: ['تصنيف المركبة', 'نوع المركبة', 'اسم المركبة', 'تاريخ انتهاء الملكية'],
}

/** leasePropertyFields */
export const PROPERTY_FIELDS: FieldSpec[] = [
  { key: 'بيانات العين المؤجرة', label: 'بيانات العين المؤجرة' },
  { key: 'المدينة', label: 'المدينة' },
  { key: 'المنطقة', label: 'المنطقة' },
  { key: 'حوض رقم', label: 'حوض رقم' },
  { key: 'قطعة رقم', label: 'قطعة رقم' },
  { key: 'رقم العين', label: 'رقم العين' },
  { key: 'مساحة العين', label: 'مساحة العين (م٢)', numeric: true },
  { key: K.areaUnit, label: 'وحدة المساحة', options: AREA_UNITS },
  { key: 'نوع الاستخدام', label: 'نوع الاستخدام', options: USAGE_TYPES },
  { key: 'الغرض من استخدام العين', label: 'الغرض من استخدام العين', options: USAGE_PURPOSES },
  { key: 'رقم العقار', label: 'رقم العقار' },
  { key: K.electricCount, label: 'عدد عدادات الكهرباء', numeric: true },
  { key: K.waterCount, label: 'عدد عدادات المياه', numeric: true },
  { key: 'مكونات العين', label: 'مكونات العين', multiline: true },
]

export const LESSOR_FIELDS: FieldSpec[] = [
  { key: K.name, label: 'الإسم' },
  { key: 'رقم الهوية', label: 'رقم الهوية' },
  { key: 'الجنسية', label: 'الجنسية' },
  { key: 'تاريخ انتهاء الهوية', label: 'تاريخ انتهاء الهوية', date: true },
  { key: 'صادرة من', label: 'صادرة من' },
  { key: K.phone, label: 'رقم الهاتف' },
  { key: 'صندوق البريد', label: 'صندوق البريد' },
  { key: 'البريد الإلكتروني', label: 'البريد الإلكتروني' },
  { key: 'رقم الجواز', label: 'رقم الجواز' },
  { key: 'تاريخ انتهاء الجواز', label: 'تاريخ انتهاء الجواز', date: true },
]

export const TENANT_FIELDS: FieldSpec[] = [
  { key: K.name, label: 'الإسم' },
  { key: 'رقم الهوية', label: 'رقم الهوية' },
  { key: 'الجنسية', label: 'الجنسية' },
  { key: 'تاريخ انتهاء الهوية', label: 'تاريخ انتهاء الهوية', date: true },
  { key: 'صادرة من', label: 'صادرة من' },
  { key: K.phone, label: 'رقم الهاتف' },
  { key: 'صندوق البريد', label: 'صندوق البريد' },
  { key: 'رخصة رقم', label: 'رخصة رقم' },
  { key: 'الاسم التجاري', label: 'الاسم التجاري' },
  { key: 'تاريخ انتهاء الرخصة', label: 'تاريخ انتهاء الرخصة', date: true },
  { key: 'مصدر الرخصة', label: 'مصدر الرخصة' },
  { key: 'البريد الإلكتروني', label: 'البريد الإلكتروني' },
]

export const REP_FIELDS: FieldSpec[] = [
  { key: K.repName, label: 'اسم ممثل المستأجر' },
  { key: 'اللقب', label: 'اللقب' },
  { key: 'رقم الهوية', label: 'رقم الهوية' },
  { key: 'الجنسية', label: 'الجنسية' },
  { key: 'تاريخ انتهاء الهوية', label: 'تاريخ انتهاء الهوية', date: true },
  { key: 'صادرة من', label: 'صادرة من' },
  { key: 'رقم الجواز', label: 'رقم الجواز' },
  { key: 'تاريخ انتهاء الجواز', label: 'تاريخ انتهاء الجواز', date: true },
  { key: 'وكالة رقم', label: 'وكالة رقم' },
  { key: 'مصدر الوكالة', label: 'الوكالة صادرة من' },
  { key: 'تاريخ إصدار الوكالة', label: 'تاريخ إصدار الوكالة', date: true },
  { key: 'تاريخ انتهاء الوكالة', label: 'تاريخ انتهاء الوكالة', date: true },
  { key: K.mobile, label: 'رقم الهاتف' },
  { key: 'البريد الإلكتروني', label: 'البريد الإلكتروني' },
]

export const DEPOSIT_FIELDS: FieldSpec[] = [
  { key: K.depositAmount, label: 'مبلغ التأمين', numeric: true },
  { key: K.collectMethod, label: 'طريقة التحصيل', options: COLLECT_METHODS },
  { key: K.paymentCheque, label: 'رقم الشيك', chequeOnly: true },
  { key: K.paymentChequeDate, label: 'تاريخ الشيك (إن وُجد)', date: true, chequeOnly: true },
  { key: K.paymentBank, label: 'اسم البنك', chequeOnly: true },
  { key: 'تاريخ تحصيل التأمين', label: 'تاريخ تحصيل التأمين', date: true, hideForCheque: true },
  { key: 'رقم الإيصال', label: 'رقم الإيصال' },
  { key: 'ملاحظات', label: 'ملاحظات', multiline: true },
]

export const ADMIN_FEE_FIELDS: FieldSpec[] = [
  { key: K.adminFeeType, label: 'نوع الرسم', options: ADMIN_FEE_TYPES },
  { key: K.adminFeeAmount, label: 'قيمة الرسم', numeric: true },
  { key: K.adminFeeDue, label: 'تاريخ الاستحقاق', date: true },
  { key: K.collectMethod, label: 'طريقة التحصيل', options: COLLECT_METHODS },
  { key: 'رقم الإيصال', label: 'رقم الإيصال' },
  { key: 'على من', label: 'يتحمّلها', options: ['المستأجر', 'المؤجر', 'مناصفة'] },
  { key: 'ملاحظات', label: 'ملاحظات', multiline: true },
]

export const PAYMENT_FIELDS: FieldSpec[] = [
  { key: K.paymentFee, label: 'اسم الدفعة' },
  { key: K.paymentAmount, label: 'قيمة الدفعة', numeric: true },
  { key: K.collectMethod, label: 'طريقة التحصيل', options: COLLECT_METHODS },
  { key: K.paymentDue, label: 'تاريخ الاستحقاق', date: true, hideForCheque: true },
  { key: K.paymentCheque, label: 'رقم الشيك', chequeOnly: true },
  { key: K.paymentChequeDate, label: 'تاريخ الشيك', date: true, chequeOnly: true },
  { key: K.paymentReminder, label: 'التذكير', options: PAYMENT_REMINDERS },
  { key: K.paymentReminderDays, label: 'التذكير قبل الاستحقاق بكم يوم', numeric: true, customReminderOnly: true },
  { key: K.paymentBank, label: 'اسم البنك', chequeOnly: true },
  { key: K.bankAccount, label: 'رقم الحساب', chequeOnly: true },
  { key: K.bankBranch, label: 'اسم الفرع', chequeOnly: true },
  { key: K.bankIban, label: 'الآيبان', chequeOnly: true },
  { key: K.paymentNote, label: 'ملاحظات', multiline: true },
]

/** contractRequired */
export const CONTRACT_REQUIRED: Record<string, string[]> = {
  property: ['بيانات العين المؤجرة', 'المدينة', 'المنطقة'],
  lessor: [K.name, 'رقم الهوية', 'تاريخ انتهاء الهوية', K.phone],
  tenant: [K.name, 'رقم الهوية', 'تاريخ انتهاء الهوية', K.phone],
}

/** meterGroups: مفتاح العدد ← (الأرقام، على من، عنوان الرقم، المفتاح القديم). */
export const METER_GROUPS: Record<string, [string, string, string, string]> = {
  [K.electricCount]: [K.electricMeters, K.electricityOn, 'رقم عداد الكهرباء', 'رقم تسجيل الوحدة'],
  [K.waterCount]: [K.waterMeters, K.waterOn, 'رقم عداد المياه', 'معرف العقار'],
}

export function meterCountOf(store: Row, countKey: string) {
  const n = parseInt((store[countKey] ?? '').trim(), 10) || 0
  return n < 0 ? 0 : n > 20 ? 20 : n
}

export function meterLines(raw: string | undefined, count: number) {
  let lines = (raw ?? '').split('\n').map((s) => s.trim())
  if (!(raw ?? '').trim()) lines = []
  while (lines.length < count) lines.push('')
  return lines.slice(0, count)
}

export function migrateMeters(store: Row) {
  for (const [countKey, group] of Object.entries(METER_GROUPS)) {
    const legacy = (store[group[3]] ?? '').trim()
    if (!(store[countKey] ?? '').trim() && legacy) {
      store[countKey] = '1'
      if (!(store[group[0]] ?? '').trim()) store[group[0]] = legacy
    }
    if ((store[countKey] ?? '').trim()) delete store[group[3]]
  }
}

export function mergeMobileIntoPhone(store: Row) {
  const mobile = (store[K.mobile] ?? '').trim()
  if (!mobile) {
    delete store[K.mobile]
    return
  }
  const phone = (store[K.phone] ?? '').trim()
  if (!phone || phone === mobile) {
    store[K.phone] = mobile
    delete store[K.mobile]
  }
}

export const emptyLease = (): Lease => ({ contract: {}, property: {}, lessor: {}, tenant: {}, representative: {}, license: {}, deposits: [], payments: [], adminFees: [], note: '' })

const mapOf = (raw: unknown): Row => (raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])) : {})
const listOf = (raw: unknown): Row[] => (Array.isArray(raw) ? raw.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).map(mapOf) : [])

/** LeaseContractData.decode */
export function decodeLease(raw: string | null | undefined): Lease {
  const text = (raw ?? '').trim()
  if (!text) return emptyLease()
  if (!text.startsWith('{')) return { ...emptyLease(), note: text }
  try {
    const d = JSON.parse(text)
    if (!d || typeof d !== 'object' || d['__lease__'] == null) return { ...emptyLease(), note: text }
    const lessor = mapOf(d.lessor)
    const tenant = mapOf(d.tenant)
    mergeMobileIntoPhone(lessor)
    mergeMobileIntoPhone(tenant)
    return {
      contract: mapOf(d.contract),
      property: mapOf(d.property),
      lessor,
      tenant,
      representative: mapOf(d.representative),
      license: mapOf(d.license),
      deposits: listOf(d.deposits),
      payments: listOf(d.payments),
      adminFees: listOf(d.adminFees),
      note: d.note == null ? '' : String(d.note),
    }
  } catch {
    return { ...emptyLease(), note: text }
  }
}

/** encode — بترتيب toJson. */
export function encodeLease(l: Lease): string {
  return JSON.stringify({
    __lease__: 1,
    contract: l.contract,
    property: l.property,
    lessor: l.lessor,
    tenant: l.tenant,
    representative: l.representative,
    ...(Object.keys(l.license).length ? { license: l.license } : {}),
    deposits: l.deposits,
    payments: l.payments,
    adminFees: l.adminFees,
    note: l.note,
  })
}

export const cloneLease = (l: Lease): Lease => decodeLease(encodeLease(l))

/* ===== الحسابات ===== */

export function num(raw: string | undefined | null) {
  if (raw == null) return 0
  const n = parseFloat(String(raw).replace(/,/g, '').replace(/٬/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

const taxOf = (amount: number, rate: number) => (rate <= 0 ? 0 : (amount * rate) / 100)
export const taxRate = (l: Lease) => num(l.contract[K.taxRate])
export const rentTaxable = (l: Lease) => (l.contract[K.rentTaxable] ?? '').trim() === 'نعم'
export const adminFeesTaxable = (l: Lease) => (l.contract[K.adminFeesTaxable] ?? '').trim() === 'نعم'
export const adminFeesTaxRate = (l: Lease) => {
  const own = num(l.contract[K.adminFeesTaxRate])
  return own > 0 ? own : taxRate(l)
}
export const paymentTaxOf = (l: Lease, row: Row) => (rentTaxable(l) ? taxOf(num(row[K.paymentAmount]), taxRate(l)) : 0)
export const adminFeeTaxOf = (l: Lease, row: Row) => (adminFeesTaxable(l) ? taxOf(num(row[K.adminFeeAmount]), adminFeesTaxRate(l)) : 0)
export const contractScope = (l: Lease) => ((l.contract[K.contractScope] ?? '').trim() === SCOPE_PAYMENTS_ONLY ? SCOPE_PAYMENTS_ONLY : SCOPE_WITH_FEES)
export const includesAdminFees = (l: Lease) => contractScope(l) === SCOPE_WITH_FEES

export function totals(l: Lease) {
  const paymentsTotal = l.payments.reduce((s, r) => s + num(r[K.paymentAmount]), 0)
  const depositsTotal = l.deposits.reduce((s, r) => s + num(r[K.depositAmount]), 0)
  const adminFeesTotal = l.adminFees.reduce((s, r) => s + num(r[K.adminFeeAmount]), 0)
  const paymentsTax = l.payments.reduce((s, r) => s + paymentTaxOf(l, r), 0)
  const adminFeesTax = l.adminFees.reduce((s, r) => s + adminFeeTaxOf(l, r), 0)
  const withFees = includesAdminFees(l)
  const net = paymentsTotal + (withFees ? adminFeesTotal : 0)
  const tax = paymentsTax + (withFees ? adminFeesTax : 0)
  return { paymentsTotal, depositsTotal, adminFeesTotal, paymentsTax, adminFeesTax, net, tax, gross: net + tax }
}

/** missingRequired (عقد العقار). */
export function missingRequired(l: Lease): string[] {
  const v = (m: Row, k: string) => (m[k] ?? '').trim()
  const out: string[] = []
  if (!v(l.contract, K.startDate)) out.push('تاريخ بداية العقد')
  if (!v(l.contract, K.endDate)) out.push('تاريخ نهاية العقد')
  if (!l.payments.length && !v(l.contract, K.multiPrimary)) out.push('دفعات الإيجار')
  if (!v(l.contract, K.contractScope)) out.push('الملخص المالي للعقد')
  // المركبة: بسائق أو بدون، ونمط المدة، وبيانات المركبة الأساسية.
  const vehicle = isVehicleLease(l)
  if (vehicle) {
    if (!v(l.contract, DRIVER_KEY)) out.push('بسائق أو بدون سائق')
    if (!v(l.contract, K.termMode)) out.push('نمط مدة الإيجار')
    for (const key of VEHICLE_REQUIRED.property) if (!v(l.property, key)) out.push(key)
  }
  if (!v(l.tenant, 'تاريخ انتهاء الهوية')) out.push('تاريخ انتهاء هوية المستأجر')
  if (!vehicle && !Object.keys(l.license).length) for (const key of CONTRACT_REQUIRED.property) if (!v(l.property, key)) out.push(key)
  if (!v(l.lessor, K.name)) out.push('اسم المؤجر')
  if (!v(l.lessor, 'رقم الهوية')) out.push('رقم هوية المؤجر')
  if (!v(l.lessor, 'تاريخ انتهاء الهوية')) out.push('تاريخ انتهاء هوية المؤجر')
  if (!v(l.tenant, K.name)) out.push('اسم المستأجر')
  if (!v(l.tenant, 'رقم الهوية')) out.push('رقم هوية المستأجر')
  if (!v(l.lessor, K.phone) && !v(l.lessor, K.mobile)) out.push('رقم هاتف المؤجر')
  if (!v(l.tenant, K.phone) && !v(l.tenant, K.mobile)) out.push('رقم هاتف المستأجر')
  return out
}

/** syncDerivedContractValues */
export function syncDerived(l: Lease) {
  l.contract[K.value] = totals(l).paymentsTotal.toFixed(2)
  l.contract[K.installments] = String(l.payments.length)
}

/** ensureRowIds: معرّف لكل سطر دفعة ورسم وتأمين بلا معرّف. */
export function ensureRowIds(l: Lease): boolean {
  let changed = false
  let seq = 0
  const stamp = (Date.now() * 1000 + Math.floor(Math.random() * 1000)).toString(36)
  for (const list of [l.payments, l.adminFees, l.deposits]) {
    for (const row of list) {
      if ((row[K.rowId] ?? '').trim()) continue
      row[K.rowId] = `${stamp}-${seq++}`
      changed = true
    }
  }
  return changed
}

/** fillPropertyFrom: بيانات العقار المسجّلة دون مسح ما كُتب. */
export function fillPropertyFrom(l: Lease, meta: Row) {
  for (const [k, value] of Object.entries(meta)) {
    if (!value.trim()) continue
    if (!(l.property[k] ?? '').trim()) l.property[k] = value.trim()
  }
}

export const isoDay = (d: Date) => `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const parseDay = (raw: string | undefined | null): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? '').trim())
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
/** _pretty: يوم/شهر/سنة بصفرين. */
export const pretty = (iso: string) => {
  const d = parseDay(iso)
  return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : iso
}

/** _syncContractEndDate: النهاية من البداية ونمط المدة. */
export function syncEndDate(contract: Row) {
  const start = parseDay(contract[K.startDate])
  if (!start) return
  const mode = (contract[K.termMode] ?? '').trim()
  let end: Date | null = null
  if (mode === 'يومي' || mode === 'بالساعات') end = start
  else if (mode === 'شهري') end = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate() - 1)
  else if (mode === 'سنوي') end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1)
  if (end) contract[K.endDate] = isoDay(end)
}

/** _syncChequeDue: مع الشيك تاريخ الشيك هو الاستحقاق. */
export function syncChequeDue(row: Row) {
  if ((row[K.collectMethod] ?? '').trim() !== 'شيك') return
  if (K.depositAmount in row) delete row['تاريخ تحصيل التأمين']
  const cheque = (row[K.paymentChequeDate] ?? '').trim()
  const due = (row[K.paymentDue] ?? '').trim()
  if (cheque) row[K.paymentDue] = cheque
  else if (due) row[K.paymentChequeDate] = due
}

/** _rowProblem */
export function rowProblem(fields: FieldSpec[], row: Row): string | null {
  const keys = new Set(fields.map((f) => f.key))
  const v = (k: string) => (row[k] ?? '').trim()
  if (keys.has(K.paymentFee) && !v(K.paymentFee)) return 'اكتب اسم الدفعة أولًا.'
  for (const key of [K.paymentAmount, K.adminFeeAmount, K.depositAmount]) {
    if (!keys.has(key)) continue
    if (!(num(v(key)) > 0)) return `أدخل مبلغًا أكبر من صفر في «${key}».`
  }
  if (keys.has(K.depositAmount) && !v(K.collectMethod)) return 'اختر طريقة تحصيل التأمين.'
  if (keys.has(K.paymentDue) && v(K.collectMethod) !== 'شيك' && !v(K.paymentDue)) return 'اختر تاريخ الاستحقاق.'
  if (v(K.collectMethod) === 'شيك') {
    const deposit = keys.has(K.depositAmount)
    if (keys.has(K.paymentCheque) && !v(K.paymentCheque)) return 'اكتب رقم الشيك.'
    if (!deposit && keys.has(K.paymentChequeDate) && !v(K.paymentChequeDate)) return 'اختر تاريخ الشيك.'
    if (keys.has(K.paymentBank) && !v(K.paymentBank)) return 'اكتب اسم البنك.'
    if (keys.has(K.bankAccount) && !v(K.bankAccount)) return 'اكتب رقم الحساب.'
  }
  return null
}

/** _sequenceTitle */
export function sequenceTitle(addLabel: string, n: number): { title: string; note: string } {
  const fem = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة']
  const masc = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر']
  const map: Record<string, [string, boolean]> = { 'تسجيل دفعة': ['الدفعة', true], 'تسجيل رسم إداري': ['الرسم الإداري', false], 'تسجيل تأمين': ['التأمين', false] }
  const entry = map[addLabel]
  if (!entry) return { title: addLabel, note: '' }
  const [noun, feminine] = entry
  const nth = (k: number) => {
    const list = feminine ? fem : masc
    return k >= 1 && k <= list.length ? list[k - 1] : `رقم ${k}`
  }
  return { title: `تسجيل ${noun} ${nth(n)}`, note: n > 1 ? `تم حفظ ${noun} ${nth(n - 1)} ✓` : '' }
}

/** التوزيع التلقائي: دفعات متساوية والفرق على الأخيرة. */
export const DISTRIBUTE_PERIODS: Record<string, number> = { شهري: 1, 'كل شهرين': 2, 'ربع سنوي': 3, 'نصف سنوي': 6, سنوي: 12 }
const ORDINALS = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة', 'الحادية عشرة', 'الثانية عشرة']
export function distribute(total: number, count: number, period: string, first: Date, method: string): Row[] {
  const step = DISTRIBUTE_PERIODS[period] ?? 1
  const base = Math.floor((total / count) * 100) / 100
  const rows: Row[] = []
  for (let i = 0; i < count; i++) {
    const monthIndex = first.getMonth() + 1 + i * step
    const year = first.getFullYear() + Math.floor((monthIndex - 1) / 12)
    const month = ((monthIndex - 1) % 12) + 1
    const lastDay = new Date(year, month, 0).getDate()
    const day = first.getDate() > lastDay ? lastDay : first.getDate()
    const amount = i === count - 1 ? total - base * (count - 1) : base
    rows.push({
      [K.paymentFee]: i < ORDINALS.length ? `الدفعة ${ORDINALS[i]}` : `الدفعة ${i + 1}`,
      [K.paymentAmount]: amount.toFixed(2),
      [K.paymentDue]: isoDay(new Date(year, month - 1, day)),
      [K.collectMethod]: method,
      [K.paymentStatus]: 'مستحقة',
    })
  }
  return rows
}

/** toShareText — النص الذي يُراجَع ويُشارك. */
export function shareText(l: Lease): string {
  const out: string[] = []
  const section = (title: string, values: Row) => {
    const filled = Object.entries(values).filter(([, v]) => v.trim())
    if (!filled.length) return
    out.push(`— ${title} —`)
    for (const [k, v] of filled) out.push(`${k === K.mobile ? K.phone : k}: ${v}`)
    out.push('')
  }
  const t = totals(l)
  out.push('عقد إيجار', '')
  const contract = { ...l.contract }
  delete contract[K.subject]
  delete contract[K.paymentsNote]
  section('بيانات عقد الإيجار', contract)
  const license = { ...l.license }
  for (const key of [K.licenseReminder, K.licenseReminderDays, K.leaseReminder, K.leaseReminderDays]) delete license[key]
  section('بيانات الرخصة', license)
  section('بيانات العقار', l.property)
  section('بيانات المؤجر', l.lessor)
  section('بيانات المستأجر', l.tenant)
  section('بيانات ممثل المستأجر', l.representative)
  if (l.deposits.length) {
    out.push('— قيمة التأمين على العين —')
    for (const r of l.deposits) out.push(`${r[K.depositAmount] ?? ''} · ${r[K.collectMethod] ?? ''} · ${r['تاريخ تحصيل التأمين'] ?? ''} · إيصال ${r['رقم الإيصال'] ?? ''}`)
    out.push('')
  }
  if (l.payments.length) {
    out.push('— طريقة سداد دفعات الإيجار —')
    for (const r of l.payments) {
      const tax = paymentTaxOf(l, r)
      out.push(`${r[K.paymentFee] ?? ''}: ${r[K.paymentAmount] ?? ''}${tax > 0 ? ` + ضريبة ${tax.toFixed(2)}` : ''} · استحقاق ${r[K.paymentDue] ?? ''} · شيك ${r[K.paymentCheque] ?? ''} (${r[K.paymentBank] ?? ''})`)
    }
    out.push(`الإجمالي بدون ضريبة: ${t.paymentsTotal.toFixed(2)}`)
    if (t.paymentsTax > 0) out.push(`الإجمالي بضريبة: ${(t.paymentsTotal + t.paymentsTax).toFixed(2)}`)
    const pn = (l.contract[K.paymentsNote] ?? '').trim()
    if (pn) out.push(`ملاحظات: ${pn}`)
    out.push('')
  }
  if (l.adminFees.length && includesAdminFees(l)) {
    out.push('— مبالغ رسوم إدارية —')
    for (const r of l.adminFees) {
      const tax = adminFeeTaxOf(l, r)
      out.push(`${r[K.adminFeeType] ?? ''}: ${r[K.adminFeeAmount] ?? ''}${tax > 0 ? ` + ضريبة ${tax.toFixed(2)}` : ''} · استحقاق ${r[K.adminFeeDue] ?? ''} · يتحمّلها ${r['على من'] ?? ''}`)
    }
    out.push(`الإجمالي بدون ضريبة: ${t.adminFeesTotal.toFixed(2)}`)
    if (t.adminFeesTax > 0) out.push(`الإجمالي بضريبة: ${(t.adminFeesTotal + t.adminFeesTax).toFixed(2)}`)
    out.push('')
  }
  out.push('— الملخص المالي —', `محتوى العقد: ${contractScope(l)}`, `الإجمالي بدون ضريبة: ${t.net.toFixed(2)}`)
  if (t.tax > 0) out.push(`الضريبة: ${t.tax.toFixed(2)}`, `الإجمالي بضريبة: ${t.gross.toFixed(2)}`)
  if (t.depositsTotal > 0) out.push(`التأمين (مسترد، خارج الإجمالي): ${t.depositsTotal.toFixed(2)}`)
  if ((l.contract[K.signedAt] ?? '').trim()) {
    out.push('', `وُقِّع وخُتم إلكترونيًا في ${l.contract[K.signedAt]}${(l.contract[K.signedBy] ?? '').trim() ? ` — ${l.contract[K.signedBy]}` : ''}`)
  }
  out.push('')
  if (l.note.trim()) out.push(`ملاحظات: ${l.note}`)
  return out.join('\n') + '\n'
}

/* ===== رقم العقد ===== */

/** leaseContractNumber */
export function contractNumber(c: Pick<UnitContract, 'id' | 'notes'>): string {
  const written = (decodeLease(c.notes).contract[K.newNo] ?? '').trim()
  if (written) return written
  if (!c.id) return ''
  const digits = c.id.replace(/[^0-9]/g, '')
  const source = digits || c.id.replace(/-/g, '')
  return source.length <= 11 ? source : source.slice(0, 11)
}

/** _fillContractNumbers: التالي (أقصى رقم + 1 بأربع خانات) والسابق للوحدة. */
export function contractNumbers(all: UnitContract[], unitKey: string, existing?: UnitContract): { next: string; previous: string } {
  let previous: UnitContract | null = null
  const at = (c: UnitContract) => parseDay(c.start_date)?.getTime() ?? new Date(1900, 0, 1).getTime()
  for (const c of all) {
    if (c.unit_key !== unitKey) continue
    if (existing) {
      if (c.id === existing.id) continue
      const mine = parseDay(existing.start_date)
      const theirs = parseDay(c.start_date)
      if (mine && theirs && !(theirs.getTime() < mine.getTime())) continue
    }
    if (!previous || at(c) > at(previous)) previous = c
  }
  let max = 0
  for (const c of all) {
    const text = contractNumber(c)
    if (!/^-?\d+$/.test(text)) continue
    const n = parseInt(text, 10)
    if (n < 100000 && n > max) max = n
  }
  return { next: String(max + 1).padStart(4, '0'), previous: previous ? contractNumber(previous) : '' }
}

/* ===== ربط الدفعات بالجدول (syncLeasePaymentRecords) ===== */

export const PAY = {
  kind: 'نوع البند',
  name: 'اسم البند',
  rowId: 'معرّف البند',
  method: 'طريقة الدفع',
  cheque: 'رقم الشيك',
  rent: 'دفعة إيجارية',
  fee: 'رسوم إدارية',
  deposit: 'تأمين',
} as const

export function encodePayExtra(data: Row): string {
  const clean: Record<string, unknown> = { __pay__: 1 }
  for (const [k, v] of Object.entries(data)) if (v.trim()) clean[k] = v.trim()
  return JSON.stringify(clean)
}

/** payStatusFor */
export const payStatusFor = (due: number, paid: number) => (due > 0 && paid + 0.009 >= due ? 'paid' : paid > 0.009 ? 'partial' : 'pending')

type Due = { rowId: string; kind: string; name: string; amount: number; dueDate: string | null; method: string; cheque: string; initialPaid: number }

const dayOnly = (raw: string | undefined | null) => {
  const d = parseDay(raw)
  return d ? isoDay(d) : null
}

function depositDue(row: Row, today: string): Due {
  const amount = num(row[K.depositAmount])
  const method = (row[K.collectMethod] ?? '').trim()
  if (method === 'شيك') {
    return { rowId: row[K.rowId] ?? '', kind: PAY.deposit, name: 'تأمين العقد', amount, dueDate: dayOnly(row[K.paymentChequeDate]), method, cheque: (row[K.paymentCheque] ?? '').trim(), initialPaid: 0 }
  }
  const date = dayOnly(row['تاريخ تحصيل التأمين'])
  return { rowId: row[K.rowId] ?? '', kind: PAY.deposit, name: 'تأمين العقد', amount, dueDate: date, method, cheque: (row[K.paymentCheque] ?? '').trim(), initialPaid: date && !(date > today) ? amount : 0 }
}

const localStamp = () => {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export async function syncLeasePayments(contract: UnitContract): Promise<boolean> {
  if (!contract.id) return false
  const lease = decodeLease(contract.notes)
  let wrote = false
  const user = await uid()
  if (ensureRowIds(lease)) {
    const { error } = await supabase.from('property_unit_contracts').update({ notes: encodeLease(lease) }).eq('id', contract.id)
    if (error) throw error
    wrote = true
  }
  const start = dayOnly(contract.start_date)
  const today = isoDay(new Date())
  const wanted: Due[] = [
    ...lease.payments
      .filter((r) => num(r[K.paymentAmount]) > 0)
      .map((r) => {
        const amount = num(r[K.paymentAmount]) + paymentTaxOf(lease, r)
        return {
          rowId: r[K.rowId] ?? '',
          kind: PAY.rent,
          name: (r[K.paymentFee] ?? '').trim() || 'دفعة إيجارية',
          amount,
          dueDate: dayOnly(r[K.paymentDue]) ?? start,
          method: (r[K.collectMethod] ?? '').trim(),
          cheque: (r[K.paymentCheque] ?? '').trim(),
          initialPaid: (r[K.paymentStatus] ?? '') === 'مسددة' ? amount : 0,
        }
      }),
    ...lease.adminFees
      .filter((r) => num(r[K.adminFeeAmount]) > 0)
      .map((r) => ({
        rowId: r[K.rowId] ?? '',
        kind: PAY.fee,
        name: (r[K.adminFeeType] ?? '').trim() || 'رسوم إدارية',
        amount: num(r[K.adminFeeAmount]) + adminFeeTaxOf(lease, r),
        dueDate: dayOnly(r[K.adminFeeDue]) ?? start,
        method: (r[K.collectMethod] ?? '').trim(),
        cheque: '',
        initialPaid: 0,
      })),
    ...lease.deposits.filter((r) => num(r[K.depositAmount]) > 0).map((r) => depositDue(r, today)),
  ]
  const { data, error } = await supabase.from('property_unit_payments').select('*').eq('contract_id', contract.id).order('due_date', { ascending: true })
  if (error) throw error
  const current = (data ?? []) as UnitPayment[]
  const byRow = new Map<string, UnitPayment>()
  for (const p of current) {
    const rid = (payExtra(p.notes)[PAY.rowId] ?? '').trim()
    if (rid) byRow.set(rid, p)
  }
  const seen = new Set<string>()
  for (const due of wanted) {
    if (!due.rowId) continue
    seen.add(due.rowId)
    const old = byRow.get(due.rowId)
    const extra: Row = { ...payExtra(old?.notes ?? null), [PAY.kind]: due.kind, [PAY.name]: due.name, [PAY.rowId]: due.rowId }
    if (due.method) extra[PAY.method] = due.method
    if (due.cheque) extra[PAY.cheque] = due.cheque
    const paid = old ? Number(old.amount_paid) || 0 : due.initialPaid
    const dueDate = due.kind === PAY.deposit ? due.dueDate : due.dueDate ?? dayOnly(old?.due_date)
    const next = {
      user_id: user,
      contract_id: contract.id,
      due_date: dueDate,
      amount_due: due.amount,
      amount_paid: paid,
      paid_at: old?.paid_at ?? (paid > 0 ? localStamp() : null),
      status: payStatusFor(due.amount, paid),
      reference_no: due.cheque ? due.cheque : old?.reference_no ?? null,
      notes: encodePayExtra(extra),
    }
    if (
      old &&
      Math.abs((Number(old.amount_due) || 0) - next.amount_due) < 0.009 &&
      Math.abs((Number(old.amount_paid) || 0) - next.amount_paid) < 0.009 &&
      dayOnly(old.due_date) === next.due_date &&
      old.status === next.status &&
      (old.reference_no ?? '') === (next.reference_no ?? '') &&
      (old.notes ?? '') === next.notes
    )
      continue
    const res = old ? await supabase.from('property_unit_payments').update(next).eq('id', old.id).select('id') : await supabase.from('property_unit_payments').insert(next).select('id')
    if (res.error) throw res.error
    wrote = true
  }
  for (const [rid, p] of byRow) {
    if (seen.has(rid) || (Number(p.amount_paid) || 0) > 0.009) continue
    const { error: delError } = await supabase.from('property_unit_payments').delete().eq('id', p.id)
    if (delError) throw delError
    wrote = true
  }
  return wrote
}

/** _registerPaymentReminders: «lease_payment_<rid>» لكل دفعة لها تذكير وتاريخ. */
export async function leaseReminders(l: Lease, subject: string, tenantName: string) {
  const upserts: Reminder[] = []
  const removes: string[] = []
  for (const row of l.payments) {
    const rowId = (row[K.rowId] ?? '').trim()
    if (!rowId) continue
    const id = `lease_payment_${rowId}`
    const r = row[K.paymentReminder] ?? ''
    const days = r === 'قبل شهر' ? 30 : r === 'قبل شهرين' ? 60 : r === REMINDER_CUSTOM ? parseInt((row[K.paymentReminderDays] ?? '').trim(), 10) || 0 : 0
    const due = parseDay(row[K.paymentDue])
    if (days <= 0 || !due) {
      removes.push(id)
      continue
    }
    const name = (row[K.paymentFee] ?? '').trim()
    upserts.push({
      id,
      title: [`استحقاق ${name || 'دفعة إيجار'}`, subject.trim(), tenantName].filter(Boolean).join(' — '),
      module: 'العقارات',
      expiryDate: `${isoDay(due)}T00:00:00.000`,
      remindBeforeDays: days,
    })
  }
  await changeReminders(upserts, removes).catch(() => {})
}

/** _syncPeopleDirectory: المؤجر والمستأجر (أو جهة إن كان له رخصة) والممثل. */
export async function syncLeasePeople(l: Lease, source: string) {
  const without = (m: Row, key: string) => {
    const out = { ...m }
    delete out[key]
    return out
  }
  const lessorName = (l.lessor[K.name] ?? '').trim()
  if (lessorName) await upsertDirectoryPerson({ fullName: lessorName, typeKey: 'person_landlord', categoryName: 'مؤجر', roleTitle: 'مؤجر', details: without(l.lessor, K.name), sourceNote: source })
  const tenantName = (l.tenant[K.name] ?? '').trim()
  if (tenantName) {
    const company = !!(l.tenant['رخصة رقم'] ?? '').trim() || !!(l.tenant['الاسم التجاري'] ?? '').trim()
    await upsertDirectoryPerson({
      fullName: tenantName,
      typeKey: company ? 'entity_company' : 'person_tenant',
      categoryName: company ? 'الشركات' : 'مستأجر',
      roleTitle: 'مستأجر',
      details: without(l.tenant, K.name),
      sourceNote: source,
    })
  }
  const repName = (l.representative[K.repName] ?? '').trim()
  if (repName) {
    const details = without(l.representative, K.repName)
    if (tenantName) details['يمثّل'] = tenantName
    await upsertDirectoryPerson({ fullName: repName, typeKey: 'person_representative', categoryName: 'مندوب', roleTitle: 'ممثل مستأجر', details, sourceNote: source })
  }
}

/** دورة الدفع من عدد الدفعات (_save). */
export const cycleOf = (installments: number, fallback = 'سنوي') => ({ 1: 'سنوي', 2: 'نصف سنوي', 4: 'ربع سنوي', 12: 'شهري' })[installments] ?? fallback

/**
  _save (عقد وحدة واحدة): العقد ← جدول العقود، ثم التذكيرات، ثم الدفعات،
  ثم الأفراد والجهات. يعيد العقد المحفوظ ورسالة إن تعذّر توليد الدفعات.
*/
export async function saveUnitLease(args: {
  lease: Lease
  draft: boolean
  assetId: string
  unitKey: string
  unitName: string
  propertyTitle: string
  existing?: UnitContract
  /** عقد متعدد الوحدات: كل الوحدات المختارة بترتيبها (الأولى تحمل الدفعات). */
  multi?: { key: string; name: string }[]
  /** «عقد إيجار النشاط — …» مصدر الأفراد والجهات. */
  peopleSource?: string
}): Promise<{ saved: UnitContract; paymentsIssue?: string }> {
  const { lease, draft, assetId, unitKey, unitName, propertyTitle, existing, multi } = args
  const user = await uid()
  const tenantName = (lease.tenant[K.name] ?? '').trim()
  ensureRowIds(lease)
  const t = totals(lease)
  const value = num(lease.contract[K.value]) || t.paymentsTotal
  const installments = parseInt(lease.contract[K.installments] ?? '', 10) || lease.payments.length
  const phone = (lease.tenant[K.phone] ?? '').trim() || (lease.tenant[K.mobile] ?? '').trim() || null
  const row = {
    user_id: user,
    asset_id: assetId,
    unit_key: unitKey,
    unit_name: unitName,
    tenant_name: tenantName || 'بلا اسم',
    tenant_phone: phone,
    lease_type: existing?.lease_type ?? 'standard',
    annual_rent: value,
    payment_cycle: cycleOf(installments, existing?.payment_cycle ?? 'سنوي'),
    start_date: dayOnly(lease.contract[K.startDate]),
    end_date: dayOnly(lease.contract[K.endDate]),
    status: draft ? 'pending' : 'active',
    notes: encodeLease(lease),
    group_key: (existing as (UnitContract & { group_key?: string | null }) | undefined)?.group_key ?? null,
  }
  let saved: UnitContract
  if (multi && !existing) {
    // _save: عقد لكل وحدة بنفس المجموعة، والإيجار موزّع بالتساوي، والدفعات
    // والرسوم والتأمين على الأولى وحدها.
    const groupKey = `grp_${Date.now() * 1000}`
    const share = value / multi.length
    let primary: UnitContract | null = null
    for (let i = 0; i < multi.length; i++) {
      let notes = row.notes
      if (i > 0) {
        const copy = decodeLease(encodeLease(lease))
        copy.payments = []
        copy.adminFees = []
        copy.deposits = []
        copy.contract[K.multiPrimary] = multi[0].name
        notes = encodeLease(copy)
      }
      const one = { ...row, unit_key: multi[i].key, unit_name: multi[i].name, lease_type: 'multi_unit', group_key: groupKey, annual_rent: share, notes }
      const r = await supabase.from('property_unit_contracts').insert(one).select('*').single()
      if (r.error) throw r.error
      primary ??= { ...one, ...(r.data as object) } as unknown as UnitContract
    }
    saved = primary!
  } else {
    const res = existing ? await supabase.from('property_unit_contracts').update(row).eq('id', existing.id).select('*').single() : await supabase.from('property_unit_contracts').insert(row).select('*').single()
    if (res.error) throw res.error
    saved = { ...row, ...(res.data as object) } as unknown as UnitContract
  }
  if (!saved.id) throw new AssetError('تعذّر حفظ العقد')
  await leaseReminders(lease, unitName || propertyTitle, tenantName)
  let paymentsIssue: string | undefined
  try {
    await syncLeasePayments(saved)
  } catch (e) {
    paymentsIssue = String((e as { message?: string }).message ?? e)
  }
  await syncLeasePeople(lease, args.peopleSource ?? `عقد إيجار ${unitName} — ${propertyTitle}`).catch(() => {})
  return { saved, paymentsIssue }
}

/* ===== التوقيع والختم المحفوظان (user_signature_strokes_v1 / user_stamp_image_v1) ===== */

export function signatureStrokes(raw: unknown): [number, number][][] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const decoded = JSON.parse(raw)
    if (!Array.isArray(decoded)) return []
    return decoded
      .filter(Array.isArray)
      .map((stroke: unknown[]) => stroke.filter(Array.isArray).map((p) => [Number((p as number[])[0]) || 0, Number((p as number[])[1]) || 0] as [number, number]))
      .filter((s) => s.length)
  } catch {
    return []
  }
}

/** صيانة «تمنع التأجير» مفتوحة على الوحدة (_unitMaintBlocksLease). */
export function maintBlocksLease(extras: Row): boolean {
  const raw = extras['سجل الصيانة'] ?? ''
  if (!raw) return false
  try {
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows)) return false
    return rows.some((e) => e && typeof e === 'object' && String(e['حالة الصيانة'] ?? '') === 'تحت الصيانة' && String(e['أثر الصيانة على الإيجار'] ?? '') === 'تمنع التأجير')
  } catch {
    return false
  }
}
