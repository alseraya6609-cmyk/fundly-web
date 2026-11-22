import { supabase } from './supabase'
import type { Entry } from './data'
import { POT, balances, cycleCollected, cycleComplete, cycleShareOf, expenses, hasBudget, iAmManager, memberNames, memberNets, memberPaid, members as membersOf, paidBy, parseMoney, remaining, roscaParseDate, roscaPlan, settlements, settleTransfers, withoutFnd } from './shared'
import { stampInvites } from './requestsWrite'

/*
  أرشفة الالتزام المشترك وإخراجه من الأرشيف كما في التطبيق
  (shared_commitments_screen.dart ← _archiveCommitment و SharedMemberState):
  - فيه أعضاء آخرون بأرقامهم: الأرشفة عندي وحدي — رقمي في «مؤرشف عند»،
    ويصل الأعضاء إشعار من الخادم.
  - بلا أعضاء آخرين: حالة الالتزام نفسه «مؤرشف» أو «نشطة».
  الكتابة على أحدث نسخة في الخادم، للتفاصيل أو الحالة وحدها، وبشرط ألا يكون
  السجل تغيّر منذ قراءته.

  الحذف والمغادرة والإلغاء والسجل التاريخي في آخر الملف (_deleteFlow).
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
export const roscaWithEnoughEnd = (details: Record<string, string>): Record<string, string> => ({ ...details, ...enoughEnd(details) })

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



// ---------------- الحذف والمغادرة والإلغاء والسجل التاريخي (_deleteFlow) ----------------
/*
  كما في التطبيق:
  - حساب لم يُسوَّ (_hasUnsettled) لا يُمسح: ينتقل إلى «السجل التاريخي»
    عندي («سجل تاريخي عند») أو يسوّى الآن.
  - المسؤول: سبب حذف إلزامي. مع أعضاء آخرين يُلغى عندهم («ملغاة» +
    «سبب الإلغاء» + حدث في «سجل الأحداث») ثم يُحذف من عندي؛ ووحده ينتقل إلى
    «المحذوفة عندي» (سلة المهملات).
  - العضو: «مغادرة المشاركة» (من عندي) بعد تسوية رصيده؛ والملغى: «موافق على
    الحذف» أو «أرشفة عندي».
  - آخر من يحذفه يحذفه من الخادم (purgeIfRemovedByAll).
*/

export const HISTORY_KEY = 'سجل تاريخي عند'
export const CANCEL_REASON_KEY = 'سبب الإلغاء'

export const isCancelledShared = (e: Entry) => e.status === 'ملغاة' || e.status === 'ملغية'
export const inHistoryForMe = (e: Entry, me: string) => !!me && idsIn(asStrings(e.details), HISTORY_KEY).has(me)
export const removedForMe = (e: Entry, me: string) => !!me && idsIn(asStrings(e.details), REMOVED_KEY).has(me)

/** _hasUnsettled: مبالغ معلّقة، وفي الجمعية دورات بدأت ولم تكتمل وتُسلَّم كلها. */
export function hasUnsettled(e: Entry): boolean {
  const details = e.details ?? {}
  const names = memberNames(details)
  if (isCircleType(e.entry_type)) {
    const cycles = roscaPlan(details, names).cycles
    const started = cycles.some((c) => cycleCollected(c) > 0.01 || c.payoutDate.trim() !== '')
    const finished = cycles.length > 0 && cycles.every((c) => cycleComplete(c) && c.payoutDate.trim() !== '')
    return started && !finished
  }
  return settleTransfers(details, names).length > 0
}

/** رصيدي لم يُسوَّ (للمغادرة): في الجمعية كل الحساب، وفي غيرها صافيّ. */
export function myAccountOpen(e: Entry, myName: string | null): boolean {
  if (isCircleType(e.entry_type)) return hasUnsettled(e)
  if (!myName) return false
  return Math.abs(memberNets(e.details ?? {}, [myName])[myName] ?? 0) > 0.01
}

/** SharedMemberState.markMine: رقمي في [key] أو خارجه، على أحدث نسخة. يعيد false إن لم يعد موجودًا. */
export async function markMine(entry: Entry, key: string, me: string, add: boolean): Promise<boolean> {
  if (!me) throw new SharedError('تعذّر الحفظ. حاول مرة أخرى.')
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('shared_entries').select('id, status, details, updated_at').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) return false
    const row = data as Row
    const details = asStrings(row.details)
    const set = idsIn(details, key)
    if (add) set.add(me)
    else set.delete(me)
    const value = JSON.stringify([...set].sort())
    const { data: saved, error: saveError } = await supabase
      .from('shared_entries')
      .update({ details: { ...row.details, [key]: value } })
      .eq('id', row.id)
      .eq('updated_at', row.updated_at)
      .select('id')
    if (saveError) throw saveError
    if (!saved || !saved.length) continue
    if (add && key === REMOVED_KEY && removedByAll({ ...details, [key]: value })) await supabase.from('shared_entries').delete().eq('id', row.id)
    return true
  }
  throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

/** المسؤول مع أعضاء آخرين: «ملغاة» عند الجميع بسببه وحدث في السجل، ثم من عندي. */
export async function cancelSharedForAll(entry: Entry, me: string, actor: string, why: string, tr: (s: string) => string) {
  const reason = why.trim()
  if (!reason) throw new SharedError('اكتب سبب الحذف')
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('shared_entries').select('id, status, details, updated_at').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) throw new SharedError('لم يعد هذا الالتزام موجودًا')
    const row = data as Row
    const details = asStrings(row.details)
    const changed = { [CANCEL_REASON_KEY]: reason, [EVENTS_KEY]: withEvent(details, `${withoutFnd(actor) || actor} ${tr('ألغى الالتزام')}: ${reason}`) }
    const { data: saved, error: saveError } = await supabase
      .from('shared_entries')
      .update({ status: 'ملغاة', details: { ...row.details, ...changed } })
      .eq('id', row.id)
      .eq('updated_at', row.updated_at)
      .select('id')
    if (saveError) throw saveError
    if (saved && saved.length) {
      await markMine(entry, REMOVED_KEY, me, true)
      return
    }
  }
  throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

// ---------------- انضمام عضو ومغادرته بتاريخ (_memberJoin / _memberLeave) ----------------

type MemberDates = Record<string, Record<string, string>>
function memberDatesOf(details: Record<string, string>): MemberDates {
  try {
    const decoded = JSON.parse(details[MEMBER_DATES_KEY] || '{}')
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return {}
    const out: MemberDates = {}
    for (const [k, v] of Object.entries(decoded)) if (v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([a, b]) => [a, String(b ?? '')]))
    return out
  } catch {
    return {}
  }
}
const dayText = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
export const leaveOf = (details: Record<string, unknown>, member: string) => memberDatesOf(asStrings(details))[member]?.leave ?? ''
export const joinOf = (details: Record<string, unknown>, member: string) => memberDatesOf(asStrings(details))[member]?.join ?? ''

/** اسم المسؤول (_managerName). */
export function managerNameOf(details: Record<string, unknown>): string {
  const m = membersOf(details).find((x) => x.role === 'مسؤول')
  if (m) return m.name.trim()
  return String(details['مدير الرحلة'] ?? details['المسؤول'] ?? '').trim()
}

/** من يمكن تسجيل مغادرته: غير المسؤول ولم يغادر. */
export function leaveCandidates(details: Record<string, unknown>): string[] {
  const manager = managerNameOf(details)
  return memberNames(details).filter((n) => n.trim() !== manager && !leaveOf(details, n.trim()))
}

/** مصروفات تشمله بعد المغادرة أو معلّقة (تُعدَّل أولًا). */
export function leaveBlocking(details: Record<string, unknown>, name: string, day: Date): number {
  const only = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  return expenses(details).filter((e) => {
    if (!(e.participants.includes(name) || e.payer === name)) return false
    if (e.status === 'بانتظار الموافقة') return true
    const at = parseDmy(e.date)
    return e.status === 'معتمد' && !!at && at > only
  }).length
}

/** رصيد العضو الخام (له موجب، عليه سالب). */
export const rawBalanceOf = (details: Record<string, unknown>, name: string) => balances(details, memberNames(details))[name] ?? 0

export async function recordMemberLeave(entry: Entry, name: string, day: Date, settle: boolean, tr: (s: string) => string) {
  await mutateShared(entry, (details) => {
    if (leaveBlocking(details, name, day) > 0) throw new SharedError('مصروفات تشمله بعد تاريخ المغادرة أو بانتظار الموافقة')
    const dates = memberDatesOf(details)
    dates[name] = { ...(dates[name] ?? {}), leave: dayText(day) }
    const changed: Record<string, string> = { [MEMBER_DATES_KEY]: JSON.stringify(dates) }
    if (settle) {
      const net = rawBalanceOf(details, name)
      if (Math.abs(net) > 0.01) {
        const owes = net < -0.01
        const party = isLumpSum(details) ? POT : managerNameOf(details)
        const now = new Date()
        const list = settlements(details).map((x) => {
          const row: Record<string, unknown> = { id: x.id, from: x.from, to: x.to, amount: x.amount, date: x.date, note: x.note }
          if (x.receipt) row.receipt = x.receipt
          return row
        })
        list.push({ id: String(now.getTime()), from: owes ? name : party, to: owes ? party : name, amount: Math.abs(net), date: dayText(now), note: tr('تسوية عند المغادرة') })
        changed[SETTLEMENTS_KEY] = JSON.stringify(list)
      }
    }
    return changed
  })
}

export async function recordMemberJoin(entry: Entry, name: string, day: Date) {
  const clean = name.trim()
  if (!clean) return
  await mutateShared(entry, (details) => {
    const dates = memberDatesOf(details)
    dates[clean] = { join: dayText(day) }
    let changed: Record<string, string> = { [MEMBER_DATES_KEY]: JSON.stringify(dates) }
    const list = membersOf(details)
    if (!list.some((m) => m.name.trim() === clean)) {
      const names = (details['الأعضاء / المشتركين'] ?? '')
        .split('،')
        .map((x) => x.trim())
        .filter(Boolean)
      names.push(clean)
      changed['الأعضاء'] = JSON.stringify([...list.map((m) => ({ name: m.name, role: m.role })), { name: clean, role: 'عضو' }])
      changed['الأعضاء / المشتركين'] = names.join('، ')
      const stamped = stampInvites({ ...details, ...changed })
      if (stamped['وقت دعوة الأعضاء'] !== details['وقت دعوة الأعضاء']) changed = { ...changed, 'وقت دعوة الأعضاء': stamped['وقت دعوة الأعضاء'] }
    }
    return changed
  })
}

/** المحذوفة عندي: حذفها كل الأعضاء ← تُحذف من الخادم (purgeIfRemovedByAll). يعيد true إن حُذفت. */
export async function purgeIfRemovedByAll(entry: Entry): Promise<boolean> {
  if (!removedByAll(asStrings(entry.details))) return false
  const { data } = await supabase.from('shared_entries').delete().eq('id', entry.id).select('id')
  return !!data && data.length > 0
}

// ---------------- حذف مصروف (_deleteExpense) ----------------

/** المسؤول يحذف أي مصروف؛ والعضو ما أرسله ولم يُعتمد بعد. */
export function canDeleteExpense(e: { status: string; submittedBy: string }, manager: boolean, myNames: string[]): boolean {
  if (manager) return true
  const by = (e.submittedBy ?? '').trim()
  return e.status !== 'معتمد' && !!by && myNames.includes(by)
}

export async function deleteSharedExpense(entry: Entry, id: string, me: string, myNames: string[]) {
  await mutateShared(entry, (details) => {
    let list: unknown[] = []
    try {
      const raw = JSON.parse(details[EXPENSES_KEY] || '[]')
      if (!Array.isArray(raw)) throw new Error()
      list = raw
    } catch {
      throw new SharedError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
    }
    const row = list.find((x) => x && typeof x === 'object' && String((x as Record<string, unknown>).id ?? '') === id) as Record<string, unknown> | undefined
    if (!row) throw new SharedError('لم يعد هذا المصروف موجودًا')
    const manager = iAmManager(details, me, myNames)
    if (!canDeleteExpense({ status: String(row.status ?? 'معتمد'), submittedBy: String(row.submittedBy ?? '') }, manager, myNames))
      throw new SharedError('حذف المصروف المعتمد للمسؤول وحده')
    return { [EXPENSES_KEY]: JSON.stringify(list.filter((x) => x !== row)) }
  })
}

// ---------------- أعضاء تحديد الأدوار (_openAddMemberSheet / _removeRoscaMember) ----------------

const MEMBERS_TEXT_KEY = 'الأعضاء / المشتركين'

export async function roscaAddMember(entry: Entry, name: string, me: string, myNames: string[]) {
  const clean = name.trim()
  if (!clean) return
  await mutateRosca(entry, (details) => {
    if (!iAmManager(details, me, myNames)) throw new SharedError('هذا الإجراء للمسؤول وحده')
    const list = membersOf(details)
    if (list.some((m) => m.name.trim() === clean)) throw new SharedError(`${withoutFnd(clean)} موجود في الأعضاء`)
    const names = (details[MEMBERS_TEXT_KEY] ?? '')
      .split('،')
      .map((x) => x.trim())
      .filter(Boolean)
    names.push(clean)
    const changed: Record<string, string> = {
      الأعضاء: JSON.stringify([...list.map((m) => ({ name: m.name, role: m.role })), { name: clean, role: 'عضو' }]),
      [MEMBERS_TEXT_KEY]: names.join('، '),
    }
    const stamped = stampInvites({ ...details, ...changed })
    if (stamped['وقت دعوة الأعضاء'] !== details['وقت دعوة الأعضاء']) changed['وقت دعوة الأعضاء'] = stamped['وقت دعوة الأعضاء']
    return changed
  })
}

/** من يمكن إلغاؤه: غير المسؤول. */
export const roscaRemovable = (details: Record<string, unknown>) =>
  membersOf(details)
    .filter((m) => m.role !== 'مسؤول' && m.name.trim())
    .map((m) => m.name.trim())

/** لا يُلغى من سجّل دفعات أو استلم دوره. */
export function roscaRemoveBlocked(details: Record<string, unknown>, name: string): boolean {
  const plan = roscaPlan(details, memberNames(details))
  const paid = plan.cycles.reduce((s, c) => s + paidBy(c, name), 0)
  return paid > 0.01 || plan.cycles.some((c) => c.receiver === name && c.payoutDate.trim() !== '')
}

export const roscaTurnOf = (details: Record<string, unknown>, name: string) => roscaPlan(details, memberNames(details)).cycles.find((c) => c.receiver === name)?.index ?? null

export async function roscaRemoveMember(entry: Entry, name: string, me: string, myNames: string[]) {
  await mutateRosca(entry, (details) => {
    if (!iAmManager(details, me, myNames)) throw new SharedError('هذا الإجراء للمسؤول وحده')
    if (!roscaRemovable(details).includes(name)) throw new SharedError('لم يعد هذا العضو في الجمعية')
    if (roscaRemoveBlocked(details, name)) throw new SharedError('لا يمكن إلغاء عضو سجّل دفعات أو استلم دوره')
    const plan = roscaPlan(details, memberNames(details))
    const list = membersOf(details).filter((m) => m.name.trim() !== name)
    const names = (details[MEMBERS_TEXT_KEY] ?? '')
      .split('،')
      .map((x) => x.trim())
      .filter((x) => x && x !== name)
    // دورة كان صاحبها: يعود لترتيب الأعضاء الافتراضي.
    const changed: Record<string, string> = {
      الأعضاء: JSON.stringify(list.map((m) => ({ name: m.name, role: m.role }))),
      [MEMBERS_TEXT_KEY]: names.join('، '),
    }
    if (plan.cycles.some((c) => c.receiver === name)) {
      const data = cyclesOf(details)
      for (const c of plan.cycles) {
        if (c.receiver !== name) continue
        const here = cycleAt(data, c.index)
        here.receiver = ''
        data[String(c.index)] = here
      }
      changed[CYCLES_KEY] = JSON.stringify(data)
    }
    return changed
  })
}

// ---------------- المتابعة والتخطيط، المستندات، المواقع والأماكن (_SimpleEntry) ----------------

export const FOLLOW_KEY_SHARED = 'متابعة وتخطيط'
export const DOCS_KEY_SHARED = 'مستندات'
export const PLACES_KEY_SHARED = 'مواقع وأماكن'
export const SHARED_FOLLOW_KINDS = ['مهمة', 'موعد', 'عادة', 'تذكير', 'ملاحظات']
export const DOC_BY_KEY = '__by'

export type SimpleEntry = { kind: string; title: string; note: string; date: string; extra: Record<string, string> }

export function simpleEntries(details: Record<string, unknown>, key: string): SimpleEntry[] {
  const raw = details[key]
  let list: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return []
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
    .map((x) => {
      const m = x as Record<string, unknown>
      const extra = m.extra && typeof m.extra === 'object' && !Array.isArray(m.extra) ? Object.fromEntries(Object.entries(m.extra as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : {}
      return { kind: String(m.kind ?? ''), title: String(m.title ?? ''), note: String(m.note ?? ''), date: String(m.date ?? ''), extra }
    })
}

const simpleJson = (e: SimpleEntry) => {
  const row: Record<string, unknown> = { kind: e.kind, title: e.title, note: e.note, date: e.date }
  if (Object.keys(e.extra).length) row.extra = e.extra
  return row
}

function storedSimple(details: Record<string, string>, key: string): SimpleEntry[] {
  const raw = (details[key] ?? '').trim()
  if (raw) {
    try {
      if (!Array.isArray(JSON.parse(raw))) throw new Error()
    } catch {
      throw new SharedError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
    }
  }
  return simpleEntries(details, key)
}

const same = (a: SimpleEntry, b: SimpleEntry) => a.kind === b.kind && a.title === b.title && a.date === b.date

/** إضافة عنصر، أو تعديله (يحتفظ بحالة الاكتمال) — [at] موضعه و[was] ما عُرض. */
export async function saveSimpleEntry(entry: Entry, key: string, item: SimpleEntry, edit?: { at: number; was: SimpleEntry }) {
  await mutateShared(entry, (details) => {
    const list = storedSimple(details, key)
    if (edit) {
      const old = list[edit.at]
      if (!old || !same(old, edit.was)) throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
      const status = old.extra['الحالة'] ?? ''
      const by = old.extra[DOC_BY_KEY] ?? ''
      list[edit.at] = { ...item, extra: { ...item.extra, ...(by ? { [DOC_BY_KEY]: by } : {}), ...(status ? { الحالة: status } : {}) } }
    } else list.push(item)
    return { [key]: JSON.stringify(list.map(simpleJson)) }
  })
}

export async function toggleSimpleDone(entry: Entry, key: string, at: number, was: SimpleEntry, tr: (s: string) => string) {
  await mutateShared(entry, (details) => {
    const list = storedSimple(details, key)
    const e = list[at]
    if (!e || !same(e, was)) throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
    const done = (e.extra['الحالة'] ?? '') === 'مكتملة'
    const extra = { ...e.extra }
    if (done) delete extra['الحالة']
    else extra['الحالة'] = 'مكتملة'
    list[at] = { ...e, extra }
    const text = `${tr(done ? 'إلغاء اكتمال' : 'اكتمال')} ${tr(e.kind)}: ${e.title}`
    return { [key]: JSON.stringify(list.map(simpleJson)), [EVENTS_KEY]: withEvent(details, text) }
  })
}

export async function deleteSimpleEntry(entry: Entry, key: string, at: number, was: SimpleEntry, tr: (s: string) => string) {
  await mutateShared(entry, (details) => {
    const list = storedSimple(details, key)
    const e = list[at]
    if (!e || !same(e, was)) throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
    list.splice(at, 1)
    return { [key]: JSON.stringify(list.map(simpleJson)), [EVENTS_KEY]: withEvent(details, `${tr('حذف')} ${tr(e.kind)}: ${e.title}`) }
  })
}

/** _purgeShared: حذف نهائي للمحذوف عندي — وحدي فقط (مع أعضاء آخرين يُحذف حين يحذفه الجميع). */
export async function purgeSharedAlone(entry: Entry, me: string) {
  if (sharedWithOthers(entry.details ?? {}, me) && !removedByAll(asStrings(entry.details))) throw new SharedError('يُحذف نهائيًا حين يحذفه كل الأعضاء')
  const { error } = await supabase.from('shared_entries').delete().eq('id', entry.id)
  if (error) throw error
}

export { REMOVED_KEY as SHARED_REMOVED_KEY }
