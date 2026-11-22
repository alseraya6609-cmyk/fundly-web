import { supabase } from './supabase'
import type { Entry } from './data'
import { POT, cycleComplete, cycleShareOf, hasBudget, iAmManager, memberNames, memberPaid, paidBy, parseMoney, remaining, roscaParseDate, roscaPlan, settlements, settleTransfers, withoutFnd } from './shared'

/*
  أرشفة الالتزام المشترك وإخراجه من الأرشيف كما في التطبيق
  (shared_commitments_screen.dart ← _archiveCommitment و SharedMemberState):
  - فيه أعضاء آخرون بأرقامهم: الأرشفة عندي وحدي — رقمي في «مؤرشف عند»،
    ويصل الأعضاء إشعار من الخادم.
  - بلا أعضاء آخرين: حالة الالتزام نفسه «مؤرشف» أو «نشطة».
  الكتابة على أحدث نسخة في الخادم، للتفاصيل أو الحالة وحدها، وبشرط ألا يكون
  السجل تغيّر منذ قراءته.

  الحذف والمغادرة والإلغاء (التسوية والسجل التاريخي وسبب الحذف) من التطبيق.
*/

const ARCHIVED_KEY = 'مؤرشف عند'
const ACCEPT_KEY = 'قبول الأعضاء'
const ID = /FND-[A-Z2-9]{4}-[A-Z2-9]{4}/g
const ARCHIVED = 'مؤرشف'
const ACTIVE = 'نشطة'

const asStrings = (d: Record<string, unknown> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)]))

function idsIn(details: Record<string, string>, key: string): Set<string> {
  try {
    const list = JSON.parse(details[key] || '[]')
    return new Set(Array.isArray(list) ? list.map((v) => String(v).trim()).filter(Boolean) : [])
  } catch {
    return new Set()
  }
}

/** SharedMemberState.participants: كل الأرقام في التفاصيل بلا من رفض أو أُلغيت دعوته. */
function participants(details: Record<string, string>): Set<string> {
  const rejected = new Set<string>()
  try {
    const map = JSON.parse(details[ACCEPT_KEY] || '{}')
    if (map && typeof map === 'object')
      for (const [k, v] of Object.entries(map as Record<string, { state?: string }>))
        if (v && (v.state === 'rejected' || v.state === 'cancelled')) rejected.add(k)
  } catch {
    // تالف: لا أحد مستبعد.
  }
  const out = new Set<string>()
  for (const value of Object.values(details)) for (const m of value.matchAll(ID)) out.add(m[0])
  for (const r of rejected) out.delete(r)
  return out
}

export const archivedForMe = (e: Entry, me: string) => !!me && idsIn(asStrings(e.details), ARCHIVED_KEY).has(me)

type Row = { id: string; status: string; details: Record<string, unknown>; updated_at: string }
class Conflict extends Error {}
export class SharedError extends Error {}

/** archive=true أرشفة، false إخراج. */
export async function setSharedArchived(entry: Entry, me: string, archive: boolean): Promise<void> {
  if (!me) throw new SharedError('تعذر تنفيذ العملية. حاول مرة أخرى.')
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('shared_entries').select('id, status, details, updated_at').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) throw new SharedError('لم يعد هذا الالتزام موجودًا')
    const row = data as Row
    const details = asStrings(row.details)
    const mine = idsIn(details, ARCHIVED_KEY).has(me)
    let patch: Record<string, unknown> | null = null
    if (mine || (row.status !== ARCHIVED && [...participants(details)].some((id) => id !== me))) {
      // عندي وحدي: رقمي في «مؤرشف عند» (SharedMemberState.withMine — مرتّبة).
      if (mine === archive) return
      const set = idsIn(details, ARCHIVED_KEY)
      if (archive) set.add(me)
      else set.delete(me)
      patch = { details: { ...row.details, [ARCHIVED_KEY]: JSON.stringify([...set].sort()) } }
    } else {
      const archivedNow = row.status === ARCHIVED
      if (archivedNow === archive) return
      patch = { status: archive ? ARCHIVED : ACTIVE }
    }
    try {
      const { data: saved, error: saveError } = await supabase.from('shared_entries').update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
      if (saveError) throw saveError
      if (!saved || saved.length === 0) throw new Conflict()
      return
    } catch (e) {
      if (e instanceof Conflict) continue
      throw e
    }
  }
  throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

// ---------------- إضافة مصروف إلى دفتر الالتزام المشترك ----------------
/*
  كما في التطبيق (_InlineExpenseForm و _saveInlineExpense):
  - المسؤول يعتمد مصروفه مباشرة، وغيره «بانتظار الموافقة» — إلا مع الدفعة
    المقطوعة وقد أُلغي «يحتاج المصروف موافقة المسؤول».
  - من الميزانية المشتركة لا يُصرف أكثر من المتبقي فيها.
  - يُضاف المصروف إلى آخر «سجل المصروفات المشتركة» كما هو نصًّا (بلا إعادة
    كتابة المصروفات السابقة)، وتُصحَّح حالة الالتزام (نشطة/مكتملة) كما
    يفعل _persist. والخادم يرسل إشعار «أضاف مصروفًا» لبقية الأعضاء.
  - الفاتورة/الإيصال يُرفق من التطبيق.
*/


const EXPENSES_KEY = 'سجل المصروفات المشتركة'
const MEMBER_DATES_KEY = 'تواريخ الأعضاء'

export const EXPENSE_CATEGORIES: Record<string, string[]> = {
  'طعام ومشروبات': ['مطاعم', 'بقالة وسوبرماركت', 'توصيل وطلبات'],
  كوفيهات: [],
  مواصلات: ['تطبيقات توصيل', 'نقل عام وتاكسي', 'تأجير سيارة', 'وقود'],
  'فنادق وإقامة': [],
  'تذاكر ورسوم سفر': [],
  ترفيه: ['أنشطة وجولات', 'دخول أماكن'],
  تسوق: ['هدايا', 'ملابس'],
  مساعدات: [],
  'مصروفات أخرى': [],
}
export const EXPENSE_METHODS = ['بالتساوي', 'بالنسبة', 'بالمبلغ المحدد', 'بالحصص']
/** الأنواع التي فيها دفتر مصروفات (الجمعية لها دوراتها). */
export const LEDGER_TYPES = ['الرحلة / السفر', 'مشاركات مشتركة', 'اللقاءات']

function parseDmy(raw: string): Date | null {
  const p = raw.trim().split('/')
  if (p.length !== 3) return null
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  if ([d, m, y].some(Number.isNaN)) return null
  return new Date(y, m - 1, d)
}

/** SharedLedger.activeOn: هل كان العضو ضمن الالتزام يوم [day]؟ */
export function activeOn(details: Record<string, unknown>, member: string, day: Date): boolean {
  let map: Record<string, { join?: string; leave?: string }> = {}
  try {
    const raw = details[MEMBER_DATES_KEY]
    map = typeof raw === 'string' ? JSON.parse(raw || '{}') : ((raw as typeof map) ?? {})
  } catch {
    map = {}
  }
  const dates = map?.[member]
  if (!dates) return true
  const only = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const join = parseDmy(String(dates.join ?? ''))
  const leave = parseDmy(String(dates.leave ?? ''))
  if (join && only < join) return false
  if (leave && only > leave) return false
  return true
}

/** اسمي في قائمة الأعضاء (_myMemberName): برقمي، وإلا باسمي. */
export function myMemberName(details: Record<string, unknown>, me: string, myNames: string[]): string | null {
  const names = memberNames(details)
  return names.find((n) => !!me && n.includes(`(${me})`)) ?? names.find((n) => myNames.includes(n.trim())) ?? null
}

export function needsApproval(details: Record<string, unknown>): boolean {
  const method = String(details['طريقة تحصيل المبلغ'] ?? '').trim()
  const lump = method ? method === 'دفعة مقطوعة' : hasBudget(details)
  return !lump || String(details['يحتاج المصروف موافقة المسؤول'] ?? '').trim() !== 'لا'
}

export type ExpenseInput = {
  description: string
  category: string
  subcategory: string
  amount: number
  currency: string
  rate: number
  payer: string
  date: string
  participants: string[]
  method: string
  shares: Record<string, number>
  receipt?: string
}

/** يضيف المصروف. يعيد «معتمد» أو «بانتظار الموافقة». */
export async function addSharedExpense(entry: Entry, input: ExpenseInput, me: string, myNames: string[], publicName: string, entryCurrency: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('shared_entries').select('id, status, details, updated_at').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) throw new SharedError('لم يعد هذا الالتزام موجودًا')
    const row = data as Row
    const details = asStrings(row.details)
    const foreign = !!input.currency && input.currency !== entryCurrency
    const amount = foreign ? input.amount * input.rate : input.amount
    if (input.payer === POT && amount > remaining(details) + 0.01)
      throw new SharedError(`المتبقي في الميزانية ${remaining(details).toFixed(2)} — اختر من دفع الفرق أو أضف ميزانية إضافية`)
    const manager = iAmManager(details, me, myNames) || !needsApproval(details)
    const status = manager ? 'معتمد' : 'بانتظار الموافقة'
    const expense: Record<string, unknown> = {
      id: String(Date.now()),
      description: input.description.trim(),
      amount,
      payer: input.payer,
      date: input.date,
      participants: input.participants,
      method: input.method,
      shares: input.method === 'بالتساوي' ? {} : Object.fromEntries(input.participants.map((n) => [n, input.shares[n] ?? 0])),
      note: '',
      receipt: input.receipt ?? '',
      category: input.category,
      subcategory: input.subcategory,
      status,
      submittedBy: publicName,
      ...(foreign ? { currency: input.currency, originalAmount: input.amount, rate: input.rate } : {}),
    }
    // يُلحق بالنص كما هو: لا تُعاد كتابة المصروفات السابقة.
    const raw = (details[EXPENSES_KEY] ?? '').trim()
    let list = '[]'
    if (raw) {
      try {
        if (!Array.isArray(JSON.parse(raw))) throw new Error()
        list = raw
      } catch {
        throw new SharedError('تعذّرت قراءة سجل المصروفات — أضف المصروف من التطبيق')
      }
    }
    const body = list.slice(0, list.lastIndexOf(']')).trim()
    const nextList = `${body}${body === '[' ? '' : ','}${JSON.stringify(expense)}]`
    const nextDetails = { ...details, [EXPENSES_KEY]: nextList }
    const patch: Record<string, unknown> = { details: { ...row.details, [EXPENSES_KEY]: nextList } }
    // _resolvedStatus: مكتمل إن سُوّي كل شيء، وإلا نشط.
    if (row.status === 'نشطة' || row.status === 'مكتملة') {
      const done = settlements(nextDetails).length > 0 && settleTransfers(nextDetails, memberNames(nextDetails)).length === 0
      const wanted = done ? 'مكتملة' : 'نشطة'
      if (wanted !== row.status) patch.status = wanted
    }
    const { data: saved, error: saveError } = await supabase.from('shared_entries').update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (saveError) throw saveError
    if (saved && saved.length) return status
  }
  throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

export { parseMoney }

// ---------------- موافقة المسؤول والميزانية الإضافية ----------------
/*
  _decideExpense و _decideContribution: المسؤول يوافق على مصروف أو ميزانية
  إضافية أرسلها عضو أو يرفضها، فتصير «معتمد» أو «مرفوض» مع وقت القرار.
  _openContributionForm: ميزانية إضافية باسم من دفعها. من الموقع للمسؤول فقط،
  لأن العضو يلزمه إرفاق صورة الإيصال (من التطبيق).
*/

const CONTRIBUTIONS_KEY = 'سجل المساهمات'

function stampNow() {
  const n = new Date()
  const two = (v: number) => String(v).padStart(2, '0')
  return `${n.getDate()}/${n.getMonth() + 1}/${n.getFullYear()} ${two(n.getHours())}:${two(n.getMinutes())}`
}

/** قراءة أحدث نسخة، وتطبيق [change]، والكتابة بشرط عدم تغيّرها، مع تصحيح الحالة. */
async function mutateShared(entry: Entry, change: (details: Record<string, string>, raw: Record<string, unknown>) => Record<string, string>): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('shared_entries').select('id, status, details, updated_at').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) throw new SharedError('لم يعد هذا الالتزام موجودًا')
    const row = data as Row
    const details = asStrings(row.details)
    const changed = change(details, row.details)
    const nextDetails = { ...details, ...changed }
    const patch: Record<string, unknown> = { details: { ...row.details, ...changed } }
    if (row.status === 'نشطة' || row.status === 'مكتملة') {
      // _resolvedStatus: الجمعية تكتمل حين تكتمل كل دوراتها وتُسلَّم، وغيرها حين يُسوّى الحساب.
      const done = isCircleType(entry.entry_type)
        ? roscaDone(nextDetails)
        : settlements(nextDetails).length > 0 && settleTransfers(nextDetails, memberNames(nextDetails)).length === 0
      const wanted = done ? 'مكتملة' : 'نشطة'
      if (wanted !== row.status) patch.status = wanted
    }
    const { data: saved, error: saveError } = await supabase.from('shared_entries').update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (saveError) throw saveError
    if (saved && saved.length) return
  }
  throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

const isCircleType = (type: string) => type === 'جمعية مالية' || type === 'جمعية'

function roscaDone(details: Record<string, string>): boolean {
  const plan = roscaPlan(details, memberNames(details))
  return plan.cycles.length > 0 && plan.cycles.every((c) => cycleComplete(c) && c.payoutDate.trim() !== '')
}

/** الموافقة على مصروف أو ميزانية إضافية بانتظار الموافقة، أو رفضه. */
export async function decideLedgerItem(entry: Entry, kind: 'expense' | 'contribution', id: string, approve: boolean, me: string, myNames: string[]) {
  const key = kind === 'expense' ? EXPENSES_KEY : CONTRIBUTIONS_KEY
  await mutateShared(entry, (details) => {
    if (!iAmManager(details, me, myNames)) throw new SharedError('الموافقة والرفض للمسؤول وحده')
    let list: Record<string, unknown>[]
    try {
      const parsed = JSON.parse(details[key] || '[]')
      if (!Array.isArray(parsed)) throw new Error()
      list = parsed
    } catch {
      throw new SharedError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
    }
    const index = list.findIndex((x) => x && String(x.id) === id)
    if (index < 0) throw new SharedError('لم يعد هذا الطلب قائمًا')
    if (String(list[index].status ?? '') !== 'بانتظار الموافقة') throw new SharedError('سبق البت في هذا الطلب')
    const old = list[index]
    const decided: Record<string, unknown> = {}
    // ترتيب الحقول كما في التطبيق: وقت القرار بعد «submittedBy» للمصروف، وفي الآخر للمساهمة.
    for (const [k, v] of Object.entries(old)) {
      if (k === 'decidedAt') continue
      decided[k] = k === 'status' ? (approve ? 'معتمد' : 'مرفوض') : v
      if (kind === 'expense' && k === 'submittedBy') decided.decidedAt = stampNow()
    }
    if (!('decidedAt' in decided)) decided.decidedAt = stampNow()
    const next = [...list]
    next[index] = decided
    return { [key]: JSON.stringify(next) }
  })
}

/** ميزانية إضافية: معتمدة من المسؤول، وبانتظار موافقته من غيره (مع صورة الإيصال إلزامًا). يعيد الحالة. */
export async function addContribution(entry: Entry, member: string, amount: number, date: string, note: string, me: string, myNames: string[], publicName: string, receipt = ''): Promise<string> {
  let status = 'معتمد'
  await mutateShared(entry, (details) => {
    const manager = iAmManager(details, me, myNames)
    if (!manager && !receipt) throw new SharedError('أرفق صورة الإيصال أو الفاتورة لإثبات المبلغ')
    status = manager ? 'معتمد' : 'بانتظار الموافقة'
    const raw = (details[CONTRIBUTIONS_KEY] ?? '').trim()
    let list = '[]'
    if (raw) {
      try {
        if (!Array.isArray(JSON.parse(raw))) throw new Error()
        list = raw
      } catch {
        throw new SharedError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
      }
    }
    const item: Record<string, unknown> = { id: String(Date.now()), member, amount, date, note: note.trim(), status, submittedBy: publicName }
    if (receipt) item.receipt = receipt
    const body = list.slice(0, list.lastIndexOf(']')).trim()
    return { [CONTRIBUTIONS_KEY]: `${body}${body === '[' ? '' : ','}${JSON.stringify(item)}]` }
  })
  return status
}

// ---------------- تسوية الحساب (_openSettleUpSheet) ----------------

const SETTLEMENTS_KEY = 'سجل التسويات'

/**
  تسجيل تحويلات التسوية المقترحة للأعضاء المختارين (كل تحويلات العضو
  المختار). تُحسب التحويلات من أحدث نسخة؛ فإن تغيّرت عمّا عُرض يُطلب
  الفتح من جديد. يعيد true إن صار الحساب مسوّى بالكامل (الحالة «مكتملة»).
*/
export async function recordSettlements(entry: Entry, picked: string[], shown: { from: string; to: string; amount: number }[], receipt = ''): Promise<boolean> {
  let fully = false
  await mutateShared(entry, (details) => {
    const members = memberNames(details)
    const transfers = settleTransfers(details, members)
    const same =
      transfers.length === shown.length &&
      transfers.every((t, i) => t.from === shown[i].from && t.to === shown[i].to && Math.abs(t.amount - shown[i].amount) < 0.01)
    if (!same) throw new SharedError('تغيّرت الأرصدة منذ فتح التسوية — افتحها من جديد')
    const selected = transfers.map((t, i) => [t, i] as const).filter(([t]) => picked.some((n) => t.from === n || t.to === n))
    if (!selected.length) throw new SharedError('اختر عضوًا واحدًا على الأقل')
    const raw = (details[SETTLEMENTS_KEY] ?? '').trim()
    let list = '[]'
    if (raw) {
      try {
        if (!Array.isArray(JSON.parse(raw))) throw new Error()
        list = raw
      } catch {
        throw new SharedError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
      }
    }
    const now = new Date()
    const stamp = now.getTime()
    const rows = selected.map(([t, i]) => {
      const row: Record<string, unknown> = { id: String(stamp + i), from: t.from, to: t.to, amount: t.amount, date: `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`, note: '' }
      if (receipt) row.receipt = receipt
      return JSON.stringify(row)
    })
    const body = list.slice(0, list.lastIndexOf(']')).trim()
    const next = `${body}${body === '[' ? '' : ','}${rows.join(',')}]`
    fully = settleTransfers({ ...details, [SETTLEMENTS_KEY]: next }, members).length === 0
    return { [SETTLEMENTS_KEY]: next }
  })
  return fully
}

/** الدفعة المقطوعة (_isLumpSum): فيها ميزانية تُزاد بمساهمات إضافية. */
export function isLumpSum(details: Record<string, unknown>): boolean {
  const method = String(details['طريقة تحصيل المبلغ'] ?? '').trim()
  return method ? method === 'دفعة مقطوعة' : hasBudget(details)
}

// ---------------- الجمعية: المساهمات وتسليم الدورة ----------------
/*
  كما في التطبيق (shared_commitments_screen.dart ← _openRoscaPaymentForm،
  _roscaMarkAllPaid، _roscaDeletePayment، _roscaTogglePayout، و
  rosca_cycles.dart ← RoscaLedger): مفتاح واحد «سجل دورات الجمعية» خريطة
  رقم الدورة ← {payments، receiver، payout}. المساهمة تُضاف إلى payments،
  والتسليم تاريخ في payout (فارغ = إلغاء التسليم) مع حدث في «سجل الأحداث».
  تسجيل المساهمة لأي عضو كما في التطبيق؛ التسليم وإلغاؤه وحذف مساهمة من
  الموقع للمسؤول وحده.
*/

const CYCLES_KEY = 'سجل دورات الجمعية'
const EVENTS_KEY = 'سجل الأحداث'
const END_KEY = 'تاريخ النهاية'

const roscaDate = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
const plainMoney = (value: number, currency: string) => {
  const v = Math.abs(value)
  return `${v.toFixed(v % 1 === 0 ? 0 : 2)} ${currency}`.trim()
}

type CycleMap = Record<string, unknown>

function cyclesOf(details: Record<string, string>): CycleMap {
  const raw = (details[CYCLES_KEY] ?? '').trim()
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as CycleMap
  } catch {
    // تالف: لا يُكتب فوقه.
  }
  throw new SharedError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
}

function cycleAt(data: CycleMap, index: number): Record<string, unknown> {
  const e = data[String(index)]
  return e && typeof e === 'object' && !Array.isArray(e) ? { ...(e as Record<string, unknown>) } : {}
}

function paymentJson(p: { id: string; member: string; amount: number; date: string; note: string; receipt?: string }) {
  const row: Record<string, unknown> = { id: p.id, member: p.member, amount: p.amount, date: p.date, note: p.note }
  if (p.receipt) row.receipt = p.receipt
  return row
}

function withPayments(details: Record<string, string>, index: number, rows: Record<string, unknown>[]): string {
  const data = cyclesOf(details)
  const cycle = cycleAt(data, index)
  cycle.payments = [...(Array.isArray(cycle.payments) ? cycle.payments : []), ...rows]
  data[String(index)] = cycle
  return JSON.stringify(data)
}

/** _roscaWithEnoughEnd: النهاية المحفوظة لا تسبق آخر دورة. */
function enoughEnd(details: Record<string, string>): Record<string, string> {
  const end = roscaParseDate(details[END_KEY])
  if (!end || !roscaParseDate(details['تاريخ البداية'])) return {}
  let last: Date | null = null
  for (const c of roscaPlan(details, memberNames(details)).cycles) if (c.dueDate && (!last || c.dueDate > last)) last = c.dueDate
  if (!last || !(end < last)) return {}
  return { [END_KEY]: roscaDate(last) }
}

function withEvent(details: Record<string, string>, text: string): string {
  const raw = (details[EVENTS_KEY] ?? '').trim()
  let list = '[]'
  if (raw) {
    try {
      if (!Array.isArray(JSON.parse(raw))) throw new Error()
      list = raw
    } catch {
      throw new SharedError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
    }
  }
  const body = list.slice(0, list.lastIndexOf(']')).trim()
  return `${body}${body === '[' ? '' : ','}${JSON.stringify({ t: text, at: stampNow() })}]`
}

/** تغيير على الجمعية: يُكتب «سجل دورات الجمعية» (وما يلزم) فقط. */
function mutateRosca(entry: Entry, change: (details: Record<string, string>) => Record<string, string>) {
  return mutateShared(entry, (details) => {
    const changed = change(details)
    return { ...changed, ...enoughEnd({ ...details, ...changed }) }
  })
}

function cycleOf(details: Record<string, string>, index: number) {
  const names = memberNames(details)
  const plan = roscaPlan(details, names)
  const cycle = plan.cycles.find((c) => c.index === index)
  if (!cycle) throw new SharedError('لم تعد هذه الدورة موجودة')
  return { plan, cycle, names }
}

/** تسجيل مساهمة عضو في دورة. */
export async function addRoscaPayment(entry: Entry, index: number, member: string, amount: number, date: string, note: string, receipt = '') {
  if (!(amount > 0)) throw new SharedError('اكتب مبلغ المساهمة')
  await mutateRosca(entry, (details) => {
    const { names } = cycleOf(details, index)
    if (!names.includes(member)) throw new SharedError('لم يعد هذا العضو في الجمعية')
    const row = paymentJson({ id: String(Date.now()), member, amount, date, note: note.trim(), receipt })
    return { [CYCLES_KEY]: withPayments(details, index, [row]) }
  })
}

/** «سدّد الجميع»: بقية حصة كل من لم يسدّد في الدورة. يعيد عدد من سُجّلوا. */
export async function roscaMarkAllPaid(entry: Entry, index: number): Promise<number> {
  let count = 0
  await mutateRosca(entry, (details) => {
    const { plan, cycle, names } = cycleOf(details, index)
    if (plan.share <= 0) throw new SharedError('حدّد «المساهمة على الشخص» في بيانات تحديد الأدوار أولًا')
    const now = new Date()
    const stamp = now.getTime()
    const rows: Record<string, unknown>[] = []
    names
      .filter((m) => !memberPaid(cycle, m))
      .forEach((m, i) => {
        const rest = cycleShareOf(cycle, m) - paidBy(cycle, m)
        if (rest > 0) rows.push(paymentJson({ id: String(stamp + i), member: m, amount: rest, date: roscaDate(now), note: '' }))
      })
    if (!rows.length) throw new SharedError('سدّد الجميع حصصهم في هذه الدورة')
    count = rows.length
    return { [CYCLES_KEY]: withPayments(details, index, rows) }
  })
  return count
}

/** حذف مساهمة (للمسؤول). */
export async function deleteRoscaPayment(entry: Entry, index: number, paymentId: string, me: string, myNames: string[]) {
  await mutateRosca(entry, (details) => {
    if (!iAmManager(details, me, myNames)) throw new SharedError('هذا الإجراء للمسؤول وحده')
    const data = cyclesOf(details)
    const cycle = cycleAt(data, index)
    const rows = Array.isArray(cycle.payments) ? (cycle.payments as Record<string, unknown>[]) : []
    const kept = rows.filter((r) => !(r && typeof r === 'object' && String(r.id ?? '') === paymentId))
    if (kept.length === rows.length) throw new SharedError('لم تعد هذه المساهمة موجودة')
    cycle.payments = kept
    data[String(index)] = cycle
    return { [CYCLES_KEY]: JSON.stringify(data) }
  })
}

/** من لم تُسجَّل مساهمته في الدورة (غير صاحب الدور) وما بقي عليه. */
export function payoutUnpaid(details: Record<string, unknown>, index: number): { member: string; rest: number }[] {
  const { cycle, names } = cycleOf(asStrings(details), index)
  return names
    .filter((m) => m !== cycle.receiver && !memberPaid(cycle, m))
    .map((m) => ({ member: m, rest: cycleShareOf(cycle, m) - paidBy(cycle, m) }))
}

/** مبلغ الدورة كاملًا (plan.cycleTotal): ما يستلمه صاحب الدور. */
export function roscaCycleTotal(details: Record<string, unknown>, index: number): number {
  const { cycle, names } = cycleOf(asStrings(details), index)
  return names.reduce((s, m) => s + cycleShareOf(cycle, m), 0)
}

/**
  تسليم مبلغ الدورة لصاحب الدور أو إلغاؤه (للمسؤول). [recordUnpaid]: تُسجَّل
  بقية حصص من لم يسدّد مدفوعةً مع التسليم. [tr] لنص الحدث بلغة الواجهة كما
  يكتبه التطبيق.
*/
export async function roscaTogglePayout(
  entry: Entry,
  index: number,
  opts: { cancel: boolean; recordUnpaid: boolean; me: string; myNames: string[]; currency: string; tr: (s: string) => string },
) {
  const { tr } = opts
  await mutateRosca(entry, (details) => {
    if (!iAmManager(details, opts.me, opts.myNames)) throw new SharedError('هذا الإجراء للمسؤول وحده')
    const { cycle, names } = cycleOf(details, index)
    const paidOut = cycle.payoutDate.trim() !== ''
    if (opts.cancel !== paidOut) throw new SharedError('تغيّرت حالة الدورة — افتحها من جديد')
    let base = details
    const rows: Record<string, unknown>[] = []
    if (!opts.cancel) {
      if (!cycle.receiver.trim()) throw new SharedError('حدّد صاحب الدور أولًا')
      if (opts.recordUnpaid) {
        const now = new Date()
        const stamp = now.getTime()
        names
          .filter((m) => m !== cycle.receiver && !memberPaid(cycle, m))
          .forEach((m, i) => {
            const rest = cycleShareOf(cycle, m) - paidBy(cycle, m)
            if (rest > 0.01) rows.push(paymentJson({ id: String(stamp + i), member: m, amount: rest, date: roscaDate(now), note: 'سُجِّلت مع تسليم الدورة' }))
          })
        if (rows.length) base = { ...details, [CYCLES_KEY]: withPayments(details, index, rows) }
      }
    }
    const data = cyclesOf(base)
    const at = cycleAt(data, index)
    at.payout = opts.cancel ? '' : roscaDate(new Date())
    data[String(index)] = at
    const totalAmount = names.reduce((s, m) => s + cycleShareOf(cycle, m), 0)
    const text = opts.cancel
      ? `${tr('إلغاء تسليم مبلغ الدورة')} ${index}`
      : `${tr('تسليم')} ${plainMoney(totalAmount, opts.currency)} ${tr('إلى')} ${withoutFnd(cycle.receiver)} — ${tr('الدورة رقم')}: ${index}` +
        (rows.length ? ` — ${tr('مع تسجيل مساهمة')} ${rows.map((r) => withoutFnd(String(r.member))).join('، ')}` : '')
    return { [CYCLES_KEY]: JSON.stringify(data), [EVENTS_KEY]: withEvent(details, text) }
  })
}

/**
  _roscaChangeReceiver (للمسؤول): الجديد يأخذ هذه الدورة، وصاحبها السابق يأخذ
  دورة الجديد. لا تغيير لدورة سُلّم مبلغها ولا لمن استلم مبلغه.
*/
export async function roscaChangeReceiver(entry: Entry, index: number, picked: string, opts: { me: string; myNames: string[]; tr: (s: string) => string }) {
  const { tr } = opts
  await mutateRosca(entry, (details) => {
    if (!iAmManager(details, opts.me, opts.myNames)) throw new SharedError('هذا الإجراء للمسؤول وحده')
    const { plan, cycle, names } = cycleOf(details, index)
    if (!names.includes(picked)) throw new SharedError('لم يعد هذا العضو في الجمعية')
    if (cycle.payoutDate.trim()) throw new SharedError('سُلِّم مبلغ هذه الدورة — لا يمكن تغيير الدور')
    const old = cycle.receiver
    if (picked === old) throw new SharedError('تغيّرت حالة الدورة — افتحها من جديد')
    const other = plan.cycles.find((c) => c.index !== index && c.receiver === picked)
    if (other && other.payoutDate.trim()) throw new SharedError(`${withoutFnd(picked)} ${tr('استلم مبلغه — لا يمكن تغيير دوره')}`)
    const data = cyclesOf(details)
    const here = cycleAt(data, index)
    here.receiver = picked
    data[String(index)] = here
    const swap = other && old
    if (swap) {
      const there = cycleAt(data, other.index)
      there.receiver = old
      data[String(other.index)] = there
    }
    const text = swap
      ? `${tr('تغيير الدور')}: ${withoutFnd(picked)} ${tr('صاحب الدورة')} ${index}، ${withoutFnd(old)} ${tr('صاحب الدورة')} ${other.index}`
      : `${tr('تغيير الدور')}: ${withoutFnd(picked)} ${tr('صاحب الدورة')} ${index}`
    return { [CYCLES_KEY]: JSON.stringify(data), [EVENTS_KEY]: withEvent(details, text) }
  })
}

// ---------------- حذف الالتزام المشترك (_deleteCommitment) ----------------

const REMOVED_KEY = 'محذوف عند'

/** فيه أعضاء آخرون بأرقامهم؟ (SharedMemberState.sharedWithOthers) */
export function sharedWithOthers(details: Record<string, unknown>, me: string): boolean {
  if (!me) return false
  return [...participants(asStrings(details))].some((id) => id !== me)
}

/** SharedMemberState.removedByAll */
function removedByAll(details: Record<string, string>): boolean {
  const creator = (details[CREATOR_ID_KEY] ?? '').trim()
  if (!creator) return false
  const all = participants(details)
  if ([...all].every((id) => id === creator)) return false
  all.add(creator)
  const removed = idsIn(details, REMOVED_KEY)
  return [...all].every((id) => removed.has(id))
}
const CREATOR_ID_KEY = 'معرف المنشئ'

/**
  فيه أعضاء آخرون: يُحذف من عندي وحدي («محذوف عند»)، ويبقى عندهم ويصلهم
  إشعار، وآخر من يحذفه يحذفه من الخادم. بلا أعضاء آخرين: حذف نهائي.
  يعيد true إن حُذف من عندي وحدي.
*/
export async function deleteShared(entry: Entry, me: string): Promise<boolean> {
  if (!me) throw new SharedError('تعذر حذف الالتزام. حاول مرة أخرى.')
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('shared_entries').select('id, status, details, updated_at').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) return false
    const row = data as Row
    const details = asStrings(row.details)
    if (!sharedWithOthers(details, me)) {
      const { error: deleteError } = await supabase.from('shared_entries').delete().eq('id', row.id)
      if (deleteError) throw deleteError
      return false
    }
    const set = idsIn(details, REMOVED_KEY)
    set.add(me)
    const nextDetails = { ...details, [REMOVED_KEY]: JSON.stringify([...set].sort()) }
    const { data: saved, error: saveError } = await supabase
      .from('shared_entries')
      .update({ details: { ...row.details, [REMOVED_KEY]: nextDetails[REMOVED_KEY] } })
      .eq('id', row.id)
      .eq('updated_at', row.updated_at)
      .select('id')
    if (saveError) throw saveError
    if (!saved || saved.length === 0) continue
    // آخر عضو حذفه: يُحذف من الخادم (ينجح للمالك فقط حسب الصلاحيات).
    if (removedByAll(nextDetails)) await supabase.from('shared_entries').delete().eq('id', row.id)
    return true
  }
  throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}
