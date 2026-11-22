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

  غير متاح في الموقع (من التطبيق فقط): الدين/القرض والعهدة (الإسناد إلى حساب
  آخر)، القسط (جدول الأقساط)، الأدوية، وأي نوع قديم.
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
  { group: 'financial', title: 'مالية', subtitle: 'مصروفات وإيرادات وديون', types: ['المصروفات الشخصية', 'إيراد', 'غرامة'] },
  { group: 'document', title: 'مستند', subtitle: 'وثائق وملفات مهمة', types: ['مستند'] },
  { group: 'organization', title: 'المتابعة والتخطيط', subtitle: 'مهام ومواعيد وعادات', types: ['مهمة', 'موعد', 'عادة', 'تذكير', 'ملاحظات'] },
  { group: 'medical_accounts', title: 'أدوية وبيانات وكلمات سر', subtitle: 'الأدوية والحسابات وكلمات المرور', types: ['كلمات سر'] },
  { group: 'lifestyle', title: 'نمط الحياة', subtitle: 'مناسبات واشتراكات وهدايا', types: ['مناسبة', 'اشتراك', 'هدية'] },
  { group: 'location', title: 'مواقع وأماكن', subtitle: 'أماكن ومواقع مهمة', types: ['مواقع وأماكن'] },
]

/** أنواع تُضاف من التطبيق فقط (تحتاج ما لا يوفره الموقع). */
export const APP_ONLY_TYPES = ['دين / قرض / سلفة', 'قسط', 'عهدة مالية', 'أدوية']

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
export function validate(form: EntryForm, values: Values, custom: Values): string | null {
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

export async function createEntry(form: EntryForm, values: Values, custom: Values, defaultCurrency: string, attachment?: File | null) {
  const userId = await currentUserId()
  const details = detailsFrom(form, values, custom, defaultCurrency)
  const core = coreFrom(form, details)
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

export async function updateEntry(entry: Entry, form: EntryForm, values: Values, custom: Values, defaultCurrency: string, attachment?: File | null) {
  const userId = await currentUserId()
  const details = detailsFrom(form, values, custom, defaultCurrency)
  const core = coreFrom(form, details)
  const old = asStrings(entry.details)
  const labels = new Set(form.fields.map((f) => f.label))
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(old)) if (!labels.has(k) && !k.startsWith('القسط ')) merged[k] = v
  Object.assign(merged, details)
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
