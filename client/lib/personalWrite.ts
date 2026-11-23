import { supabase } from './supabase'
import { PERSONAL_SLUG } from './catalog'
import { docDisplayName, type Entry } from './data'
import { EXPENSE_SUBCATEGORIES, FINE_SUBCATEGORIES, FORMS, INCOME_SUBCATEGORIES, type EntryForm, type FormField } from './personalForms.gen'

/*
  الإضافة والتعديل في «أنا» (personal_entries) بنفس طريقة التطبيق حرفيًا:
  - النماذج وحقولها وخياراتها مولَّدة من التطبيق (personalForms.gen.ts).
  - الحفظ ينقل _saveFinancialEntry: التفاصيل = كل حقل غير فارغ باسمه، ثم
    استبدال «+ إضافة أخرى» و«مخصص» بما كُتب، والعنوان والاستحقاق والمبلغ
    من الحقول نفسها، والتعديل يُبقي ما ليس في النموذج ويضيف «سجل التعديلات».
  - التعديل والأرشفة والحذف تمر بدمج RecordMerge مع أحدث نسخة في الخادم
    (SupabasePersonalEntriesRepository._mergeWithLatest)، فلا يُمحى تعديل
    حُفظ من التطبيق في الوقت نفسه.
  - الحذف نقل إلى سلة المحذوفات (TrashStore.markDeleted) لا محو.

  الدين والعهدة: إن كُتب رقم تعريفي للطرف الثاني يُدمج الإسناد «بانتظار
  القبول» في التفاصيل (_withCustodyAssignment)، والخادم يرسل الطلب إليه.
  القسط: جدول الأقساط «القسط N» = «التاريخ — المبلغ العملة»، والاستحقاق
  أقرب قسط قادم.

  الأدوية: نمط الجرعات يكشف حقله وحده، وتسجيل التناول والتأجيل والتخطي
  سطر في «سجل الجرعات».

  بدء عهدة جديدة / كورس جديد (newCourse): نفس السجل، والحالي ينتقل إلى
  «سجل العهد السابقة» (عهدة رقم N بكل معلوماتها وصرفياتها) أو «سجل الكورسات»
  (كورس N)، والرقم يزيد واحدًا والحالة «نشطة». ودواء آخر من نفس الوصفة: سجل
  جديد بنفس البيانات، والاسم والجرعة والقياسات فارغة، ويُجمع بمعرّف أولها
  («مجموعة الوصفة»).
*/

export { FORMS }
export type { EntryForm, FormField }

const TABLE = 'personal_entries'
const BUCKET = 'personal-entry-attachments'
export const STATUS_ACTIVE = 'نشطة'
export const ADD_OTHER = '+ إضافة أخرى'
export const CUSTOM = 'مخصص'
export const LEAD_HOURS = 'مخصص بالساعات'
export const LEAD_DAYS = 'مخصص بالأيام'
const EDIT_LOG_KEY = 'سجل التعديلات'
export const CUSTODY_LOG_KEY = 'سجل العهد السابقة'
export const COURSE_LOG_KEY = 'سجل الكورسات'
const PRESCRIPTION_GROUP_KEY = 'مجموعة الوصفة'
/** ما يتغيّر بين أدوية الوصفة الواحدة (_perMedicineFields). */
const PER_MEDICINE_FIELDS = ['اسم الدواء', 'الاسم العلمي', 'الجرعة', 'وحدة الجرعة', 'التركيز', 'شكل الدواء']
const REMINDER_LABELS = new Set(['تذكيرات', 'تذكير', 'التذكيرات'])

/** قائمة الإضافة كما في التطبيق (_entryCategories) بالأنواع المتاحة في الموقع. */
export const ADD_MENU: { group: string; title: string; subtitle: string; types: string[] }[] = [
  { group: 'financial', title: 'مالية', subtitle: 'مصروفات وإيرادات وديون', types: ['المصروفات الشخصية', 'إيراد', 'دين / قرض / سلفة', 'قسط', 'غرامة'] },
  { group: 'document', title: 'مستند', subtitle: 'وثائق وملفات مهمة', types: ['مستند'] },
  { group: 'organization', title: 'المتابعة والتخطيط', subtitle: 'مهام ومواعيد وعادات', types: ['مهمة', 'موعد', 'عادة', 'تذكير', 'ملاحظات'] },
  { group: 'medical_accounts', title: 'أدوية وبيانات وكلمات سر', subtitle: 'الأدوية والحسابات وكلمات المرور', types: ['أدوية', 'كلمات سر'] },
  { group: 'lifestyle', title: 'نمط الحياة', subtitle: 'مناسبات واشتراكات وهدايا', types: ['مناسبة', 'اشتراك', 'هدية'] },
  { group: 'location', title: 'مواقع وأماكن', subtitle: 'أماكن ومواقع مهمة', types: ['مواقع وأماكن'] },
  { group: 'custody', title: 'عهدة مالية', subtitle: 'مبالغ تحت مسؤولية شخص', types: ['عهدة مالية'] },
]

/** أنواع تُضاف من التطبيق فقط (تحتاج ما لا يوفره الموقع). */
export const APP_ONLY_TYPES: string[] = []

/** _dateRangeStart و_distinctTimes في التطبيق. */
const DATE_RANGE_START: Record<string, string> = {
  'إلى تاريخ': 'من تاريخ',
  'تاريخ نهاية التفويض': 'تاريخ بداية التفويض',
  'تاريخ الاستحقاق': 'تاريخ الدين',
  'تاريخ الانتهاء': 'تاريخ الإصدار',
  'تاريخ الاستلام': 'تاريخ البداية',
}
const DISTINCT_TIMES: Record<string, string> = { 'وقت إضافي': 'وقت الجرعة' }

// ---------------- الإسناد بالرقم التعريفي (الدين والعهدة) ----------------

export const DEBT_ID_LABEL = 'الرقم التعريفي للطرف الثاني'
export const CUSTODY_ID_LABEL = 'الرقم التعريفي للمستلم'
export const CUSTODY_APPROVAL_LABEL = 'اعتماد المصروفات'
export const CUSTODY_APPROVAL_REQUIRED = 'بموافقة صاحب العهدة'
export const CUSTODY_APPROVAL_NONE = 'بدون موافقة'
const SHARED_TYPES = new Set(['عهدة مالية', 'دين / قرض / سلفة'])
const ASSIGNMENT_KEYS = ['عهدة_مالك_المعرّف', 'عهدة_مالك_الاسم', 'عهدة_مسندة_إلى', 'عهدة_المسند_إليه_الاسم', 'عهدة_حالة_الإسناد', 'عهدة_تاريخ_الإسناد', 'عهدة_ملاحظة_الإسناد', 'عهدة_تاريخ_الرد']

/** AppIdentity.normalize / isValid */
export const normalizeFnd = (value: string) => value.trim().toUpperCase().replace(/ /g, '')
export const isValidFnd = (value: string) => /^FND-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(value.trim())

/** من أنا عند الإسناد: رقمي والاسم الظاهر للآخرين. */
export type Me = { fnd: string; name: string }

const idLabelOf = (type: string) => (type === 'عهدة مالية' ? CUSTODY_ID_LABEL : DEBT_ID_LABEL)

/** اسم صاحب الرقم كما هو مسجَّل عنده (FundlyAccount.nameForFnd). */
export async function nameForFnd(fnd: string): Promise<string> {
  try {
    const { data } = await supabase.rpc('fundly_name_by_fnd', { p_fnd: fnd })
    const name = String(data ?? '').trim()
    return name === 'null' ? '' : name
  } catch {
    return ''
  }
}

/** _withCustodyAssignment: إسناد «بانتظار القبول» لمن كُتب رقمه. */
function withAssignment(type: string, details: Record<string, string>, holderName: string, me: Me): Record<string, string> {
  if (!SHARED_TYPES.has(type)) return details
  const idLabel = idLabelOf(type)
  const holderId = normalizeFnd(details[idLabel] ?? '')
  if (!isValidFnd(holderId) || holderId === me.fnd) return details
  const n = new Date()
  const stamp = `${n.getDate()}/${n.getMonth() + 1}/${n.getFullYear()} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`
  const out: Record<string, string> = { ...details, [idLabel]: holderId }
  const put = (key: string, value: string) => {
    if (value.trim()) out[key] = value.trim()
    else delete out[key]
  }
  put('عهدة_مالك_المعرّف', me.fnd)
  put('عهدة_مالك_الاسم', me.name)
  put('عهدة_مسندة_إلى', holderId)
  put('عهدة_المسند_إليه_الاسم', holderName)
  put('عهدة_حالة_الإسناد', 'بانتظار القبول')
  put('عهدة_تاريخ_الإسناد', stamp)
  delete out['عهدة_ملاحظة_الإسناد']
  return out
}

const holderNameOf = (details: Record<string, string>) => (details['اسم المستلم'] ?? '').trim() || (details['اسم الجهة'] ?? '').trim()

// ---------------- جدول الأقساط ----------------

export type Installment = { date: string; amount: string }

/** fmtAmount: بلا كسور إن كان صحيحًا، وإلا خانتان. */
const fmtAmount = (v: number) => (v === Math.round(v) ? v.toFixed(0) : v.toFixed(2))

/** الأقساط المحفوظة «القسط N» = «التاريخ — المبلغ العملة». */
export function savedInstallments(entry: Entry | undefined, count: number): Installment[] {
  const rows: Installment[] = []
  for (let i = 1; i <= count; i++) {
    const saved = String(entry?.details?.[`القسط ${i}`] ?? '')
    const parts = saved.split(' — ')
    rows.push({ date: parts[0].trim(), amount: parts.length > 1 ? (parts[1].match(/[\d.]+/)?.[0] ?? '') : '' })
  }
  return rows
}

export const installmentCount = (raw: string) => Math.min(120, Math.max(0, parseInt(latin((raw ?? '').trim()), 10) || 0))

/** بالتساوي: الإجمالي ÷ العدد، والفرق على آخر قسط (autoSplit). */
export function splitEqually(totalRaw: string, rows: Installment[]): Installment[] {
  const total = parseFloat(latin((totalRaw ?? '').trim())) || 0
  if (total <= 0 || !rows.length) return rows
  const count = rows.length
  const each = Math.floor((total / count) * 100) / 100
  return rows.map((r, i) => ({ ...r, amount: fmtAmount(i === count - 1 ? total - each * (count - 1) : each) }))
}

/** _addMonthsClamped: 31 يناير ← 28 فبراير. */
export function addMonthsClamped(d: Date, months: number): Date {
  const total = d.getMonth() + months
  const year = d.getFullYear() + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(d.getDate(), last))
}

export function parseDmy(value: string): Date | null {
  const p = value.trim().split('/')
  if (p.length !== 3) return null
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  if ([d, m, y].some(Number.isNaN)) return null
  return new Date(y, m - 1, d)
}

/** التفاصيل الإضافية للقسط والاستحقاق = أقرب قسط قادم. */
function installmentExtra(rows: Installment[], equalSplit: boolean, unit: string): { extra: Record<string, string>; due?: string } {
  const extra: Record<string, string> = {}
  const dates: Date[] = []
  rows.forEach((r, i) => {
    extra[`القسط ${i + 1}`] = `${r.date.trim()} — ${r.amount.trim()} ${unit}`
    const parsed = parseDmy(r.date)
    if (parsed) dates.push(parsed)
  })
  extra['تقسيم القسط بالتساوي'] = equalSplit ? 'نعم' : 'لا'
  if (!dates.length) return { extra }
  dates.sort((a, b) => a.getTime() - b.getTime())
  extra['تاريخ القسط الأول'] = dmy(dates[0])
  extra['تاريخ آخر قسط'] = dmy(dates[dates.length - 1])
  const n = new Date()
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate())
  return { extra, due: dmy(dates.find((d) => d >= today) ?? dates[dates.length - 1]) }
}

/** ما يلزم الحفظ غير حقول النموذج. */
export type SaveExtras = {
  me: Me
  installments?: Installment[]
  equalSplit?: boolean
  link?: Record<string, string>
  /** بدء عهدة جديدة / كورس جديد على السجل نفسه. */
  newCourse?: boolean
  /** دواء آخر من نفس الوصفة: الدواء الذي نُسخ منه. */
  prescriptionOf?: Entry
}

/** هل يُعدَّل هذا السجل من الموقع؟ (صاحبه أنا. والنوع القديم بلا نموذج: «تعديل الالتزام» العام) */
export function canEdit(entry: Entry, userId: string | undefined): boolean {
  return !!userId && entry.user_id === userId && entry.status !== 'محذوف'
}

/** نوع قديم بلا نموذج إضافة: يُعدَّل بالنموذج العام (_openEditForm). */
export const isLegacyType = (entry: Entry) => !(entry.entry_type in FORMS)

// ---------------- الحقول ----------------

export type Values = Record<string, string>

/** _isFieldVisible */
export function isVisible(field: FormField, values: Values): boolean {
  if (field.label === 'التصنيف الفرعي') return false
  if (field.hidden) return false
  // الأدوية: كل نمط جرعات يكشف حقله الخاص فقط.
  if ('نمط الجرعات' in values) {
    const pattern = (values['نمط الجرعات'] ?? '').trim()
    if (field.label === 'كل كم ساعة') return pattern === 'كل عدد من الساعات'
    if (field.label === 'أيام الأسبوع') return pattern === 'أيام أسبوع محددة'
    if (field.label === 'كل كم يوم') return pattern === 'كل عدد من الأيام'
    if (field.label === 'تواريخ مخصصة') return pattern === 'تواريخ مخصصة'
  }
  if (field.label === 'التذكير قبل الموعد' && 'تفعيل التذكيرات' in values) return values['تفعيل التذكيرات'] === 'نعم'
  if ((field.label === 'التكرار' || field.label === 'وقت التذكير') && 'تفعيل تذكير' in values) return values['تفعيل تذكير'] === 'نعم'
  if ((field.label === 'التكرار' || field.label === 'اليوم') && 'تفعيل عملية متكررة' in values)
    return values['تفعيل عملية متكررة'] === 'نعم'
  return true
}

/** _subcategoriesForEntry بلا «+ إضافة أخرى». */
export function subcategoriesFor(entryLabel: string, main: string): string[] {
  const table = entryLabel === 'إيراد' ? INCOME_SUBCATEGORIES : entryLabel === 'غرامة' ? FINE_SUBCATEGORIES : EXPENSE_SUBCATEGORIES
  return table[main] ?? []
}

/** خيارات القائمة كما يعرضها التطبيق. */
export function optionsOf(field: FormField): string[] {
  const options = [...(field.options ?? [])]
  if (field.allowCustom && !options.includes(ADD_OTHER)) options.push(ADD_OTHER)
  return options
}

const latin = (raw: string) => raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))

/** reminderLeadValue */
function reminderLeadValue(option: string, number: string): string {
  const n = parseInt(latin(number.trim()), 10) || 0
  if (option === LEAD_HOURS) return n > 0 ? `قبل ${n} ساعة` : ''
  if (option === LEAD_DAYS) return n > 0 ? `قبل ${n} يوم` : ''
  return option
}

/** reminderLeadSplit */
function reminderLeadSplit(stored: string): [string, string] {
  const s = latin(stored.trim())
  if (!s) return ['', '']
  if (['قبل يوم', 'قبل 12 ساعة', 'قبل ساعة', LEAD_HOURS, LEAD_DAYS].includes(s)) return [s, '']
  const m = s.match(/قبل\s*(\d+)\s*(ساعة|ساعات|يوم|أيام)/)
  if (!m) return ['', '']
  return [m[2].startsWith('ساع') ? LEAD_HOURS : LEAD_DAYS, m[1]]
}

/** _reminderLabelForDays */
function reminderLabelForDays(days: number) {
  if (days === 1) return 'قبل يوم'
  if (days === 2) return 'قبل يومين'
  if (days >= 3 && days <= 10) return `قبل ${days} أيام`
  return `قبل ${days} يومًا`
}

/** parseAmountInt */
export function parseAmountInt(raw: string): number {
  const text = latin(raw.trim().replace(/[,،٬\s]/g, '').replace('٫', '.'))
  const n = parseFloat(text)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export const dmy = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
const pad2 = (n: number) => String(n).padStart(2, '0')
export const clockNow = () => {
  const n = new Date()
  return `${pad2(n.getHours())}:${pad2(n.getMinutes())}`
}

/** PersonalEntryRecord._databaseDate */
function databaseDate(value: string): string | null {
  if (!value.trim()) return null
  const parts = value.split('/')
  if (parts.length !== 3) return value
  const [d, m, y] = parts.map((p) => parseInt(p, 10))
  if ([d, m, y].some(Number.isNaN)) return value
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** due_date في الجدول (سنة-شهر-يوم) ← يوم/شهر/سنة كما يعرضه التطبيق. */
function displayDate(value: string | null): string {
  if (!value) return ''
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]}` : value
}

export type InitMode = { newCourse?: boolean; sameVisit?: boolean }

/** قيم النموذج: فارغة للإضافة، ومن السجل للتعديل (_openFinancialEntryForm).
    [mode.sameVisit]: [entry] دواء الوصفة الذي يُنسخ منه. */
export function initialValues(form: EntryForm, entry?: Entry, defaultCurrency = '', mode: InitMode = {}): { values: Values; custom: Values } {
  const values: Values = {}
  const custom: Values = {}
  for (const field of form.fields) {
    let value = entry ? String(entry.details?.[field.label] ?? '') : ''
    if (entry) {
      if (!value && field.isTitle) value = entry.title
      if (!value && field.isAmount && Number(entry.amount) !== 0) value = String(Math.round(Number(entry.amount)))
      if (field.label === 'وقت التذكير' && field.kind === 'select') {
        const [option, number] = reminderLeadSplit(value)
        custom[field.label] = number
        value = option
      }
      const options = field.options ?? []
      if (field.kind === 'select' && value && field.label !== 'التصنيف الرئيسي' && !options.includes(value)) {
        if (options.includes(CUSTOM)) {
          custom[field.label] = REMINDER_LABELS.has(field.label) ? (value.match(/\d+/)?.[0] ?? value) : value
          value = CUSTOM
        } else if (field.allowCustom) {
          custom[field.label] = value
          value = ADD_OTHER
        }
      }
    }
    values[field.label] = value
  }
  // دواء آخر من نفس الوصفة: كل البيانات كما هي، ويُكتب اسم الدواء وجرعته فقط.
  if (mode.sameVisit) for (const label of PER_MEDICINE_FIELDS) if (label in values) values[label] = ''
  // العهدة الجديدة: نفس البيانات، والتاريخ اليوم وحالتها من جديد.
  if (mode.newCourse && form.label === 'عهدة مالية') {
    for (const field of form.fields) if (field.kind === 'date') values[field.label] = dmy(new Date())
    if ('حالة العهدة' in values) values['حالة العهدة'] = ''
  }
  if ('العملة' in values && !values['العملة'].trim()) values['العملة'] = defaultCurrency
  return { values, custom }
}

/** أخطاء الإدخال: الحقول الإلزامية الظاهرة، والقيمة المخصصة، والمبلغ.
    «يرجى إدخال|الحقل» يُترجم جزءين عند العرض. */
export function validate(form: EntryForm, values: Values, custom: Values, extras?: { me?: string; installments?: Installment[] }): string | null {
  // العهدة: المستلم برقمه التعريفي إلزامًا، واسمه.
  if (form.label === 'عهدة مالية') {
    const id = normalizeFnd(values[CUSTODY_ID_LABEL] ?? '')
    if (!id) return 'يرجى إدخال الرقم التعريفي للمستلم'
    if (!isValidFnd(id)) return 'الصيغة الصحيحة FND-XXXX-XXXX'
    if (extras?.me && id === extras.me) return 'لا يمكن إسناد العهدة إلى نفسك'
    if (!(values['اسم المستلم'] ?? '').trim()) return 'يرجى إدخال اسم المستلم'
  }
  if (form.label === 'دين / قرض / سلفة') {
    const id = normalizeFnd(values[DEBT_ID_LABEL] ?? '')
    if (id && !isValidFnd(id)) return 'الصيغة الصحيحة FND-XXXX-XXXX'
    if (id && extras?.me && id === extras.me) return 'لا يمكن إسناد العهدة إلى نفسك'
  }
  for (const field of form.fields) {
    const value = (values[field.label] ?? '').trim()
    if (field.label === 'التصنيف الرئيسي') {
      const sub = (values['التصنيف الفرعي'] ?? '').trim()
      if ((field.required && !value) || value === ADD_OTHER) return value === ADD_OTHER ? 'يرجى إدخال التصنيف' : `يرجى اختيار|${field.label}`
      if (sub === ADD_OTHER) return 'يرجى إدخال التصنيف الفرعي'
      if (form.label === 'غرامة' && !sub) return 'يرجى اختيار التصنيف الفرعي'
      continue
    }
    if (!isVisible(field, values)) continue
    if (field.required && !value) return field.kind === 'select' ? `يرجى اختيار|${field.label}` : `يرجى إدخال|${field.label}`
    if (field.kind === 'select' && [ADD_OTHER, CUSTOM, LEAD_HOURS, LEAD_DAYS].includes(value) && !(custom[field.label] ?? '').trim())
      return `يرجى إدخال|${field.label}`
    if (field.isAmount && value && !/\d/.test(latin(value))) return `يرجى إدخال|${field.label}`
    // _dateRangeStart: «إلى تاريخ» لا يسبق «من تاريخ»...
    const startLabel = DATE_RANGE_START[field.label]
    if (startLabel && value) {
      const start = parseDmy(values[startLabel] ?? '')
      const end = parseDmy(value)
      if (start && end && end < start) return `«${field.label}» لا يسبق «${startLabel}»`
    }
    // _distinctTimes: وقت الدواء الإضافي غير وقت الجرعة.
    const other = DISTINCT_TIMES[field.label]
    if (other && value && value === (values[other] ?? '').trim()) return `يجب أن يختلف عن «${other}»`
    if (field.kind === 'number' && value && !field.isAmount) {
      const n = latin(value.replace(/[,،٬\s]/g, ''))
      if (!/^[0-9.٫]+$/.test(n) || !Number.isFinite(parseFloat(n.replace('٫', '.')))) return 'أدخل رقماً صحيحاً'
    }
  }
  if (form.label === 'قسط' && extras?.installments) {
    for (const r of extras.installments) {
      if (!r.date.trim()) return 'اختر تاريخ القسط'
      if (!/^\d+(\.\d+)?$/.test(latin(r.amount.trim()))) return 'أدخل المبلغ'
    }
  }
  return null
}

// ---------------- الحفظ ----------------

/** التفاصيل من النموذج كما في _saveFinancialEntry. */
function detailsFrom(form: EntryForm, values: Values, custom: Values, defaultCurrency: string): Record<string, string> {
  const details: Record<string, string> = {}
  for (const field of form.fields) {
    const v = (values[field.label] ?? '').trim()
    if (v) details[field.label] = v
  }
  for (const field of form.fields) {
    if (field.kind !== 'select') continue
    const picked = details[field.label]
    if (picked === LEAD_HOURS || picked === LEAD_DAYS) {
      const value = reminderLeadValue(picked, custom[field.label] ?? '')
      if (value) details[field.label] = value
      else delete details[field.label]
      continue
    }
    if (picked !== ADD_OTHER && picked !== CUSTOM) continue
    const typed = (custom[field.label] ?? '').trim()
    if (!typed) continue
    const days = parseInt(latin(typed), 10)
    details[field.label] = REMINDER_LABELS.has(field.label) && /^\d+$/.test(latin(typed)) && days > 0 ? reminderLabelForDays(days) : typed
  }
  if ('العملة' in details) {
    // AppSettings.currencyToStore: العملة الافتراضية لا تُحفظ (يتبعها السجل).
    if (details['العملة'] === defaultCurrency) delete details['العملة']
  }
  return details
}

type Core = { title: string; amountText: string; dueDate: string }

function coreFrom(form: EntryForm, details: Record<string, string>): Core {
  const labelOf = (pred: (f: FormField) => boolean) => form.fields.find(pred)?.label ?? ''
  const titleValue = (details[labelOf((f) => !!f.isTitle)] ?? '').trim()
  const dueLabel =
    'تاريخ الاستحقاق' in details
      ? 'تاريخ الاستحقاق'
      : (details['تاريخ الانتهاء'] ?? '').trim()
        ? 'تاريخ الانتهاء'
        : (details['تاريخ نهاية التفويض'] ?? '').trim()
          ? 'تاريخ نهاية التفويض'
          : form.label === 'عهدة مالية' && 'تاريخ التسليم' in details
            ? 'تاريخ التسليم'
            : labelOf((f) => f.kind === 'date')
  const fallbackTitle = (details['التصنيف الفرعي'] ?? '').trim() || (details['التصنيف الرئيسي'] ?? '').trim() || form.label
  return {
    title: titleValue || fallbackTitle,
    amountText: (details[labelOf((f) => !!f.isAmount)] ?? '').trim(),
    dueDate: (details[dueLabel] ?? '').trim(),
  }
}

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('انتهت الجلسة — ادخل من جديد')
  return data.user.id
}

/** رفع المرفق: نفس الحاوية ونفس شكل المسار في التطبيق. */
export async function uploadAttachment(userId: string, file: File): Promise<string> {
  const dot = file.name.lastIndexOf('.')
  const ext = dot < 0 || dot === file.name.length - 1 ? '' : file.name.slice(dot).replace(/[^a-zA-Z0-9.]/g, '')
  const path = `${userId}/${Date.now() * 1000 + Math.floor(Math.random() * 1000)}${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw error
  return path
}

/** العملة الظاهرة في النموذج (AppSettings.currencyOf). */
const unitOf = (values: Values, defaultCurrency: string) => (values['العملة'] ?? '').trim() || defaultCurrency

function extrasFor(form: EntryForm, values: Values, defaultCurrency: string, extras?: SaveExtras): { extra: Record<string, string>; due?: string } {
  if (form.label === 'قسط' && extras?.installments?.length) return installmentExtra(extras.installments, extras.equalSplit !== false, unitOf(values, defaultCurrency))
  return { extra: {} }
}

export async function createEntry(form: EntryForm, values: Values, custom: Values, defaultCurrency: string, attachment?: File | null, extras?: SaveExtras): Promise<Entry | null> {
  const userId = await currentUserId()
  const { extra, due } = extrasFor(form, values, defaultCurrency, extras)
  // أدوية الوصفة الواحدة تُجمع بمعرّف أولها.
  const source = extras?.prescriptionOf
  if (source) extra[PRESCRIPTION_GROUP_KEY] = String(source.details?.[PRESCRIPTION_GROUP_KEY] ?? '').trim() || source.id
  // ربط البند بفرد عند الإضافة من تفاصيله (linkDetails).
  let details = { ...detailsFrom(form, values, custom, defaultCurrency), ...extra, ...(extras?.link ?? {}) }
  const core = coreFrom(form, details)
  if (due) core.dueDate = due
  if (extras?.me) details = withAssignment(form.label, details, holderNameOf(details), extras.me)
  const attachmentUrl = attachment ? await uploadAttachment(userId, attachment) : null
  // «اسم المستند» المكتوب عند الإرفاق: يظهر به في «المستندات».
  if (attachment && docDisplayName(attachment.name)) details = { ...details, 'اسم المرفق الإضافي': docDisplayName(attachment.name) }
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: userId,
      category: PERSONAL_SLUG[form.label] ?? 'organization',
      entry_type: form.label,
      title: core.title,
      amount: parseAmountInt(core.amountText),
      due_date: databaseDate(core.dueDate),
      status: STATUS_ACTIVE,
      details,
      attachment_url: attachmentUrl,
    })
    .select('*')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return (row as Entry | undefined) ?? null
}

const jsonRows = (raw: string | undefined): Record<string, string>[] => {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((r) => r && typeof r === 'object').map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])))
      : []
  } catch {
    return []
  }
}

/** _custodyTotalSpent: المعتمد وما لا يحتاج اعتمادًا، وما سُجّل خطأً دفعاتٍ. */
function custodySpentOf(details: Record<string, string>) {
  const counted = jsonRows(details['سجل صرفيات العهدة']).filter((r) => r['حالة الاعتماد'] !== 'بانتظار الاعتماد' && r['حالة الاعتماد'] !== 'مرفوض')
  return counted.reduce((s, r) => s + parseAmountInt(r['المبلغ'] ?? ''), 0) + totalPaid(details)
}

/** رقم العهدة الحالية (ما ستُحفظ به في السجل عند بدء عهدة جديدة). */
export const custodyNumber = (details: Record<string, unknown> | undefined) =>
  parseInt(String(details?.['رقم العهدة'] ?? ''), 10) || jsonRows(String(details?.[CUSTODY_LOG_KEY] ?? '[]')).length + 1

/** بدء عهدة جديدة / كورس جديد: الحالي إلى سجله والرقم +1 (_saveFinancialEntry). */
function startNewCourse(form: EntryForm, entry: Entry, old: Record<string, string>, merged: Record<string, string>) {
  const total = Math.round(Number(entry.amount) || 0)
  if (form.label === 'عهدة مالية') {
    // العهدة الحالية تنتقل إلى السجل «عهدة رقم N» بكل معلوماتها وصرفياتها،
    // والجديدة تبدأ بلا صرفيات ولا زيادات.
    const log = jsonRows(old[CUSTODY_LOG_KEY])
    const number = custodyNumber(old)
    const spent = custodySpentOf(old)
    const row: Record<string, string> = { العهدة: `عهدة رقم ${number}` }
    for (const field of form.fields) if (!field.hidden && (old[field.label] ?? '').trim()) row[field.label] = old[field.label].trim()
    row['قيمة العهدة'] = String(total)
    row['المصروف'] = String(spent)
    row['المتبقي'] = String(total - spent)
    row['الحالة'] = entry.status ?? ''
    if (old['سجل صرفيات العهدة']) row['سجل صرفيات العهدة'] = old['سجل صرفيات العهدة']
    if (old['سجل زيادات العهدة']) row['سجل زيادات العهدة'] = old['سجل زيادات العهدة']
    merged[CUSTODY_LOG_KEY] = JSON.stringify([...log, row])
    merged['رقم العهدة'] = String(number + 1)
    for (const key of ['سجل صرفيات العهدة', 'سجل دفعات الالتزام', 'سجل زيادات العهدة', 'تاريخ التسوية', 'المبلغ المعاد عند التسوية', 'تاريخ الإلغاء']) delete merged[key]
    return
  }
  // الكورس الحالي ينتقل إلى السجل باسم «كورس N»، والجديد = N+1.
  const courses = jsonRows(old[COURSE_LOG_KEY])
  const number = parseInt(old['رقم الكورس'] ?? '', 10) || courses.length + 1
  const row: Record<string, string> = { الكورس: `كورس ${number}` }
  for (const field of form.fields) if ((old[field.label] ?? '').trim()) row[field.label] = old[field.label].trim()
  merged[COURSE_LOG_KEY] = JSON.stringify([...courses, row])
  merged['رقم الكورس'] = String(number + 1)
}

type Row = {
  category: string
  entry_type: string
  title: string
  amount: number
  due_date: string | null
  status: string
  details: Record<string, string>
  attachment_url: string | null
}

const asStrings = (details: Record<string, unknown> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(details ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)]))

function rowOf(e: Entry): Row {
  return {
    category: e.category ?? '',
    entry_type: e.entry_type ?? '',
    title: e.title ?? '',
    amount: Math.round(Number(e.amount) || 0),
    due_date: e.due_date ? databaseDate(displayDate(e.due_date)) : null,
    status: e.status ?? STATUS_ACTIVE,
    details: asStrings(e.details),
    attachment_url: e.attachment_url ?? null,
  }
}

// ---------------- RecordMerge ----------------

const pick = <T,>(base: T, mine: T, theirs: T) => (mine === base ? theirs : mine)

function decode(raw: string | undefined): unknown {
  const text = (raw ?? '').trim()
  if (!text || !(text.startsWith('[') || text.startsWith('{'))) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const idOf = (e: unknown) => {
  if (e && typeof e === 'object' && !Array.isArray(e)) {
    const id = (e as Record<string, unknown>).id
    if (id !== null && id !== undefined && String(id) !== '') return `id:${id}`
  }
  return JSON.stringify(e)
}

function mergeLists(base: unknown[], mine: unknown[], theirs: unknown[]) {
  const baseById = new Map(base.map((e) => [idOf(e), JSON.stringify(e)]))
  const mineById = new Map(mine.map((e) => [idOf(e), e]))
  const result: unknown[] = []
  const seen = new Set<string>()
  for (const element of theirs) {
    const id = idOf(element)
    seen.add(id)
    if (baseById.has(id) && !mineById.has(id)) continue
    const mineVersion = mineById.get(id)
    if (mineVersion !== undefined && baseById.has(id) && JSON.stringify(mineVersion) !== baseById.get(id)) result.push(mineVersion)
    else result.push(element)
  }
  for (const element of mine) {
    const id = idOf(element)
    if (!baseById.has(id) && !seen.has(id)) result.push(element)
  }
  return result
}

function mergeMaps(base: Record<string, unknown>, mine: Record<string, unknown>, theirs: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...theirs }
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    if (JSON.stringify(mine[key]) === JSON.stringify(base[key])) continue
    if (!(key in mine)) delete out[key]
    else out[key] = mine[key]
  }
  return out
}

function mergeJson(b: string | undefined, m: string | undefined, t: string | undefined): string | null {
  const mine = decode(m)
  const theirs = decode(t)
  if (mine === null || theirs === null) return null
  const base = decode(b)
  if (Array.isArray(mine) && Array.isArray(theirs)) return JSON.stringify(mergeLists(Array.isArray(base) ? base : [], mine, theirs))
  if (mine && theirs && typeof mine === 'object' && typeof theirs === 'object' && !Array.isArray(mine) && !Array.isArray(theirs))
    return JSON.stringify(mergeMaps(base && typeof base === 'object' && !Array.isArray(base) ? (base as Record<string, unknown>) : {}, mine as Record<string, unknown>, theirs as Record<string, unknown>))
  return null
}

export function mergeDetails(base: Record<string, string>, mine: Record<string, string>, theirs: Record<string, string>) {
  const out = { ...theirs }
  const put = (key: string, value: string | undefined) => {
    if (value === undefined) delete out[key]
    else out[key] = value
  }
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    const b = base[key]
    const m = mine[key]
    const t = theirs[key]
    if (m === b) continue
    if (t === b) {
      put(key, m)
      continue
    }
    put(key, mergeJson(b, m, t) ?? m)
  }
  return out
}

/** تحديث سجل: ما غيّرتُه فقط فوق أحدث نسخة في الخادم. */
async function updateMerged(base: Entry, mine: Row) {
  const userId = await currentUserId()
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', base.id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('السجل غير موجود — ربما حُذف من التطبيق')
  const b = rowOf(base)
  const latest = data as Entry
  const t = rowOf(latest)
  const details = mergeDetails(b.details, mine.details, t.details)
  // ما لم يتغيّر يُكتب بقيمته الأصلية في الخادم كما هي (بلا تحويل نوعها).
  const raw = latest.details ?? {}
  const finalDetails: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(details)) finalDetails[k] = k in raw && t.details[k] === v ? raw[k] : v
  const merged = {
    user_id: userId,
    category: pick(b.category, mine.category, t.category),
    entry_type: pick(b.entry_type, mine.entry_type, t.entry_type),
    title: pick(b.title, mine.title, t.title),
    amount: pick(b.amount, mine.amount, t.amount),
    due_date: pick(b.due_date, mine.due_date, t.due_date),
    status: pick(b.status, mine.status, t.status),
    details: finalDetails,
    attachment_url: pick(b.attachment_url, mine.attachment_url, t.attachment_url),
  }
  const { error: saveError } = await supabase.from(TABLE).update(merged).eq('id', base.id)
  if (saveError) throw saveError
}

export async function updateEntry(entry: Entry, form: EntryForm, values: Values, custom: Values, defaultCurrency: string, attachment?: File | null, extras?: SaveExtras) {
  const userId = await currentUserId()
  const { extra, due } = extrasFor(form, values, defaultCurrency, extras)
  const details = { ...detailsFrom(form, values, custom, defaultCurrency), ...extra }
  const core = coreFrom(form, details)
  if (due) core.dueDate = due
  const old = asStrings(entry.details)
  const labels = new Set(form.fields.map((f) => f.label))
  let merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(old)) if (!labels.has(k) && !k.startsWith('القسط ')) merged[k] = v
  Object.assign(merged, details)
  if (extras?.newCourse) startNewCourse(form, entry, old, merged)
  // تغيّر الرقم التعريفي: إسناد جديد بانتظار قبول الشخص الجديد.
  if (SHARED_TYPES.has(form.label) && extras?.me) {
    const idLabel = idLabelOf(form.label)
    if (normalizeFnd(old[idLabel] ?? '') !== normalizeFnd(merged[idLabel] ?? '')) {
      for (const key of ASSIGNMENT_KEYS) delete merged[key]
      merged = withAssignment(form.label, merged, holderNameOf(merged), extras.me)
    }
  }
  const changed = form.fields
    .filter((f) => !f.hidden && f.kind !== 'header' && (old[f.label] ?? '').trim() !== (merged[f.label] ?? '').trim())
    .map((f) => f.display || f.label)
  if (changed.length) {
    let log: unknown[] = []
    try {
      const parsed = JSON.parse(old[EDIT_LOG_KEY] || '[]')
      if (Array.isArray(parsed)) log = parsed
    } catch {
      log = []
    }
    merged[EDIT_LOG_KEY] = JSON.stringify([...log, { التاريخ: dmy(new Date()), الوقت: clockNow(), الحقول: changed.join('، ') }])
  }
  const current = rowOf(entry)
  const attachmentUrl = attachment ? await uploadAttachment(userId, attachment) : current.attachment_url
  if (attachment && docDisplayName(attachment.name)) merged['اسم المرفق الإضافي'] = docDisplayName(attachment.name)
  await updateMerged(entry, {
    ...current,
    entry_type: entry.entry_type || form.label,
    title: core.title,
    amount: core.amountText ? parseAmountInt(core.amountText) : current.amount,
    due_date: databaseDate(core.dueDate),
    status: extras?.newCourse ? STATUS_ACTIVE : current.status,
    details: merged,
    attachment_url: attachmentUrl,
  })
}

// ---------------- تعديل الالتزام العام (_openEditForm) ----------------

export const LEGACY_STATUSES = ['نشطة', 'قريبة الاستحقاق', 'متأخرة', 'مكتملة', 'مؤرشف', 'ملغاة', 'تمت التسوية']

/** مفاتيح التفاصيل التي تُعدَّل نصًّا: غير السجلات (JSON) والمفاتيح الداخلية. */
export function legacyEditableKeys(entry: Entry): string[] {
  return Object.entries(asStrings(entry.details))
    .filter(([k, v]) => /[\u0600-\u06FF]/.test(k) && !k.startsWith('_') && !k.startsWith('عهدة_') && !/^[[{]/.test(v.trim()))
    .map(([k]) => k)
}

export type LegacyValues = { title: string; amount: string; dueDate: string; status: string; details: Record<string, string> }

export function validateLegacy(v: LegacyValues): string | null {
  if (!v.title.trim()) return 'يرجى إدخال اسم الالتزام'
  const amount = Number(latin(v.amount.trim()))
  if (!v.amount.trim() || !Number.isFinite(amount) || amount < 0) return 'أدخل مبلغاً صحيحاً'
  return null
}

/** الحقول الظاهرة تُستبدل (والفارغ يُحذف)، والسجلات والمفاتيح الداخلية تبقى كما هي. */
export async function updateLegacyEntry(entry: Entry, v: LegacyValues) {
  const old = asStrings(entry.details)
  const details: Record<string, string> = {}
  for (const [k, value] of Object.entries(old)) if (!(k in v.details)) details[k] = value
  for (const [k, value] of Object.entries(v.details)) if (value.trim()) details[k] = value.trim()
  await updateMerged(entry, {
    ...rowOf(entry),
    title: v.title.trim(),
    amount: Math.round(Number(latin(v.amount.trim())) || 0),
    due_date: databaseDate(v.dueDate.trim()),
    status: v.status,
    details,
  })
}

/** أرشفة الالتزام (_archiveCommitment). */
export async function archiveEntry(entry: Entry) {
  await updateMerged(entry, { ...rowOf(entry), status: 'مؤرشف' })
}

/** إخراج من الأرشيف (_unarchiveCommitment) — الأنواع المتاحة في الموقع تعود «نشطة». */
export async function unarchiveEntry(entry: Entry) {
  await updateMerged(entry, { ...rowOf(entry), status: STATUS_ACTIVE })
}

/** الحذف: نقل إلى سلة المحذوفات مع الحالة السابقة وتاريخ الحذف (TrashStore.markDeleted). */
export async function trashEntry(entry: Entry) {
  const n = new Date()
  const stamp = `${n.getFullYear()}/${pad2(n.getMonth() + 1)}/${pad2(n.getDate())} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`
  const row = rowOf(entry)
  await updateMerged(entry, {
    ...row,
    status: 'محذوف',
    details: { ...row.details, 'الحالة قبل الحذف': entry.status ?? '', 'تاريخ الحذف': stamp, 'مصدر السجل': 'الالتزامات الشخصية' },
  })
}

export { displayDate }

// ---------------- الدفعات وزيادة الدين (_openSubscriptionPaymentForm، _openDebtIncreaseForm) ----------------
/*
  «تسجيل سداد / سداد جزئي» للقسط والاشتراك والدين، و«زيادة على الدين السابق»
  للقسط والدين، كما في تفاصيل الالتزام في التطبيق:
  - الدفعة تُضاف أولَ «سجل دفعات الالتزام»: {الدافع، ملاحظات؟، المبلغ، التاريخ،
    وقت التسجيل، سجّلها، معرّف المسجِّل، مرفق الفاتورة؟}. صورة الفاتورة إلزامية
    إلا في الدين، وتصير أيضًا مرفق السجل العام كما يفعل التطبيق.
  - الدين: الدافع هو اسمي الظاهر، ويسدّده المدين وحده (وبعد قبول الربط إن كان
    مرتبطًا)، ويزيده الدائن.
  - الزيادة: سطر في «سجل الزيادات» والمبلغ الإجمالي يزيد.
  الكتابة على أحدث نسخة في الخادم، للتفاصيل والأعمدة المتغيّرة وحدها، وبشرط
  ألا يكون السجل تغيّر منذ قراءته — فيكتبها الطرف الثاني في الدين أيضًا.
*/

export const PAYMENTS_KEY = 'سجل دفعات الالتزام'
const INCREASES_KEY = 'سجل الزيادات'

export class EntryError extends Error {}

type Assignment = { ownerId: string; holderId: string; state: string }
const assignmentOf = (d: Record<string, unknown>): Assignment => ({
  ownerId: String(d['عهدة_مالك_المعرّف'] ?? '').trim(),
  holderId: String(d['عهدة_مسندة_إلى'] ?? '').trim(),
  state: String(d['عهدة_حالة_الإسناد'] ?? '').trim(),
})
const isAssigned = (a: Assignment) => ['بانتظار القبول', 'مقبولة', 'مرفوضة'].includes(a.state)

/** CustodyAssignment.roleFor */
export function roleFor(details: Record<string, unknown>, me: string): 'soleOwner' | 'owner' | 'holder' | 'observer' {
  const a = assignmentOf(details)
  if (!isAssigned(a)) return a.ownerId && a.ownerId !== me ? 'observer' : 'soleOwner'
  if (a.ownerId && a.ownerId === me) return 'owner'
  if (a.holderId && a.holderId === me) return 'holder'
  if (!a.ownerId && a.holderId !== me) return 'soleOwner'
  return 'observer'
}

/** _isDebtCreditor */
function isDebtCreditor(details: Record<string, unknown>, me: string) {
  const ownerIsCreditor = !String(details['نوع الدين'] ?? '').trim().startsWith('له')
  const role = roleFor(details, me)
  if (role === 'owner' || role === 'soleOwner') return ownerIsCreditor
  if (role === 'holder') return !ownerIsCreditor
  return false
}

/** _canRepayDebt */
function canRepayDebt(details: Record<string, unknown>, me: string) {
  const role = roleFor(details, me)
  const accepted = assignmentOf(details).state === 'مقبولة'
  if (role === 'observer') return false
  if (role === 'holder' && !accepted) return false
  if (!accepted) return true
  return !isDebtCreditor(details, me)
}

/** ما يظهر من «+ إضافة» (_quickAddRows): السداد والزيادة. */
export function paymentActions(entry: Entry, me: string): { pay: boolean; increase: boolean } {
  if (['مؤرشف', 'محذوف', 'ملغاة'].includes(entry.status)) return { pay: false, increase: false }
  const d = entry.details ?? {}
  switch (entry.entry_type) {
    case 'قسط':
      return { pay: true, increase: true }
    case 'دين / قرض / سلفة':
      return { pay: canRepayDebt(d, me), increase: isDebtCreditor(d, me) }
    case 'اشتراك':
    case 'اشتراكات':
      return { pay: true, increase: false }
    default:
      return { pay: false, increase: false }
  }
}

function paymentsOf(details: Record<string, unknown>): Record<string, unknown>[] {
  try {
    const raw = details[PAYMENTS_KEY]
    const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw ?? []
    return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : []
  } catch {
    return []
  }
}

/** _subscriptionTotalPaid */
export const totalPaid = (details: Record<string, unknown>) => paymentsOf(details).reduce((s, p) => s + parseAmountInt(String(p['المبلغ'] ?? '')), 0)

/** المتبقي = الإجمالي − المدفوع (_CommitmentItem.amount). */
export const remainingOf = (entry: Entry) => Math.round(Number(entry.amount) || 0) - totalPaid(entry.details ?? {})

type Fresh = { id: string; amount: number; details: Record<string, unknown>; attachment_url: string | null; updated_at: string; status: string; entry_type: string }

/** قراءة أحدث نسخة، وتطبيق التغيير، والكتابة بشرط عدم تغيّرها. */
export async function mutateEntry(entry: Entry, change: (row: Fresh, details: Record<string, string>) => Record<string, unknown>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from(TABLE).select('id, amount, details, attachment_url, updated_at, status, entry_type').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) throw new EntryError('السجل غير موجود — ربما حُذف من التطبيق')
    const row = data as Fresh
    const patch = change(row, asStrings(row.details))
    const { data: saved, error: saveError } = await supabase.from(TABLE).update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (saveError) throw saveError
    if (saved && saved.length) return
  }
  throw new EntryError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

/** إضافة عنصر أولَ قائمة JSON نصًّا، دون إعادة كتابة ما قبله. */
function prependJson(raw: string, item: Record<string, unknown>): string {
  const text = raw.trim()
  if (!text) return JSON.stringify([item])
  try {
    if (!Array.isArray(JSON.parse(text))) throw new Error()
  } catch {
    throw new EntryError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
  }
  const inner = text.slice(1).trim()
  return `[${JSON.stringify(item)}${inner === ']' ? ']' : `,${inner}`}`
}

export type PaymentInput = { payer: string; amount: string; date: string; note: string; invoice: File | null }

/** يعيد رسالة الخطأ أو null (مدقّق النموذج في التطبيق). */
export function validatePayment(entry: Entry, input: PaymentInput): string | null {
  const isDebt = entry.entry_type === 'دين / قرض / سلفة'
  if (!isDebt && !input.payer.trim()) return 'أدخل اسم الشخص الذي دفع'
  const amount = parseFloat(latin(input.amount.trim()))
  if (!/^\d+(\.\d+)?$/.test(latin(input.amount.trim())) || !(amount > 0)) return 'أدخل مبلغ دفعة صحيحاً'
  if (amount > remainingOf(entry)) return 'المبلغ أكبر من المتبقي'
  if (!input.date.trim()) return 'حدد تاريخ الدفع'
  if (!isDebt && !input.invoice) return 'يرجى إضافة صورة من الفاتورة'
  return null
}

// ---------------- سداد الدين بموافقة الدائن (_submitDebtPaymentForApproval) ----------------

export const DEBT_REQUESTS_KEY = 'دفعات بانتظار الموافقة'
export const DEBT_APPROVAL_FIELD = 'يتطلب موافقة المالك'
export const DEBT_PENDING = 'بانتظار الموافقة'
export const DEBT_APPROVED = 'تمت الموافقة'
export const DEBT_REJECTED = 'مرفوضة'

export function debtRequestsOf(details: Record<string, unknown>): Record<string, string>[] {
  try {
    const raw = details[DEBT_REQUESTS_KEY]
    const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw ?? []
    return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object').map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v ?? '')]))) : []
  } catch {
    return []
  }
}

const pendingDebtTotal = (details: Record<string, unknown>) =>
  debtRequestsOf(details)
    .filter((r) => r['الحالة'] === DEBT_PENDING)
    .reduce((s, r) => s + parseAmountInt(r['المبلغ'] ?? ''), 0)

/** دين مربوط مقبول و«يتطلب موافقة المالك» ليس «لا»: سداد المدين يُرسل للموافقة. */
export function debtPaymentNeedsApproval(details: Record<string, unknown>, me: string) {
  if (String(details[DEBT_APPROVAL_FIELD] ?? '').trim() === 'لا') return false
  if (assignmentOf(details).state !== 'مقبولة') return false
  return !isDebtCreditor(details, me)
}

/** هل أنا الدائن (لـ«موافق / رفض»). */
export const iAmDebtCreditor = (details: Record<string, unknown>, me: string) => isDebtCreditor(details, me)

/** اسم الطرف الآخر في الدين المربوط. */
export function debtOtherParty(details: Record<string, unknown>, me: string): string {
  const d = (k: string) => String(details[k] ?? '').trim()
  return roleFor(details, me) === 'holder' ? d('عهدة_مالك_الاسم') || d('عهدة_مالك_المعرّف') : d('عهدة_المسند_إليه_الاسم') || d('عهدة_مسندة_إلى')
}

/** الدائن يوافق (يُضاف إلى الدفعات ويُخصم) أو يرفض سدادًا أرسله المدين. */
export async function decideDebtPayment(entry: Entry, requestId: string, approve: boolean, me: Me) {
  if (!isDebtCreditor(entry.details ?? {}, me.fnd)) throw new EntryError('الموافقة على السداد للدائن وحده')
  const n = new Date()
  const stamp = `${dmy(n)} ${clockNow()}`
  await mutateEntry(entry, (row, details) => {
    const rows = debtRequestsOf(details)
    const index = rows.findIndex((r) => r.id === requestId && r['الحالة'] === DEBT_PENDING)
    if (index < 0) throw new EntryError('لم يعد هذا الطلب قائمًا')
    const r = rows[index]
    rows[index] = { ...r, الحالة: approve ? DEBT_APPROVED : DEBT_REJECTED, [approve ? 'تاريخ ووقت الاعتماد' : 'تاريخ ووقت الرفض']: stamp, قرّرها: me.name }
    const next: Record<string, unknown> = { ...row.details, [DEBT_REQUESTS_KEY]: JSON.stringify(rows) }
    if (approve) {
      const amount = parseAmountInt(r['المبلغ'] ?? '')
      if (amount > Math.round(Number(row.amount) || 0) - totalPaid(details)) throw new EntryError('المبلغ أكبر من المتبقي')
      const payment: Record<string, unknown> = { الدافع: r['الدافع'] ?? '' }
      if ((r['ملاحظات'] ?? '').trim()) payment['ملاحظات'] = r['ملاحظات'].trim()
      payment['المبلغ'] = String(amount)
      payment['التاريخ'] = r['التاريخ'] ?? ''
      payment['وقت التسجيل'] = r['وقت التسجيل'] ?? ''
      payment['سجّلها'] = r['الدافع'] ?? ''
      payment['معرّف المسجِّل'] = r['معرّف الدافع'] ?? ''
      payment['وافق عليها'] = me.name
      payment['تاريخ ووقت الاعتماد'] = stamp
      if ((r['مرفق الفاتورة'] ?? '').trim()) payment['مرفق الفاتورة'] = r['مرفق الفاتورة'].trim()
      next[PAYMENTS_KEY] = prependJson(details[PAYMENTS_KEY] ?? '', payment)
    }
    return { details: next }
  })
}

/** يعيد 'pending' إن أُرسل السداد لموافقة الدائن، و'saved' إن سُجّل. */
export async function addPayment(entry: Entry, input: PaymentInput, me: Me): Promise<'pending' | 'saved'> {
  const problem = validatePayment(entry, input)
  if (problem) throw new EntryError(problem)
  const isDebt = entry.entry_type === 'دين / قرض / سلفة'
  if (isDebt && !canRepayDebt(entry.details ?? {}, me.fnd)) throw new EntryError('السداد يسجّله المدين — لك الزيادة والمطالبة')
  const userId = await currentUserId()
  const invoicePath = input.invoice ? await uploadAttachment(userId, input.invoice) : ''
  const amount = Math.round(parseFloat(latin(input.amount.trim())))
  if (isDebt && debtPaymentNeedsApproval(entry.details ?? {}, me.fnd)) {
    const request: Record<string, unknown> = {
      id: String(Date.now()),
      المبلغ: String(amount),
      العملة: String(entry.details?.['العملة'] ?? '').trim(),
      التاريخ: input.date.trim(),
      'وقت التسجيل': clockNow(),
      الدافع: me.name,
      'معرّف الدافع': me.fnd,
    }
    if (input.note.trim()) request['ملاحظات'] = input.note.trim()
    if (invoicePath) request['مرفق الفاتورة'] = invoicePath
    request['الحالة'] = DEBT_PENDING
    await mutateEntry(entry, (row, details) => {
      if (amount > Math.round(Number(row.amount) || 0) - totalPaid(details) - pendingDebtTotal(details)) throw new EntryError('المبلغ أكبر من المتبقي بعد الدفعات بانتظار الموافقة')
      return { details: { ...row.details, [DEBT_REQUESTS_KEY]: prependJson(details[DEBT_REQUESTS_KEY] ?? '', request) } }
    })
    return 'pending'
  }
  const payment: Record<string, unknown> = { الدافع: isDebt ? me.name : input.payer.trim() }
  if (isDebt && input.note.trim()) payment['ملاحظات'] = input.note.trim()
  payment['المبلغ'] = String(amount)
  payment['التاريخ'] = input.date.trim()
  payment['وقت التسجيل'] = clockNow()
  payment['سجّلها'] = me.name
  payment['معرّف المسجِّل'] = me.fnd
  if (invoicePath) payment['مرفق الفاتورة'] = invoicePath
  await mutateEntry(entry, (row, details) => {
    // المتبقي من أحدث نسخة: لا تتجاوز الدفعات الإجمالي.
    if (amount > Math.round(Number(row.amount) || 0) - totalPaid(details)) throw new EntryError('المبلغ أكبر من المتبقي')
    const patch: Record<string, unknown> = { details: { ...row.details, [PAYMENTS_KEY]: prependJson(details[PAYMENTS_KEY] ?? '', payment) } }
    if (invoicePath) patch.attachment_url = invoicePath
    return patch
  })
  return 'saved'
}

/** «زيادة على الدين السابق»: يعيد الإجمالي الجديد. */
export async function increaseDebt(entry: Entry, amountText: string, note: string, currency: string, me: string): Promise<number> {
  const amount = parseFloat(latin(amountText.trim()))
  if (!/^\d+(\.\d+)?$/.test(latin(amountText.trim())) || !(amount > 0)) throw new EntryError('أدخل مبلغ زيادة صحيحًا')
  if (!paymentActions(entry, me).increase) throw new EntryError('الزيادة يسجّلها الدائن')
  const n = new Date()
  const line = `${Math.round(amount)} ${currency} — ${n.getFullYear()}/${n.getMonth() + 1}/${n.getDate()}${note.trim() ? ` — ${note.trim()}` : ''}`
  let total = 0
  await mutateEntry(entry, (row, details) => {
    const previous = details[INCREASES_KEY] ?? ''
    total = Math.round(Number(row.amount) || 0) + Math.round(amount)
    return { amount: total, details: { ...row.details, [INCREASES_KEY]: previous ? `${previous}\n${line}` : line } }
  })
  return total
}

// ---------------- سجل الجرعات (_logMedicationAction) ----------------

export const MEDICATION_ACTIONS = ['تسجيل التناول', 'تأجيل', 'تخطي']

/** «تسجيل التناول» و«تأجيل» و«تخطي»: سطر «الإجراء — yyyy/MM/dd HH:mm». */
export async function logMedication(entry: Entry, action: string) {
  if (!MEDICATION_ACTIONS.includes(action)) throw new EntryError('تعذر الحفظ. حاول مرة أخرى.')
  const n = new Date()
  const line = `${action} — ${n.getFullYear()}/${pad2(n.getMonth() + 1)}/${pad2(n.getDate())} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`
  await mutateEntry(entry, (row, details) => {
    const previous = details['سجل الجرعات'] ?? ''
    return { details: { ...row.details, 'سجل الجرعات': previous ? `${previous}\n${line}` : line } }
  })
}

// ---------------- «+ إضافة» داخل الالتزام (_addFollowupRow، _saveAddedAttachment) ----------------

export const FOLLOWUP_KEY = 'سجل المتابعة'
export const FOLLOWUP_TYPES = ['مهمة', 'موعد', 'عادة', 'تذكير', 'ملاحظات']
const EXTRA_FILES_KEY = 'مرفقات إضافية'

export type Followup = { النوع: string; العنوان: string; التفاصيل: string; التاريخ: string; الوقت: string }

export function followupsOf(details: Record<string, unknown>): Record<string, string>[] {
  try {
    const raw = details[FOLLOWUP_KEY]
    const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw ?? [])
    return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object').map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v == null ? '' : String(v)]))) : []
  } catch {
    return []
  }
}

/** إضافة عنصر آخر قائمة JSON نصًّا، دون إعادة كتابة ما قبله. */
function appendJson(raw: string, item: Record<string, unknown>): string {
  const text = raw.trim()
  if (!text) return JSON.stringify([item])
  try {
    if (!Array.isArray(JSON.parse(text))) throw new Error()
  } catch {
    throw new EntryError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
  }
  const body = text.slice(0, text.lastIndexOf(']')).trim()
  return `${body}${body === '[' ? '' : ','}${JSON.stringify(item)}]`
}

export async function addFollowup(entry: Entry, row: Followup) {
  if (!row.العنوان.trim()) throw new EntryError('اكتب العنوان أولًا')
  const item = { النوع: row.النوع, العنوان: row.العنوان.trim(), التفاصيل: row.التفاصيل.trim(), التاريخ: row.التاريخ.trim(), الوقت: row.الوقت.trim() }
  await mutateEntry(entry, (fresh, details) => ({ details: { ...fresh.details, [FOLLOWUP_KEY]: appendJson(details[FOLLOWUP_KEY] ?? '', item) } }))
}

/** _deleteFollowupRow: يُحذف ما يطابق العنوان والنوع والتاريخ. */
export async function deleteFollowup(entry: Entry, row: Record<string, string>) {
  await mutateEntry(entry, (fresh, details) => {
    const raw = (details[FOLLOWUP_KEY] ?? '').trim()
    let list: Record<string, unknown>[] = []
    try {
      const parsed = JSON.parse(raw || '[]')
      if (!Array.isArray(parsed)) throw new Error()
      list = parsed
    } catch {
      throw new EntryError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
    }
    const same = (x: Record<string, unknown>) => String(x?.['العنوان'] ?? '') === row['العنوان'] && String(x?.['النوع'] ?? '') === row['النوع'] && String(x?.['التاريخ'] ?? '') === row['التاريخ']
    if (!list.some(same)) throw new EntryError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    return { details: { ...fresh.details, [FOLLOWUP_KEY]: JSON.stringify(list.filter((x) => !same(x))) } }
  })
}

/** «مستند»: يصير المرفق الأول، أو يُضاف بجانبه في «مرفقات إضافية». */
export async function addDocument(entry: Entry, file: File) {
  const path = await uploadAttachment(await currentUserId(), file)
  await mutateEntry(entry, (fresh, details) => {
    if ((fresh.attachment_url ?? '').trim()) {
      const row = { id: String(Date.now()), path, name: docDisplayName(file.name), type: 'مستند' }
      return { details: { ...fresh.details, [EXTRA_FILES_KEY]: appendJson(details[EXTRA_FILES_KEY] ?? '', row) } }
    }
    return { attachment_url: path, details: { ...fresh.details, 'نوع المرفق الإضافي': 'مستند', 'اسم المرفق الإضافي': docDisplayName(file.name) } }
  })
}

// ---------------- البنود المرتبطة بفرد (people_management_screen.dart) ----------------

export const LINKED_PERSON_KEY = 'الفرد المرتبط'
export const MONEY_DIRECTION_KEY = 'اتجاه المبلغ مع الفرد'

type PersonLike = { fullName: string; typeKey?: string; details?: Record<string, unknown> }

/** _recordLinkedTo */
export function recordLinkedTo(record: Entry, person: PersonLike): boolean {
  if (record.status === 'محذوف') return false
  const d = record.details ?? {}
  const name = person.fullName.trim()
  if (String(d[LINKED_PERSON_KEY] ?? '').trim() === name) return true
  const personId = String(person.details?.['الرقم التعريفي'] ?? '').trim()
  if (personId && (record.entry_type === 'عهدة مالية' || record.entry_type === 'دين / قرض / سلفة')) {
    const holder = String(d['عهدة_مسندة_إلى'] ?? '').trim()
    const owner = String(d['عهدة_مالك_المعرّف'] ?? '').trim()
    if (holder === personId || owner === personId) return true
  }
  if (person.typeKey === 'person_self' && (record.entry_type === 'مستند' || record.entry_type === 'ضمانات')) return true
  if (record.entry_type === 'أدوية') {
    const who = String(d['لمن هذا الدواء'] ?? '').trim()
    if (person.typeKey === 'person_self') return who === 'أدوية لي'
    if (who === 'أدوية لشخص آخر') return String(d['اسم المستفيد'] ?? '').trim() === name
    return who === name
  }
  return false
}

export type LinkedAdd = { label: string; type: string; prefill: Record<string, string>; link: Record<string, string> }

const isEmployee = (p: PersonLike & { categoryName?: string; additionalCategoryNames?: string[] }) =>
  p.typeKey === 'person_employee' || p.categoryName === 'موظف' || (p.additionalCategoryNames ?? []).includes('موظف')

/** خيارات «+» في تفاصيل الفرد: مالية له/عليه، والمتابعة والتخطيط، والأدوية (_addFinance، _addFollowUp، _addMedicine). */
export function linkedAdds(person: PersonLike & { categoryName?: string; additionalCategoryNames?: string[] }): { group: string; items: LinkedAdd[] }[] {
  const name = person.fullName.trim()
  const base = { [LINKED_PERSON_KEY]: name }
  const money = (tab: 0 | 1): LinkedAdd[] => {
    const link = { ...base, [MONEY_DIRECTION_KEY]: tab === 0 ? 'له' : 'عليه' }
    const items: LinkedAdd[] = []
    if (tab === 0)
      for (const category of [...(isEmployee(person) ? [] : ['الراتب/معاش']), 'تعويض واسترجاع مصروف', 'كاش باك'])
        items.push({ label: `إيراد — ${category}`, type: 'إيراد', prefill: { 'التصنيف الرئيسي': category }, link })
    items.push({ label: 'دين / قرض / سلفة', type: 'دين / قرض / سلفة', prefill: { 'نوع الدين': tab === 0 ? 'لي — يدين لي' : 'له — أدين له', 'اسم الجهة': name }, link })
    return items
  }
  const self = person.typeKey === 'person_self'
  return [
    { group: 'إضافة مبلغ له', items: money(0) },
    { group: 'إضافة مبلغ عليه', items: money(1) },
    { group: 'المتابعة والتخطيط', items: FOLLOWUP_TYPES.map((x) => ({ label: x, type: x, prefill: {}, link: base })) },
    {
      group: 'أدوية',
      items: [
        {
          label: 'أدوية',
          type: 'أدوية',
          prefill: { 'لمن هذا الدواء': self ? 'أدوية لي' : 'أدوية لشخص آخر' },
          link: self ? base : { ...base, 'اسم المستفيد': name },
        },
      ],
    },
  ]
}
