import { supabase } from './supabase'
import type { Entry } from './data'
import { FORMS } from './personalForms.gen'
import { mergeDetails } from './personalWrite'
import { stampInvites } from './requestsWrite'
import { cycleDate, iAmManager, parseMoney, roscaParseDate } from './shared'

/*
  إنشاء الالتزام المشترك وتعديل بياناته كما في التطبيق
  (shared_commitments_screen.dart ← _sharedEntryForms و_openSharedEntryForm):
  - «مشاركات مشتركة» و«الرحلة / السفر»: المسؤول (أو مدير الرحلة) والأعضاء،
    وطريقة تحصيل المبلغ: «دفعة مقطوعة» بمساهمة إلزامية لكل عضو ومبلغ
    الالتزام مجموعها، أو «دفع فردي» بلا مساهمة.
  - «جمعية مالية» (تحديد الأدوار): الإجمالي ÷ الأعضاء، وعدد الدورات = عدد
    الأعضاء، وترتيب الاستلام، والمدة تكفي كل الدورات.
  - الأعضاء: «الأعضاء» JSON [{name, role}] بالمسؤول أولًا (ونائبه)، ويُحفظ
    دور كل عضو قائم عند التعديل. من له رقم تعريفي يُسجَّل وقت دعوته
    (stampInvites) والخادم يرسل الدعوة.
  - التعديل يبدأ من تفاصيل السجل القائمة، ويُكتب ما تغيّر فقط فوق أحدث
    نسخة في الخادم وبشرط ألا تكون تغيّرت.
*/

export type SharedFieldKind = 'text' | 'date' | 'number' | 'select' | 'multiline' | 'collect' | 'team' | 'person' | 'people' | 'order' | 'roscaInfo' | 'attachment'
export type SharedField = { label: string; kind: SharedFieldKind; required?: boolean; isTitle?: boolean; isAmount?: boolean; isPrimary?: boolean; half?: boolean; hidden?: boolean; options?: string[]; managerKey?: string; hint?: string }
export type SharedFormDef = { label: string; subtitle: string; fields: SharedField[] }

export const MEMBERS_KEY = 'الأعضاء / المشتركين'
const MEMBERS_JSON = 'الأعضاء'
const MANAGER_KEY = 'المسؤول'
const DEPUTY_KEY = 'نائب المسؤول'
const TRIP_MANAGER_KEY = 'مدير الرحلة'
const CREATOR_KEY = 'معرف المنشئ'
export const COLLECT_KEY = 'طريقة تحصيل المبلغ'
export const LUMP_SUM = 'دفعة مقطوعة'
export const INDIVIDUAL = 'دفع فردي'
export const APPROVAL_KEY = 'يحتاج المصروف موافقة المسؤول'
export const BUDGET_ALERT_KEY = 'تنبيه عند صرف نسبة'
export const BUDGET_ALERT_OPTIONS = ['بلا تنبيه', '50%', '75%', '90%', '100%']
const RECEIPTS_KEY = 'إيصالات الأرصدة'
const DOCS_VISIBILITY = 'مشاهدة المستندات'
export const COLLECT_HINTS: Record<string, string> = {
  [LUMP_SUM]: 'كل عضو يدفع نفس المبلغ من البداية ثم يُخصم من الرصيد',
  [INDIVIDUAL]: 'كل فرد يدفع المصروف منفردًا ثم تُعمل تسوية في نهاية الرحلة',
}

const PAYMENT = ['كاش', 'تحويل', 'شيك', 'أخرى']
const CURRENCY_OPTIONS = FORMS['قسط']?.fields.find((f) => f.label === 'العملة')?.options ?? []

export const SHARED_FORMS: Record<string, SharedFormDef> = {
  'مشاركات مشتركة': {
    label: 'مشاركات مشتركة',
    subtitle: 'مصروفات مشتركة مع الآخرين',
    fields: [
      { label: 'اسم المشاركة', kind: 'text', required: true, isTitle: true, isPrimary: true },
      { label: 'التصنيف', kind: 'select', required: true, options: ['مشاركة أكثر من يوم', 'لقاء قصير (يوم واحد)'] },
      { label: 'تاريخ البداية', kind: 'date', required: true, isPrimary: true, half: true },
      { label: 'تاريخ النهاية', kind: 'date', half: true },
      { label: 'المكان', kind: 'text', required: true, isPrimary: true },
      { label: COLLECT_KEY, kind: 'collect', required: true },
      { label: 'المسؤول / الأعضاء', kind: 'team', required: true, managerKey: MANAGER_KEY },
      { label: 'طريقة الدفع', kind: 'select', options: PAYMENT },
      { label: 'ملاحظات', kind: 'multiline' },
      { label: 'إرفاق مستند', kind: 'attachment' },
    ],
  },
  'الرحلة / السفر': {
    label: 'الرحلة / السفر',
    subtitle: 'رحلة مع الأعضاء ومصروفاتها',
    fields: [
      { label: 'اسم الرحلة', kind: 'text', required: true, isTitle: true, isPrimary: true },
      { label: 'تاريخ الرحلة', kind: 'date', required: true, isPrimary: true, half: true },
      { label: 'تاريخ العودة', kind: 'date', half: true },
      { label: 'الوجهة', kind: 'text', required: true, isPrimary: true },
      { label: COLLECT_KEY, kind: 'collect', required: true },
      { label: 'مدير الرحلة / الأعضاء', kind: 'team', required: true, managerKey: TRIP_MANAGER_KEY },
      { label: 'طريقة الدفع', kind: 'select', options: PAYMENT },
      { label: 'ملاحظات', kind: 'multiline' },
      { label: 'إرفاق مستند', kind: 'attachment' },
    ],
  },
  'جمعية مالية': {
    label: 'جمعية مالية',
    subtitle: 'تحديد أدوار دوري بترتيب استلام',
    fields: [
      { label: 'اسم الجمعية المالية', kind: 'text', required: true, isTitle: true, isPrimary: true, hint: 'مثال: مساعدة دراسية' },
      { label: 'تاريخ البداية', kind: 'date', required: true, isPrimary: true, half: true },
      { label: 'تاريخ النهاية', kind: 'date', half: true },
      { label: 'إجمالي المساهمة', kind: 'number', required: true, isAmount: true, isPrimary: true, half: true },
      { label: 'العملة', kind: 'select', options: CURRENCY_OPTIONS, half: true },
      { label: 'تكرار المساهمة', kind: 'select', required: true, options: ['شهري', 'نصف شهري', 'أسبوعي', 'سنوي'], half: true },
      { label: 'موعد الدفع الشهري', kind: 'date', required: true, half: true },
      { label: 'المساهمة على الشخص', kind: 'roscaInfo' },
      { label: MANAGER_KEY, kind: 'person', required: true, hidden: true },
      { label: MEMBERS_KEY, kind: 'people', required: true },
      { label: 'ترتيب الاستلام', kind: 'order' },
      { label: DOCS_VISIBILITY, kind: 'select', options: ['جميع الأعضاء', 'المسؤول فقط'] },
      { label: 'طريقة الدفع', kind: 'select', options: PAYMENT },
      { label: 'ملاحظات', kind: 'multiline' },
      { label: 'إرفاق مستند', kind: 'attachment' },
    ],
  },
}

/** حالة النموذج: النصوص والاختيارات، والمسؤول والأعضاء، ونصيب كل عضو، وترتيب الاستلام. */
export type SharedValues = {
  text: Record<string, string>
  select: Record<string, string>
  manager: string
  members: string[]
  shares: Record<string, string>
  order: string[]
  approval: string
  budgetAlert: string
  sharesManual: boolean
}

const asStrings = (d: Record<string, unknown> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)]))

const splitNames = (raw: string) =>
  raw
    .split('،')
    .map((x) => x.trim())
    .filter(Boolean)

/** _sharedLegacyKeys */
const LEGACY: Record<string, string> = { 'تاريخ الرحلة': 'تاريخ السفر' }

function parseMembers(d: Record<string, string>): { name: string; role: string }[] {
  try {
    const list = JSON.parse(d[MEMBERS_JSON] || '[]')
    return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object').map((x) => ({ name: String(x.name ?? ''), role: String(x.role ?? 'عضو') })) : []
  } catch {
    return []
  }
}

export const fmtShare = (v: number) => (v === Math.round(v) ? v.toFixed(0) : v.toFixed(2))

/** _autoSplitShares: بالتساوي والفرق على آخر شخص. */
export function autoSplit(totalText: string, people: string[]): Record<string, string> {
  const total = parseMoney(totalText)
  const out: Record<string, string> = {}
  if (total <= 0 || !people.length) return out
  const each = Math.floor((total / people.length) * 100) / 100
  people.forEach((p, i) => (out[p] = fmtShare(i === people.length - 1 ? total - each * (people.length - 1) : each)))
  return out
}

/** القيم الأولى: من السجل عند التعديل، وأنا المسؤول عند الإنشاء. */
export function initialShared(form: SharedFormDef, entry: Entry | undefined, me: string, defaultCurrency: string): SharedValues {
  const d = asStrings(entry?.details)
  const v: SharedValues = { text: {}, select: {}, manager: '', members: [], shares: {}, order: [], approval: 'نعم', budgetAlert: 'بلا تنبيه', sharesManual: false }
  for (const f of form.fields) {
    let existing = d[f.label] ?? ''
    if (!existing && LEGACY[f.label]) existing = d[LEGACY[f.label]] ?? ''
    if (f.kind === 'collect') {
      v.select[f.label] = existing
      v.approval = (d[APPROVAL_KEY] ?? '').trim() === 'لا' ? 'لا' : 'نعم'
      const alert = (d[BUDGET_ALERT_KEY] ?? '').trim()
      v.budgetAlert = BUDGET_ALERT_OPTIONS.includes(alert) ? alert : 'بلا تنبيه'
    } else if (f.kind === 'team') {
      v.manager = d[f.managerKey ?? MANAGER_KEY] ?? ''
      v.members = splitNames(d[MEMBERS_KEY] ?? '')
    } else if (f.kind === 'person') {
      v.manager = existing
    } else if (f.kind === 'people') {
      v.members = splitNames(existing)
    } else if (f.kind === 'select') {
      v.select[f.label] = existing || (f.label === 'العملة' ? defaultCurrency : '')
    } else if (!['order', 'roscaInfo', 'attachment'].includes(f.kind)) {
      v.text[f.label] = existing
    }
  }
  try {
    const raw = JSON.parse(d['تقسيم الأعضاء'] || '{}')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) v.shares = Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, String(x ?? '')]))
  } catch {
    // بلا تقسيم
  }
  if (entry && form.fields.some((f) => f.kind === 'order')) v.order = parseMembers(d).map((m) => m.name.trim()).filter(Boolean)
  // سجل بلا مفتاح المسؤول أو قائمة الأعضاء النصية: من «الأعضاء» المنظّمة.
  if (entry) {
    const list = parseMembers(d)
    if (!v.manager) v.manager = list.find((m) => m.role === 'مسؤول')?.name ?? ''
    if (!v.members.length) v.members = list.filter((m) => m.name !== v.manager && m.role !== 'نائب المسؤول').map((m) => m.name)
  }
  if (!entry && me && !v.manager) v.manager = me
  // سجل قديم بلا حقل العنوان في التفاصيل: العنوان من السجل نفسه.
  const titleField = form.fields.find((f) => f.isTitle)
  if (entry && titleField && !(v.text[titleField.label] ?? '').trim()) v.text[titleField.label] = entry.title ?? ''
  const dueField = form.fields.find((f) => f.kind === 'date' && f.isPrimary)
  const due = String(entry?.due_date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (entry && dueField && due && !(v.text[dueField.label] ?? '').trim()) v.text[dueField.label] = `${parseInt(due[3], 10)}/${parseInt(due[2], 10)}/${due[1]}`
  if (!entry && v.manager && form.fields.some((f) => f.kind === 'order')) v.order = [v.manager]
  return v
}

/** المسؤول ثم الأعضاء بلا تكرار (_roscaPeople). */
export const peopleOf = (v: SharedValues) => [...(v.manager ? [v.manager] : []), ...v.members.filter((m) => m !== v.manager)]

/** ترتيب الاستلام الظاهر: المحفوظ أولًا ثم من أُضيف بعده. */
export function orderedPeople(v: SharedValues): string[] {
  const people = peopleOf(v)
  const rank = (n: string) => (v.order.indexOf(n) < 0 ? v.order.length : v.order.indexOf(n))
  return [...people].sort((a, b) => rank(a) - rank(b))
}

const isRoscaForm = (form: SharedFormDef) => form.fields.some((f) => f.kind === 'roscaInfo')

/** المدة بين البداية والنهاية تكفي كل الدورات (آخر دورة). */
function lastCycle(v: SharedValues, count: number): Date | null {
  const start = roscaParseDate(v.text['تاريخ البداية'])
  if (!start) return null
  const frequency = (v.select['تكرار المساهمة'] ?? '').trim() || 'شهري'
  return cycleDate(start, frequency, count > 1 ? count - 1 : 1)
}

const dmy = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`

/** أخطاء النموذج بالترتيب نفسه في التطبيق. «|» يفصل أجزاء الترجمة. */
export function validateShared(form: SharedFormDef, v: SharedValues): string | null {
  for (const [endKey, startKey] of [
    ['تاريخ النهاية', 'تاريخ البداية'],
    ['تاريخ العودة', 'تاريخ الرحلة'],
  ]) {
    const from = roscaParseDate(v.text[startKey])
    const to = roscaParseDate(v.text[endKey])
    if (from && to && to < from) return `«|${endKey}|» |قبل| «|${startKey}|» — |صحّح التاريخين`
  }
  const title = form.fields.find((f) => f.isTitle)!
  if (!(v.text[title.label] ?? '').trim()) return `اكتب| «|${title.label}|» |أولًا — حقل إلزامي`
  for (const f of form.fields) {
    if (f.kind === 'text' || f.kind === 'date' || f.kind === 'number') {
      if (f.required && !(v.text[f.label] ?? '').trim()) return `يرجى إدخال| |${f.label}`
      if (f.kind === 'number' && (v.text[f.label] ?? '').trim() && parseMoney(v.text[f.label]) <= 0) return `يرجى إدخال| |${f.label}`
    }
    if (f.kind === 'select' && f.required && !(v.select[f.label] ?? '').trim()) return `يرجى اختيار| |${f.label}`
    if (f.kind === 'person' && f.required && !v.manager.trim()) return 'اختر المسؤول أولًا من «المسؤول / الأعضاء»'
    if (f.kind === 'people' && f.required && !v.members.filter((m) => m !== v.manager).length) return `${f.label}| |مطلوب — أضف عضوًا واحدًا على الأقل`
    if (f.kind === 'collect' && f.required && !(v.select[f.label] ?? '').trim()) return 'اختر طريقة تحصيل المبلغ'
    if (f.kind === 'team' && f.required) {
      if (!v.manager.trim()) return `اختر| ${f.managerKey}| |أولًا`
      if (!v.members.filter((m) => m !== v.manager).length) return 'أضف عضوًا واحدًا على الأقل'
      if (v.select[COLLECT_KEY] === LUMP_SUM && peopleOf(v).some((n) => parseMoney(v.shares[n] ?? '') <= 0))
        return 'المساهمة إلزامية مع «دفعة مقطوعة» — أدخل مبلغ مساهمة كل عضو'
    }
  }
  if (isRoscaForm(form)) {
    const people = peopleOf(v)
    if (people.length < 2) return 'تحديد الأدوار يحتاج عضوين على الأقل مع المسؤول'
    const start = roscaParseDate(v.text['تاريخ البداية'])
    const end = roscaParseDate(v.text['تاريخ النهاية'])
    if (start && end && end < start) return 'تاريخ النهاية قبل تاريخ البداية — صحّح التاريخين'
    const last = lastCycle(v, people.length)
    if (start && end && last && end < last)
      return `المدة بين تاريخ البداية والنهاية لا تكفي|: ${people.length} |دورات| |${(v.select['تكرار المساهمة'] ?? '').trim() || 'شهري'}| — |آخر دورة في| ${dmy(last)}`
  }
  return null
}

/** التفاصيل والمبلغ والاستحقاق والعنوان كما يبنيها التطبيق عند الحفظ. */
function build(form: SharedFormDef, v: SharedValues, base: Record<string, string>, me: string, creating: boolean, defaultCurrency: string) {
  const details: Record<string, string> = { ...base }
  if (creating && me) details[CREATOR_KEY] = me
  for (const f of form.fields) {
    if (f.kind === 'team') {
      details[f.managerKey ?? MANAGER_KEY] = v.manager.trim()
      details[MEMBERS_KEY] = v.members.filter((m) => m !== v.manager).join('، ')
    } else if (f.kind === 'select' || f.kind === 'collect') {
      details[f.label] = f.label === 'العملة' ? (v.select[f.label] ?? '').trim() || defaultCurrency : (v.select[f.label] ?? '')
      if (f.kind === 'collect') {
        if (v.select[f.label] === LUMP_SUM) {
          details[APPROVAL_KEY] = v.approval
          details[BUDGET_ALERT_KEY] = v.budgetAlert
        } else {
          delete details[APPROVAL_KEY]
          delete details[BUDGET_ALERT_KEY]
          delete details[RECEIPTS_KEY]
        }
      }
    } else if (f.kind === 'person') {
      details[f.label] = v.manager.trim()
    } else if (f.kind === 'people') {
      details[f.label] = v.members.filter((m) => m !== v.manager).join('، ')
    } else if (!['order', 'roscaInfo', 'attachment'].includes(f.kind)) {
      details[f.label] = (v.text[f.label] ?? '').trim()
    }
  }
  const manager = (details[MANAGER_KEY] ?? '').trim() || (details[TRIP_MANAGER_KEY] ?? '').trim()
  const deputy = (details[DEPUTY_KEY] ?? '').trim() || (details['نائب مدير الرحلة'] ?? '').trim()
  // أدوار الأعضاء القائمة غير القيادية تبقى كما هي.
  const previousRoles = new Map(parseMembers(base).filter((m) => m.role !== 'مسؤول' && m.role !== 'نائب المسؤول').map((m) => [m.name.trim(), m.role]))
  let members = [
    ...(manager ? [{ name: manager, role: 'مسؤول' }] : []),
    ...(deputy ? [{ name: deputy, role: 'نائب المسؤول' }] : []),
    ...v.members.filter((n) => n !== manager && n !== deputy).map((n) => ({ name: n, role: previousRoles.get(n.trim()) ?? 'عضو' })),
  ]
  let shares: Record<string, string> = { ...v.shares }
  if (isRoscaForm(form)) {
    // الجمعية: النصيب بالتساوي (_autoSplitShares) على المسؤول والأعضاء.
    shares = autoSplit(details['إجمالي المساهمة'] ?? '', peopleOf(v))
    if (v.order.length) {
      const rank = (n: string) => (v.order.indexOf(n.trim()) < 0 ? v.order.length : v.order.indexOf(n.trim()))
      members = [...members].sort((a, b) => rank(a.name) - rank(b.name))
    }
    const total = parseMoney(details['إجمالي المساهمة'] ?? '')
    const share = members.length ? total / members.length : 0
    details['المساهمة على الشخص'] = fmtShare(share)
    details['عدد الدورات'] = String(members.length)
  }
  details[MEMBERS_JSON] = JSON.stringify(members)
  for (const k of Object.keys(shares)) if (!members.some((m) => m.name === k)) delete shares[k]
  const amountField = form.fields.find((f) => f.isAmount) ?? form.fields[0]
  let amount = Math.round(parseMoney(v.text[amountField.label] ?? '0'))
  if (form.fields.some((f) => f.kind === 'team')) {
    if (v.select[COLLECT_KEY] === LUMP_SUM) amount = Math.round(Object.values(shares).reduce((s, x) => s + parseMoney(x), 0))
    else {
      amount = 0
      for (const k of Object.keys(shares)) delete shares[k]
    }
    details['إجمالي المساهمة'] = String(amount)
  }
  details['تقسيم الأعضاء'] = JSON.stringify(shares)
  const title = (v.text[form.fields.find((f) => f.isTitle)!.label] ?? '').trim()
  const dueField = form.fields.find((f) => f.kind === 'date' && f.isPrimary)
  const due = dueField ? (v.text[dueField.label] ?? '').trim() : ''
  return { details, amount, title, due }
}

const pad2 = (n: number) => String(n).padStart(2, '0')
function databaseDate(value: string): string | null {
  if (!value.trim()) return null
  const p = value.split('/')
  if (p.length !== 3) return value
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  if ([d, m, y].some(Number.isNaN)) return value
  return `${y}-${pad2(m)}-${pad2(d)}`
}

export class SharedFormError extends Error {}

async function uploadAttachment(uid: string, file: File): Promise<string> {
  const dot = file.name.lastIndexOf('.')
  const ext = dot < 0 || dot === file.name.length - 1 ? '' : file.name.slice(dot).replace(/[^a-zA-Z0-9.]/g, '')
  const path = `${uid}/${Date.now() * 1000 + Math.floor(Math.random() * 1000)}${ext}`
  const { error } = await supabase.storage.from('shared-entry-attachments').upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw error
  return path
}

async function currentUid() {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new SharedFormError('انتهت الجلسة — ادخل من جديد')
  return data.user.id
}

export async function createShared(form: SharedFormDef, v: SharedValues, me: string, defaultCurrency: string, attachment: File | null) {
  const problem = validateShared(form, v)
  if (problem) throw new SharedFormError(problem)
  const uid = await currentUid()
  const { details, amount, title, due } = build(form, v, {}, me, true, defaultCurrency)
  const attachmentUrl = attachment ? await uploadAttachment(uid, attachment) : null
  const { error } = await supabase.from('shared_entries').insert({
    user_id: uid,
    category: 'shared',
    entry_type: form.label,
    title,
    amount,
    due_date: databaseDate(due),
    status: 'نشطة',
    details: stampInvites(details),
    attachment_url: attachmentUrl,
  })
  if (error) throw error
}

/** تعديل بيانات الالتزام (للمسؤول من الموقع). */
export async function updateShared(entry: Entry, form: SharedFormDef, v: SharedValues, me: string, myNames: string[], defaultCurrency: string, attachment: File | null) {
  const problem = validateShared(form, v)
  if (problem) throw new SharedFormError(problem)
  if (!iAmManager(entry.details ?? {}, me, myNames)) throw new SharedFormError('تعديل الالتزام المشترك من الموقع للمسؤول وحده')
  const uid = await currentUid()
  const base = asStrings(entry.details)
  const { details: mine, amount, title, due } = build(form, v, base, me, false, defaultCurrency)
  const attachmentUrl = attachment ? await uploadAttachment(uid, attachment) : null
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('shared_entries').select('id, title, amount, due_date, details, attachment_url, updated_at').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) throw new SharedFormError('لم يعد هذا الالتزام موجودًا')
    const theirs = asStrings(data.details as Record<string, unknown>)
    const merged = stampInvites(mergeDetails(base, mine, theirs))
    // ما لم يتغيّر يُكتب بقيمته الأصلية في الخادم كما هي.
    const raw = (data.details ?? {}) as Record<string, unknown>
    const finalDetails: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(merged)) finalDetails[k] = k in raw && theirs[k] === val ? raw[k] : val
    const patch: Record<string, unknown> = { details: finalDetails }
    if (title !== entry.title) patch.title = title
    if (amount !== Math.round(Number(entry.amount) || 0)) patch.amount = amount
    const dueDb = databaseDate(due)
    if ((dueDb ?? null) !== (entry.due_date ? String(entry.due_date).slice(0, 10) : null)) patch.due_date = dueDb
    if (attachmentUrl) patch.attachment_url = attachmentUrl
    const { data: saved, error: saveError } = await supabase.from('shared_entries').update(patch).eq('id', entry.id).eq('updated_at', data.updated_at).select('id')
    if (saveError) throw saveError
    if (saved && saved.length) return
  }
  throw new SharedFormError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}
