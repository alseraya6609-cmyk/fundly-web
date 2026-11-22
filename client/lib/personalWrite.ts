import { supabase } from './supabase'
import { PERSONAL_SLUG } from './catalog'
import type { Entry } from './data'
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

  غير متاح في الموقع (من التطبيق فقط): الأدوية، وأي نوع قديم، وبدء عهدة
  جديدة، والصرف من العهدة والتسوية والدفعات.
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
const REMINDER_LABELS = new Set(['تذكيرات', 'تذكير', 'التذكيرات'])

/** قائمة الإضافة كما في التطبيق (_entryCategories) بالأنواع المتاحة في الموقع. */
export const ADD_MENU: { group: string; title: string; subtitle: string; types: string[] }[] = [
  { group: 'financial', title: 'مالية', subtitle: 'مصروفات وإيرادات وديون', types: ['المصروفات الشخصية', 'إيراد', 'دين / قرض / سلفة', 'قسط', 'غرامة'] },
  { group: 'document', title: 'مستند', subtitle: 'وثائق وملفات مهمة', types: ['مستند'] },
  { group: 'organization', title: 'المتابعة والتخطيط', subtitle: 'مهام ومواعيد وعادات', types: ['مهمة', 'موعد', 'عادة', 'تذكير', 'ملاحظات'] },
  { group: 'medical_accounts', title: 'أدوية وبيانات وكلمات سر', subtitle: 'الأدوية والحسابات وكلمات المرور', types: ['كلمات سر'] },
  { group: 'lifestyle', title: 'نمط الحياة', subtitle: 'مناسبات واشتراكات وهدايا', types: ['مناسبة', 'اشتراك', 'هدية'] },
  { group: 'location', title: 'مواقع وأماكن', subtitle: 'أماكن ومواقع مهمة', types: ['مواقع وأماكن'] },
  { group: 'custody', title: 'عهدة مالية', subtitle: 'مبالغ تحت مسؤولية شخص', types: ['عهدة مالية'] },
]

/** أنواع تُضاف من التطبيق فقط (تحتاج ما لا يوفره الموقع). */
export const APP_ONLY_TYPES = ['أدوية']

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
export type SaveExtras = { me: Me; installments?: Installment[]; equalSplit?: boolean }

/** هل يُعدَّل هذا السجل من الموقع؟ (نوع متاح، وصاحبه أنا) */
export function canEdit(entry: Entry, userId: string | undefined): boolean {
  return !!userId && entry.user_id === userId && entry.entry_type in FORMS && entry.status !== 'محذوف'
}

// ---------------- الحقول ----------------

export type Values = Record<string, string>

/** _isFieldVisible */
export function isVisible(field: FormField, values: Values): boolean {
  if (field.label === 'التصنيف الفرعي') return false
  if (field.hidden) return false
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
const clockNow = () => {
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

/** قيم النموذج: فارغة للإضافة، ومن السجل للتعديل (_openFinancialEntryForm). */
export function initialValues(form: EntryForm, entry?: Entry, defaultCurrency = ''): { values: Values; custom: Values } {
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

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('انتهت الجلسة — ادخل من جديد')
  return data.user.id
}

/** رفع المرفق: نفس الحاوية ونفس شكل المسار في التطبيق. */
async function uploadAttachment(userId: string, file: File): Promise<string> {
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

export async function createEntry(form: EntryForm, values: Values, custom: Values, defaultCurrency: string, attachment?: File | null, extras?: SaveExtras) {
  const userId = await currentUserId()
  const { extra, due } = extrasFor(form, values, defaultCurrency, extras)
  let details = { ...detailsFrom(form, values, custom, defaultCurrency), ...extra }
  const core = coreFrom(form, details)
  if (due) core.dueDate = due
  if (extras?.me) details = withAssignment(form.label, details, holderNameOf(details), extras.me)
  const attachmentUrl = attachment ? await uploadAttachment(userId, attachment) : null
  const { error } = await supabase.from(TABLE).insert({
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
  if (error) throw error
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

function mergeDetails(base: Record<string, string>, mine: Record<string, string>, theirs: Record<string, string>) {
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
  await updateMerged(entry, {
    ...current,
    entry_type: entry.entry_type || form.label,
    title: core.title,
    amount: core.amountText ? parseAmountInt(core.amountText) : current.amount,
    due_date: databaseDate(core.dueDate),
    details: merged,
    attachment_url: attachmentUrl,
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
