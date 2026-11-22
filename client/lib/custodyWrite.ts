import type { Entry } from './data'
import { EntryError, clockNow, currentUserId, mutateEntry, parseAmountInt, roleFor, totalPaid, uploadAttachment, type Me } from './personalWrite'

/*
  إدارة العهدة المالية وإلغاء الدين كما في تفاصيل الالتزام في التطبيق
  (personal_commitments_screen.dart):
  - _openCustodySpendForm: الصرف للمسند إليه بعد قبوله (أو لصاحبها إن لم تُسند)،
    يُضاف آخر «سجل صرفيات العهدة»؛ ويُرسل لاعتماد صاحبها إن اشترط ذلك.
    نفاد الرصيد = «تمت التسوية».
  - _setCustodySpendState: صاحبها يعتمد المصروف أو يرفضه.
  - _openCustodyTopUpForm: صاحبها يضيف مبلغًا («سجل زيادات العهدة»).
  - _settleCustody و_cancelCustody و_applyCustodySettlement: لا تسوية ولا
    إلغاء ومصروفات بانتظار الاعتماد؛ الملاحظة إلزامية والمتبقي يُسجَّل مُعادًا.
  - _toggleCustodyFreeze و_reopenCustody.
  - _cancelDebt و_settleBeforeDelete للدين.
  الكتابة على أحدث نسخة وبشرط ألا يكون السجل تغيّر (mutateEntry).
*/

export const SPENDS_KEY = 'سجل صرفيات العهدة'
const TOPUPS_KEY = 'سجل زيادات العهدة'
const STATE_KEY = 'حالة الاعتماد'
const PENDING = 'بانتظار الاعتماد'
const APPROVED = 'معتمد'
const REJECTED = 'مرفوض'
const pad2 = (n: number) => String(n).padStart(2, '0')
const stampNow = () => {
  const n = new Date()
  return `${n.getDate()}/${n.getMonth() + 1}/${n.getFullYear()} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`
}
const today = () => {
  const n = new Date()
  return `${n.getDate()}/${n.getMonth() + 1}/${n.getFullYear()}`
}

type Row = Record<string, string>

function listOf(details: Record<string, unknown>, key: string): Row[] {
  try {
    const raw = details[key]
    const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw ?? [])
    return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object').map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v == null ? '' : String(v)]))) : []
  } catch {
    return []
  }
}

/** قراءة القائمة للكتابة: التالفة لا يُكتب فوقها. */
function strictList(details: Record<string, string>, key: string): Row[] {
  const raw = (details[key] ?? '').trim()
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    if (Array.isArray(list)) return listOf(details, key)
  } catch {
    // تالف
  }
  throw new EntryError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
}

export const spends = (details: Record<string, unknown>) => listOf(details, SPENDS_KEY)
const counts = (row: Row) => row[STATE_KEY] !== PENDING && row[STATE_KEY] !== REJECTED

/** _custodyTotalSpent: المعتمد وما لا يحتاج اعتمادًا، وما سُجّل خطأً دفعاتٍ. */
export function custodySpent(details: Record<string, unknown>) {
  return spends(details).filter(counts).reduce((s, r) => s + parseAmountInt(r['المبلغ'] ?? ''), 0) + totalPaid(details)
}
export const custodyRemaining = (entry: Entry) => Math.round(Number(entry.amount) || 0) - custodySpent(entry.details ?? {})
export const pendingSpends = (details: Record<string, unknown>) => spends(details).map((r, i) => [r, i] as const).filter(([r]) => r[STATE_KEY] === PENDING)

const accepted = (d: Record<string, unknown>) => String(d['عهدة_حالة_الإسناد'] ?? '').trim() === 'مقبولة'
const normalize = (v: string) => v.trim().toUpperCase().replace(/ /g, '')

/** _isCustodyRecipient */
function isRecipient(d: Record<string, unknown>, me: string) {
  if (!me) return false
  const holder = String(d['عهدة_مسندة_إلى'] ?? '').trim()
  if (holder && holder === me) return true
  return normalize(String(d['الرقم التعريفي للمستلم'] ?? '')) === me
}
/** _isCustodyOwnerView = canManageAmount && !recipient */
export function isOwnerView(d: Record<string, unknown>, me: string) {
  const role = roleFor(d, me)
  return (role === 'soleOwner' || role === 'owner') && !isRecipient(d, me)
}
/** CustodyAssignment.canSpend */
function canSpendRole(d: Record<string, unknown>, me: string) {
  const role = roleFor(d, me)
  return role === 'soleOwner' || (role === 'holder' && accepted(d))
}

export type CustodyActions = { spend: boolean; topUp: boolean; decide: boolean; settle: boolean; cancel: boolean; freeze: boolean; reopen: boolean; frozen: boolean }

export function custodyActions(entry: Entry, me: string): CustodyActions {
  const d = entry.details ?? {}
  const s = entry.status
  const owner = isOwnerView(d, me)
  const closed = ['ملغاة', 'تمت التسوية', 'مؤرشف', 'محذوف'].includes(s)
  return {
    spend: !closed && s !== 'مجمّدة' && canSpendRole(d, me),
    topUp: owner && !closed && s !== 'مجمّدة',
    decide: owner && pendingSpends(d).length > 0 && !['مؤرشف', 'محذوف'].includes(s),
    settle: owner && !closed,
    cancel: owner && s !== 'ملغاة' && !['مؤرشف', 'محذوف'].includes(s),
    freeze: owner && !closed,
    reopen: owner && s === 'تمت التسوية',
    frozen: s === 'مجمّدة',
  }
}

const needsApproval = (d: Record<string, unknown>, me: string) => String(d['اعتماد المصروفات'] ?? '').trim() === 'بموافقة صاحب العهدة' && roleFor(d, me) === 'holder'

export type SpendInput = { amount: string; purpose: string; date: string; time: string; invoice: File | null }

export function validateSpend(input: SpendInput): string | null {
  if (!input.amount.trim()) return 'أدخل مبلغ الصرف'
  if (parseAmountInt(input.amount) <= 0) return 'أدخل رقمًا صحيحًا أكبر من صفر'
  if (!input.purpose.trim()) return 'أدخل الغرض من الصرف'
  return null
}

/** يعيد نص رسالة الإتمام كما في التطبيق. */
export async function addSpend(entry: Entry, input: SpendInput, me: Me, currency: string): Promise<string> {
  const problem = validateSpend(input)
  if (problem) throw new EntryError(problem)
  if (!custodyActions(entry, me.fnd).spend) throw new EntryError('الصرف من العهدة حقّ المسند إليه بعد قبولها')
  let invoicePath = ''
  if (input.invoice) {
    try {
      invoicePath = await uploadAttachment(await currentUserId(), input.invoice)
    } catch {
      // كالتطبيق: يُحفظ الصرف بلا فاتورة إن تعذّر رفعها.
      invoicePath = ''
    }
  }
  let message = ''
  await mutateEntry(entry, (row, details) => {
    if (['ملغاة', 'تمت التسوية', 'مجمّدة'].includes(row.status)) throw new EntryError('الصرف من العهدة حقّ المسند إليه بعد قبولها')
    const approval = needsApproval(details, me.fnd)
    const item: Row = {}
    if (invoicePath) item['مرفق الفاتورة'] = invoicePath
    item['المبلغ'] = String(parseAmountInt(input.amount))
    item['الغرض'] = input.purpose.trim()
    item['التاريخ'] = input.date.trim()
    item['وقت التسجيل'] = input.time.trim() || clockNow()
    item['بواسطة'] = me.name
    item['معرّف المنفّذ'] = me.fnd
    if (approval) item[STATE_KEY] = PENDING
    const rows = [...strictList(details, SPENDS_KEY), item]
    const encoded = JSON.stringify(rows)
    const total = Math.round(Number(row.amount) || 0)
    const remaining = total - custodySpent({ ...details, [SPENDS_KEY]: encoded })
    const next: Record<string, unknown> = { ...row.details, [SPENDS_KEY]: encoded }
    const patch: Record<string, unknown> = { details: next }
    if (remaining <= 0) {
      next['حالة العهدة'] = 'تمت التسوية'
      patch.status = 'تمت التسوية'
    }
    message = approval ? 'أُرسل المصروف لاعتماد صاحب العهدة' : remaining <= 0 ? 'تم حفظ الصرف — تمت تسوية العهدة بالكامل' : `تم حفظ الصرف، الرصيد المتبقي: ${remaining} ${currency}`
    return patch
  })
  return message
}

/** اعتماد مصروف بانتظار الاعتماد أو رفضه — [shown] الصف كما عُرض. */
export async function decideSpend(entry: Entry, index: number, shown: Row, approve: boolean, me: string) {
  if (!isOwnerView(entry.details ?? {}, me)) throw new EntryError('هذا الإجراء لصاحب العهدة')
  await mutateEntry(entry, (row, details) => {
    const rows = strictList(details, SPENDS_KEY)
    const target = rows[index]
    if (!target || target[STATE_KEY] !== PENDING || target['المبلغ'] !== shown['المبلغ'] || target['التاريخ'] !== shown['التاريخ'] || (target['بواسطة'] ?? '') !== (shown['بواسطة'] ?? ''))
      throw new EntryError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
    target[STATE_KEY] = approve ? APPROVED : REJECTED
    target[approve ? 'تاريخ ووقت الاعتماد' : 'تاريخ ووقت الرفض'] = stampNow()
    const encoded = JSON.stringify(rows)
    const next: Record<string, unknown> = { ...row.details, [SPENDS_KEY]: encoded }
    const patch: Record<string, unknown> = { details: next }
    const remaining = Math.round(Number(row.amount) || 0) - custodySpent({ ...details, [SPENDS_KEY]: encoded })
    if (approve && remaining <= 0) {
      next['حالة العهدة'] = 'تمت التسوية'
      patch.status = 'تمت التسوية'
    }
    return patch
  })
}

/** «إضافة مبلغ للعهدة»: يعيد المبلغ المضاف. */
export async function topUp(entry: Entry, amountText: string, note: string, me: Me): Promise<number> {
  const amount = parseAmountInt(amountText)
  if (amount <= 0) throw new EntryError('أدخل مبلغًا صحيحًا أكبر من صفر')
  if (!custodyActions(entry, me.fnd).topUp) throw new EntryError('زيادة مبلغ العهدة حقّ صاحبها وحده')
  await mutateEntry(entry, (row, details) => {
    if (row.status === 'تمت التسوية') throw new EntryError('العهدة سُوّيت — ابدأ عهدة جديدة من القائمة ⋮')
    if (row.status === 'مجمّدة') throw new EntryError('العهدة مجمّدة — لا صرف ولا إضافة حتى يُلغى التجميد')
    const rows = [...strictList(details, TOPUPS_KEY), { المبلغ: String(amount), السبب: note.trim(), التاريخ: today(), 'وقت التسجيل': clockNow(), بواسطة: me.name }]
    return { amount: Math.round(Number(row.amount) || 0) + amount, details: { ...row.details, [TOPUPS_KEY]: JSON.stringify(rows) } }
  })
  return amount
}

export type SettleMode = 'keep' | 'archive' | 'cancel'

/** _settleCustody (keep/archive) و_cancelCustody (cancel/archive). */
export async function settleCustody(entry: Entry, note: string, mode: SettleMode, viaCancel: boolean, me: string) {
  if (!note.trim()) throw new EntryError(viaCancel ? 'سبب التسوية *' : 'ملاحظة التسوية — ماذا تم؟ *')
  if (!isOwnerView(entry.details ?? {}, me)) throw new EntryError('هذا الإجراء لصاحب العهدة')
  await mutateEntry(entry, (row, details) => {
    const pending = listOf(details, SPENDS_KEY).filter((r) => r[STATE_KEY] === PENDING).length
    if (pending) throw new EntryError(`مصروفات بانتظار الاعتماد: ${pending} — اعتمدها أو ارفضها قبل التسوية.`)
    const remaining = Math.round(Number(row.amount) || 0) - custodySpent(details)
    const stamp = stampNow()
    const archive = mode === 'archive'
    const cancelled = mode === 'cancel'
    const next: Record<string, unknown> = { ...row.details }
    next[viaCancel ? 'سبب التسوية' : 'ملاحظة التسوية'] = note.trim()
    next['تاريخ التسوية'] = stamp
    next['حالة العهدة'] = cancelled ? 'ملغاة' : 'تمت التسوية'
    if (cancelled) next['تاريخ الإلغاء'] = stamp
    if (remaining > 0) next['المبلغ المعاد عند التسوية'] = String(remaining)
    return { details: next, status: archive ? 'مؤرشف' : cancelled ? 'ملغاة' : 'تمت التسوية' }
  })
}

export async function toggleFreeze(entry: Entry, me: string) {
  if (!isOwnerView(entry.details ?? {}, me)) throw new EntryError('هذا الإجراء لصاحب العهدة')
  const frozen = entry.status === 'مجمّدة'
  await mutateEntry(entry, (row) => {
    if ((row.status === 'مجمّدة') !== frozen) throw new EntryError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
    return { status: frozen ? 'نشطة' : 'مجمّدة' }
  })
}

export async function reopenCustody(entry: Entry, me: string) {
  if (!isOwnerView(entry.details ?? {}, me) || entry.status !== 'تمت التسوية') throw new EntryError('هذا الإجراء لصاحب العهدة')
  await mutateEntry(entry, (row, details) => {
    if (row.status !== 'تمت التسوية') throw new EntryError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
    const previous = [(details['تاريخ التسوية'] ?? '').trim(), (details['ملاحظة التسوية'] ?? details['سبب التسوية'] ?? '').trim()].filter(Boolean).join(' — ')
    const next: Record<string, unknown> = { ...row.details }
    for (const key of ['تاريخ التسوية', 'ملاحظة التسوية', 'سبب التسوية', 'المبلغ المعاد عند التسوية']) delete next[key]
    next['حالة العهدة'] = 'قيد الاستخدام'
    next['أُعيد فتحها في'] = stampNow()
    if (previous) next['تسوية سابقة'] = previous
    return { details: next, status: 'نشطة' }
  })
}

// ---------------- الدين: الإلغاء والتسوية قبل الحذف ----------------

const isSettled = (d: Record<string, unknown>) => String(d['ملاحظة التسوية'] ?? '').trim() !== ''

/** _needsSettlementBeforeDelete */
export function needsSettlement(entry: Entry): boolean {
  const d = entry.details ?? {}
  if (entry.entry_type === 'عهدة مالية') return entry.status === 'ملغاة' && custodyRemaining(entry) > 0 && !isSettled(d)
  if (entry.entry_type === 'دين / قرض / سلفة') return Math.round(Number(entry.amount) || 0) - totalPaid(d) > 0 && !isSettled(d)
  return false
}

/** _settleBeforeDelete: ملاحظة التسوية والمتبقي. */
export async function settleBeforeDelete(entry: Entry, note: string) {
  if (!note.trim()) throw new EntryError('ماذا تم في التسوية؟ (وملاحظاتك) *')
  const custody = entry.entry_type === 'عهدة مالية'
  await mutateEntry(entry, (row, details) => {
    const remaining = custody ? Math.round(Number(row.amount) || 0) - custodySpent(details) : Math.round(Number(row.amount) || 0) - totalPaid(details)
    const next: Record<string, unknown> = { ...row.details, 'ملاحظة التسوية': note.trim(), 'تاريخ التسوية': stampNow() }
    if (remaining > 0) next[custody ? 'المبلغ المعاد عند التسوية' : 'المتبقي عند التسوية'] = String(remaining)
    return { details: next }
  })
}

/** _cancelDebt (بعد التسوية إن لزمت). */
export async function cancelDebt(entry: Entry, reason: string) {
  await mutateEntry(entry, (row) => {
    const next: Record<string, unknown> = { ...row.details, 'تاريخ الإلغاء': stampNow() }
    if (reason.trim()) next['سبب الإلغاء'] = reason.trim()
    return { details: next, status: 'ملغاة' }
  })
}
