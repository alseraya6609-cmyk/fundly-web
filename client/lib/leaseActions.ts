import { supabase } from './supabase'
import type { UnitContract, UnitPayment } from './data'
import { AssetError, payExtra } from './assetWrite'
import { K, PAY, decodeLease, encodeLease, encodePayExtra, isoDay, num, parseDay, payStatusFor } from './lease'
import { uid } from './vehicleWrite'

/*
  إجراءات عقد الوحدة في صفحة الوحدة (projects_activities_screen.dart):
  - تمديد العقد (_extendContract): نفس العقد ورقمه، والنهاية تُمدَّد بالمدة
    المختارة (أيام / أشهر / ساعات مع «ساعة نهاية العقد»).
  - تجديده بعد انتهائه (_renewContract): عقد جديد من نسخة السابق.
  - إلغاؤه بالتسوية (_cancelContract): «لك / عليك»، ملاحظات التسوية، أو
    «إلغاء بدون تسوية»؛ العقد «cancelled» ولا يُحذف، وبقية وحدات المجموعة معه.
  - دفعات العقد في جدول واحد (_openPaymentForm): إضافة وتعديل يدوي.
*/

export const END_TIME_KEY = 'ساعة نهاية العقد'
export const SETTLE_NOTES_KEY = 'ملاحظات التسوية'
export const CANCEL_DATE_KEY = 'تاريخ إلغاء العقد'
export const SETTLED_KEY = 'تمت تسوية المبالغ'
export const NO_SETTLEMENT_KEY = 'أُلغي بدون تسوية'

/** _contractClosed */
export const contractClosed = (c: UnitContract) => c.status === 'expired' || c.status === 'ended' || c.status === 'cancelled'

/** _contractEnded: أُنهي أو مرّ تاريخ نهايته. */
export function contractEnded(c: UnitContract, today = new Date()) {
  if (contractClosed(c)) return true
  const end = parseDay(c.end_date)
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return !!end && end.getTime() < day.getTime()
}

/** _isLeaseContract */
export const isLeaseContract = (c: UnitContract) => (c.notes ?? '').includes('"__lease__"') && !(c.notes ?? '').includes('"__equip__"')

/* ===== التمديد ===== */

export type ExtendBy = { months: number; days: number; hours: number; label: string }

export const EXTEND_PRESETS: ExtendBy[] = [
  { months: 0, days: 1, hours: 0, label: 'يوم' },
  { months: 0, days: 2, hours: 0, label: 'يومين' },
  { months: 0, days: 7, hours: 0, label: 'أسبوع' },
  { months: 1, days: 0, hours: 0, label: 'شهر' },
  { months: 3, days: 0, hours: 0, label: '3 أشهر' },
  { months: 6, days: 0, hours: 0, label: '6 أشهر' },
  { months: 12, days: 0, hours: 0, label: 'سنة' },
]

export function customExtend(kind: 'h' | 'd' | 'm', n: number): ExtendBy {
  if (kind === 'h') return { months: 0, days: 0, hours: n, label: `${n} ساعة` }
  if (kind === 'd') return { months: 0, days: n, hours: 0, label: `${n} يوم` }
  return { months: n, days: 0, hours: 0, label: `${n} شهر` }
}

/** _endWithTime: نهاية العقد بساعتها إن سُجّلت. */
export function endWithTime(end: Date, time: string | undefined) {
  const parts = (time ?? '').trim().split(':')
  const day = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  if (parts.length !== 2) return day
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0)
}

/** _extendedEnd */
export const extendedEnd = (from: Date, by: ExtendBy) => new Date(from.getFullYear(), from.getMonth() + by.months, from.getDate() + by.days, from.getHours() + by.hours, from.getMinutes())

const two = (n: number) => String(n).padStart(2, '0')
/** _extFmt */
export function extFmt(d: Date | null, withTime: boolean) {
  if (!d) return '—'
  const date = `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`
  return withTime ? `${date} ${two(d.getHours())}:${two(d.getMinutes())}` : date
}

export function extendPlan(c: UnitContract, by: ExtendBy) {
  const lease = decodeLease(c.notes)
  const endTime = lease.contract[END_TIME_KEY]
  const withTime = by.hours > 0 || !!(endTime ?? '').trim()
  const from = endWithTime(parseDay(c.end_date) ?? new Date(), endTime)
  const newEnd = extendedEnd(from, by)
  return { start: parseDay(c.start_date), from, newEnd, withTime }
}

export async function extendContract(c: UnitContract, by: ExtendBy): Promise<Date> {
  const { newEnd, withTime } = extendPlan(c, by)
  const lease = decodeLease(c.notes)
  const end = new Date(newEnd.getFullYear(), newEnd.getMonth(), newEnd.getDate())
  lease.contract[K.endDate] = isoDay(end)
  if (withTime) lease.contract[END_TIME_KEY] = `${two(newEnd.getHours())}:${two(newEnd.getMinutes())}`
  const { error } = await supabase.from('property_unit_contracts').update({ end_date: isoDay(end), status: 'active', notes: encodeLease(lease) }).eq('id', c.id)
  if (error) throw error
  return end
}

/** بداية التجديد: اليوم التالي لنهاية السابق إن لم تمضِ، وإلا اليوم. */
export function renewalRange(c: UnitContract, months: number) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const oldEnd = parseDay(c.end_date)
  const start = oldEnd && !(oldEnd.getTime() < today.getTime()) ? new Date(oldEnd.getFullYear(), oldEnd.getMonth(), oldEnd.getDate() + 1) : today
  const end = new Date(start.getFullYear(), start.getMonth() + months, start.getDate() - 1)
  return { start, end }
}

/* ===== الإلغاء بالتسوية ===== */

export type CancelSummary = { owed: number; deposit: number; depositRecorded: number; cheques: string[] }

export function cancelSummary(c: UnitContract, payments: UnitPayment[], unitExtras: Record<string, string>): CancelSummary {
  const now = new Date()
  const today = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  const cheques: string[] = []
  let deposit = 0
  let owed = 0
  for (const p of payments) {
    const extra = payExtra(p.notes)
    const remaining = Math.max(0, (Number(p.amount_due) || 0) - (Number(p.amount_paid) || 0))
    const left = remaining > 0.009 ? remaining : 0
    if ((extra[PAY.kind] ?? '') === PAY.deposit) {
      deposit += Number(p.amount_paid) || 0
      continue
    }
    const cheque = (extra[PAY.cheque] ?? '').trim()
    if (left > 0 && cheque) cheques.push(cheque)
    const due = p.due_date ? p.due_date.slice(0, 10) : null
    if (left > 0 && due && !(due > today)) owed += left
  }
  let depositRecorded = 0
  if (deposit <= 0) {
    // _depositRows: تأمينات الوحدة وتأمين العقد.
    let unitRows: Record<string, unknown>[] = []
    try {
      const decoded = JSON.parse(unitExtras['تأمينات الوحدة'] ?? '[]')
      if (Array.isArray(decoded)) unitRows = decoded.filter((r) => r && typeof r === 'object')
    } catch {
      unitRows = []
    }
    for (const r of unitRows) {
      deposit += num(String(r['المسدد'] ?? ''))
      depositRecorded += num(String(r['المبلغ'] ?? ''))
    }
    for (const row of decodeLease(c.notes).deposits) {
      const amount = row[K.depositAmount] ?? ''
      if (!amount.trim()) continue
      const byCheque = (row[K.collectMethod] ?? '') === 'شيك'
      const collected = byCheque ? (row[K.paymentChequeDate] ?? '').trim() : (row['تاريخ تحصيل التأمين'] ?? '').trim()
      deposit += byCheque || !collected ? 0 : num(amount)
      depositRecorded += num(amount)
    }
  }
  return { owed, deposit, depositRecorded, cheques }
}

/** _withSettledFlag: عقد غير «عقد إيجار كامل». */
function withSettledFlag(notes: string | null) {
  const text = (notes ?? '').trim()
  if (text.startsWith('{')) {
    try {
      const decoded = JSON.parse(text)
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) return JSON.stringify({ ...decoded, [SETTLED_KEY]: 'نعم' })
    } catch {
      // نص غير JSON
    }
  }
  return `${text}\n"${SETTLED_KEY}":"نعم"`
}

export async function cancelContract(c: UnitContract, o: { notes: string; settledMoney: boolean; withoutSettlement: boolean }, all: UnitContract[]) {
  const today = isoDay(new Date())
  let notes = c.notes
  if (isLeaseContract(c)) {
    const lease = decodeLease(c.notes)
    lease.contract[SETTLE_NOTES_KEY] = o.notes
    lease.contract[CANCEL_DATE_KEY] = today
    if (o.settledMoney) lease.contract[SETTLED_KEY] = 'نعم'
    if (o.withoutSettlement) lease.contract[NO_SETTLEMENT_KEY] = 'نعم'
    notes = encodeLease(lease)
  } else if (o.settledMoney) notes = withSettledFlag(c.notes)
  const { error } = await supabase.from('property_unit_contracts').update({ status: 'cancelled', notes }).eq('id', c.id)
  if (error) throw error
  // عقد متعدد الوحدات: تُلغى معه سجلات بقية وحداته.
  const group = (c.group_key ?? '').trim()
  if (!group) return
  for (const other of all) {
    if (other.id === c.id || (other.group_key ?? '').trim() !== group || other.status === 'cancelled' || other.asset_id !== c.asset_id) continue
    let otherNotes = other.notes
    if (isLeaseContract(other)) {
      const lease = decodeLease(other.notes)
      lease.contract[CANCEL_DATE_KEY] = today
      if (o.notes) lease.contract[SETTLE_NOTES_KEY] = o.notes
      otherNotes = encodeLease(lease)
    }
    await supabase.from('property_unit_contracts').update({ status: 'cancelled', notes: otherNotes }).eq('id', other.id)
  }
}

/* ===== الدفعات يدويًا ===== */

export type DueTotals = { overdue: number; overdueCount: number; dueToday: number; dueTodayCount: number; upcoming: number; upcomingCount: number; received: number; receivedCount: number; nextDue: string | null; grand: number }

/** _duesTotals */
export function dueTotals(payments: UnitPayment[]): DueTotals {
  const today = isoDay(new Date())
  const out: DueTotals = { overdue: 0, overdueCount: 0, dueToday: 0, dueTodayCount: 0, upcoming: 0, upcomingCount: 0, received: 0, receivedCount: 0, nextDue: null, grand: 0 }
  let oldestLate: string | null = null
  for (const p of payments) {
    const paid = Number(p.amount_paid) || 0
    out.received += paid
    out.grand += Number(p.amount_due) || 0
    if (paid > 0.009) out.receivedCount++
    const rem = (Number(p.amount_due) || 0) - paid
    if (!(rem > 0.009)) continue
    const day = p.due_date ? p.due_date.slice(0, 10) : null
    if (day && day < today) {
      out.overdue += rem
      out.overdueCount++
      if (!oldestLate || day < oldestLate) oldestLate = day
    } else if (day && day === today) {
      out.dueToday += rem
      out.dueTodayCount++
    } else {
      out.upcoming += rem
      out.upcomingCount++
    }
    if (day && !(day < today) && (!out.nextDue || day < out.nextDue)) out.nextDue = day
  }
  if (!out.nextDue) out.nextDue = oldestLate
  return out
}

export const PAY_KINDS = [PAY.rent, PAY.fee, PAY.deposit]

const localStamp = () => {
  const d = new Date()
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** _openPaymentForm ← حفظ: المستحق إلزامي والمسدد لا يتجاوزه. */
export async function savePayment(contractId: string, existing: UnitPayment | null, f: { kind: string; name: string; dueDate: string; due: string; paid: string; ref: string }) {
  const due = num(f.due)
  const paid = num(f.paid)
  if (due <= 0) throw new AssetError('أدخل المبلغ المستحق — لا يُحفظ بند بلا قيمة.')
  if (paid > due + 0.009) throw new AssetError('المسدد أكبر من المستحق — راجع المبلغين.')
  const user = await uid()
  const row = {
    user_id: user,
    contract_id: contractId,
    due_date: f.dueDate || null,
    amount_due: due,
    amount_paid: paid,
    paid_at: paid > 0 ? existing?.paid_at ?? localStamp() : null,
    status: payStatusFor(due, paid),
    reference_no: f.ref.trim() || null,
    notes: encodePayExtra({ ...payExtra(existing?.notes ?? null), [PAY.kind]: f.kind, [PAY.name]: f.name.trim() || f.kind }),
  }
  const res = existing ? await supabase.from('property_unit_payments').update(row).eq('id', existing.id).select('id') : await supabase.from('property_unit_payments').insert(row).select('id')
  if (res.error) throw res.error
}

export const payNameOf = (p: UnitPayment) => {
  const extra = payExtra(p.notes)
  return extra[PAY.name] || extra[PAY.kind] || PAY.rent
}
