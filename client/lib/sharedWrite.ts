import { supabase } from './supabase'
import type { Entry } from './data'
import { POT, hasBudget, iAmManager, memberNames, parseMoney, remaining, settlements, settleTransfers } from './shared'

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
      receipt: '',
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
