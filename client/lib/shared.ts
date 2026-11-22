/*
  دفتر الالتزامات المشتركة ودورات الجمعية — نقل مباشر من التطبيق:
  lib/data/shared_expenses.dart (SharedLedger)، lib/data/rosca_cycles.dart
  (RoscaLedger)، وlib/data/shared_alerts.dart (sharedAlertItems). للقراءة فقط:
  لا شيء هنا يكتب في السجل.
*/

type D = Record<string, unknown>

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

function jsonOf(v: unknown): unknown {
  if (typeof v !== 'string') return v
  if (!v.trim()) return undefined
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

const listOf = (v: unknown): Record<string, unknown>[] => {
  const x = jsonOf(v)
  return Array.isArray(x) ? (x.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]) : []
}

const mapOf = (v: unknown): Record<string, unknown> => {
  const x = jsonOf(v)
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}

/** parseMoney في التطبيق: أرقام عربية وفواصل. */
export function parseMoney(raw: unknown): number {
  let text = String(raw ?? '').trim().replace(/\s/g, '')
  const ar = '٠١٢٣٤٥٦٧٨٩'
  const fa = '۰۱۲۳۴۵۶۷۸۹'
  for (let i = 0; i < 10; i++) text = text.split(ar[i]).join(String(i)).split(fa[i]).join(String(i))
  text = text.replace(/٫/g, '.').replace(/٬/g, ',').replace(/،/g, ',')
  if (!text.includes('.') && /^-?\d+,\d{1,2}$|^-?0,\d+$/.test(text)) text = text.replace(',', '.')
  const n = parseFloat(text.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

// ---------------- الأعضاء ----------------

export type Member = { name: string; role: string }

export function members(details: D): Member[] {
  return listOf(details['الأعضاء']).map((m) => ({ name: str(m['name']), role: str(m['role']) || 'عضو' }))
}

/** sharedMemberNames: الأسماء بلا تكرار. */
export function memberNames(details: D): string[] {
  const out: string[] = []
  for (const m of members(details)) if (m.name && !out.includes(m.name)) out.push(m.name)
  return out
}

/** ردود الأعضاء على الدعوات: {FND: {name, state, at}}. */
export function acceptances(details: D): Record<string, { name?: string; state?: string; at?: string }> {
  return mapOf(details['قبول الأعضاء']) as Record<string, { name?: string; state?: string; at?: string }>
}

export const fndIn = (text: string) => text.match(/FND-[A-Z2-9]{4}-[A-Z2-9]{4}/)?.[0] ?? ''
export const withoutFnd = (text: string) => text.replace(/\s*\(FND-[A-Z2-9]{4}-[A-Z2-9]{4}\)/g, '').trim()

/** sharedIAmManager */
export function iAmManager(details: D, fnd: string, myNames: string[]): boolean {
  const creator = str(details['معرف المنشئ'])
  if (creator && creator === fnd) return true
  let manager = members(details).find((m) => m.role === 'مسؤول')?.name ?? ''
  if (!manager) manager = str(details['مدير الرحلة'] ?? details['المسؤول'])
  const managerId = fndIn(manager)
  if (managerId) return managerId === fnd
  if (creator) return false
  if (!manager) return true
  return myNames.includes(manager)
}

// ---------------- SharedLedger ----------------

export type Expense = {
  id: string
  description: string
  amount: number
  payer: string
  date: string
  participants: string[]
  method: string
  shares: Record<string, number>
  note: string
  receipt: string
  category: string
  subcategory: string
  status: string
  submittedBy: string
  currency: string
  originalAmount: number
  rate: number
}

const LEGACY_CATEGORIES: Record<string, string> = { غذاء: 'طعام ومشروبات', فنادق: 'فنادق وإقامة', أخرى: 'مصروفات أخرى' }
export const APPROVED = 'معتمد'
export const PENDING = 'بانتظار الموافقة'
export const POT = 'الميزانية المشتركة'

export function expenses(details: D): Expense[] {
  return listOf(details['سجل المصروفات المشتركة']).map((j) => {
    const rawShares = j['shares'] && typeof j['shares'] === 'object' ? (j['shares'] as Record<string, unknown>) : {}
    const category = str(j['category'])
    return {
      id: str(j['id']),
      description: str(j['description']),
      amount: num(j['amount']),
      payer: str(j['payer']),
      date: str(j['date']),
      participants: Array.isArray(j['participants']) ? (j['participants'] as unknown[]).map(String) : [],
      method: str(j['method']) || 'بالتساوي',
      shares: Object.fromEntries(Object.entries(rawShares).map(([k, v]) => [k, num(v)])),
      note: str(j['note']),
      receipt: str(j['receipt']),
      category: !category ? 'مصروفات أخرى' : LEGACY_CATEGORIES[category] ?? category,
      subcategory: str(j['subcategory']),
      status: str(j['status']) || APPROVED,
      submittedBy: str(j['submittedBy']),
      currency: str(j['currency']),
      originalAmount: num(j['originalAmount']),
      rate: j['rate'] === undefined ? 1 : num(j['rate']) || 1,
    }
  })
}

/** SharedExpense.shareOf: نصيب كل مشارك حسب طريقة التقسيم. */
export function shareOf(e: Expense): Record<string, number> {
  if (!e.participants.length) return {}
  const equal = () => Object.fromEntries(e.participants.map((n) => [n, e.amount / e.participants.length]))
  const total = Object.values(e.shares).reduce((s, v) => s + v, 0)
  const foreign = !!e.currency && e.originalAmount > 0
  switch (e.method) {
    case 'بالمبلغ المحدد':
      if (total <= 0) return equal()
      return Object.fromEntries(e.participants.map((n) => [n, (e.shares[n] ?? 0) * (foreign ? e.rate : 1)]))
    case 'بالنسبة':
    case 'بالحصص':
      if (total <= 0) return equal()
      return Object.fromEntries(e.participants.map((n) => [n, e.amount * ((e.shares[n] ?? 0) / total)]))
    default:
      return equal()
  }
}

export type Settlement = { id: string; from: string; to: string; amount: number; date: string; note: string; receipt: string }
export type Contribution = { id: string; member: string; amount: number; date: string; note: string; status: string; receipt: string }

export const settlements = (details: D): Settlement[] =>
  listOf(details['سجل التسويات']).map((j) => ({
    id: str(j['id']),
    from: str(j['from']),
    to: str(j['to']),
    amount: num(j['amount']),
    date: str(j['date']),
    note: str(j['note']),
    receipt: str(j['receipt']),
  }))

export const contributions = (details: D): Contribution[] =>
  listOf(details['سجل المساهمات']).map((j) => ({
    id: str(j['id']),
    member: str(j['member']),
    amount: num(j['amount']),
    date: str(j['date']),
    note: str(j['note']),
    status: str(j['status']) || APPROVED,
    receipt: str(j['receipt']),
  }))

export const approvedExpenses = (d: D) => expenses(d).filter((e) => e.status === APPROVED)
export const approvedContributions = (d: D) => contributions(d).filter((c) => c.status === APPROVED)

export function baseShares(details: D): Record<string, number> {
  if (str(details['طريقة تحصيل المبلغ']) !== 'دفعة مقطوعة') return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(mapOf(details['تقسيم الأعضاء']))) {
    const amount = parseMoney(v)
    if (amount !== 0) out[k] = amount
  }
  return out
}

export const total = (d: D) => approvedExpenses(d).reduce((s, e) => s + e.amount, 0)

export function budget(d: D) {
  return Object.values(baseShares(d)).reduce((s, v) => s + v, 0) + approvedContributions(d).reduce((s, c) => s + c.amount, 0)
}

export const hasBudget = (d: D) => budget(d) > 0.01

function potSettlementsNet(d: D) {
  let v = 0
  for (const s of settlements(d)) {
    if (s.to === POT) v += s.amount
    if (s.from === POT) v -= s.amount
  }
  return v
}

export const remaining = (d: D) => budget(d) - total(d) + potSettlementsNet(d)

export const hasPot = (d: D) => str(d['طريقة تحصيل المبلغ']) === 'دفعة مقطوعة' && hasBudget(d)

export function totalsByCategory(d: D): [string, number][] {
  const sums = new Map<string, number>()
  for (const e of approvedExpenses(d)) sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount)
  return [...sums.entries()].sort((a, b) => b[1] - a[1])
}

function ledgerNames(d: D): string[] {
  const names = new Set<string>([
    ...Object.keys(baseShares(d)),
    ...approvedContributions(d).map((c) => c.member),
    ...approvedExpenses(d).flatMap((e) => [e.payer, ...Object.keys(shareOf(e))]),
    ...settlements(d).flatMap((s) => [s.from, s.to]),
  ])
  return [...names].filter((n) => n.trim() && n !== POT)
}

/** الرصيد الخام لكل عضو: موجب = له، سالب = عليه. */
export function balances(d: D, names: string[]): Record<string, number> {
  const net: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]))
  const add = (name: string, v: number) => {
    if (name in net) net[name] += v
  }
  for (const [k, v] of Object.entries(baseShares(d))) add(k, v)
  for (const c of approvedContributions(d)) add(c.member, c.amount)
  for (const e of approvedExpenses(d)) {
    add(e.payer, e.amount)
    for (const [n, s] of Object.entries(shareOf(e))) add(n, -s)
  }
  for (const s of settlements(d)) {
    add(s.from, s.amount)
    add(s.to, -s.amount)
  }
  return net
}

/** SharedLedger.memberNets: الصافي بين الأعضاء بعد احتساب الميزانية المشتركة. */
export function memberNets(d: D, memberList: string[]): Record<string, number> {
  const names = [...new Set([...memberList, ...ledgerNames(d)])]
  const raw = balances(d, names)
  if (!hasBudget(d)) return raw
  let positive = 0
  let negative = 0
  for (const v of Object.values(raw)) {
    if (v > 0) positive += v
    if (v < 0) negative -= v
  }
  const matched = Math.min(positive, negative)
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v > 0 ? (positive <= 0 ? 0 : (v * matched) / positive) : negative <= 0 ? 0 : (v * matched) / negative]),
  )
}

export type Transfer = { from: string; to: string; amount: number }

function simplify(bal: Record<string, number>): Transfer[] {
  const eps = 0.01
  const creditors = Object.entries(bal).filter(([, v]) => v > eps).sort((a, b) => b[1] - a[1])
  const debtors = Object.entries(bal)
    .filter(([, v]) => v < -eps)
    .map(([k, v]) => [k, -v] as [string, number])
    .sort((a, b) => b[1] - a[1])
  const out: Transfer[] = []
  let i = 0
  let j = 0
  let creditLeft = creditors[0]?.[1] ?? 0
  let debtLeft = debtors[0]?.[1] ?? 0
  while (i < creditors.length && j < debtors.length) {
    const amount = Math.min(creditLeft, debtLeft)
    if (amount > eps) out.push({ from: debtors[j][0], to: creditors[i][0], amount })
    creditLeft -= amount
    debtLeft -= amount
    if (creditLeft <= eps) {
      i += 1
      if (i < creditors.length) creditLeft = creditors[i][1]
    }
    if (debtLeft <= eps) {
      j += 1
      if (j < debtors.length) debtLeft = debtors[j][1]
    }
  }
  return out
}

/** SharedLedger.settleTransfers: أقل عدد من التحويلات لتسوية الحساب. */
export function settleTransfers(d: D, memberList: string[]): Transfer[] {
  const names = [...new Set([...memberList, ...ledgerNames(d)])]
  const raw = balances(d, names)
  const nets = memberNets(d, names)
  const out: Transfer[] = []
  if (hasBudget(d)) {
    for (const name of names) {
      const pot = (raw[name] ?? 0) - (nets[name] ?? 0)
      const amount = Math.round(Math.abs(pot) * 100) / 100
      if (amount < 0.01) continue
      out.push(pot > 0 ? { from: POT, to: name, amount } : { from: name, to: POT, amount })
    }
  }
  return [...out, ...simplify(nets)]
}

// ---------------- RoscaLedger ----------------

export type RoscaPayment = { id: string; member: string; amount: number; date: string; note: string; receipt: string }

export type RoscaCycle = {
  index: number
  dueDate: Date | null
  receiver: string
  payments: RoscaPayment[]
  share: number
  membersCount: number
  payoutDate: string
  note: string
  memberShares: Record<string, number>
}

export function roscaParseDate(raw: unknown): Date | null {
  const parts = str(raw).split(/[/\-.]/)
  if (parts.length < 3) return null
  const [a, b, c] = parts.map((p) => parseInt(p.trim(), 10))
  if ([a, b, c].some(Number.isNaN)) return null
  return a > 31 ? new Date(a, b - 1, c) : new Date(c, b - 1, a)
}

function addMonths(start: Date, steps: number) {
  const total = start.getMonth() + steps
  const year = start.getFullYear() + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(start.getDate(), last))
}

function cycleDate(start: Date, frequency: string, steps: number) {
  switch (frequency.trim()) {
    case 'أسبوعي':
      return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * steps)
    case 'نصف شهري':
      return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 15 * steps)
    case 'سنوي':
      return addMonths(start, 12 * steps)
    default:
      return addMonths(start, steps)
  }
}

export const cycleShareOf = (c: RoscaCycle, m: string) => c.memberShares[m] ?? c.share
export function cycleTarget(c: RoscaCycle) {
  const keys = Object.keys(c.memberShares)
  if (!keys.length) return c.share * c.membersCount
  const custom = Object.values(c.memberShares).reduce((s, v) => s + v, 0)
  const rest = c.membersCount - keys.length
  return custom + (rest > 0 ? c.share * rest : 0)
}
export const cycleCollected = (c: RoscaCycle) => c.payments.reduce((s, p) => s + p.amount, 0)
export const cycleRemaining = (c: RoscaCycle) => Math.max(0, cycleTarget(c) - cycleCollected(c))
export const paidBy = (c: RoscaCycle, m: string) => c.payments.filter((p) => p.member === m).reduce((s, p) => s + p.amount, 0)
export function memberPaid(c: RoscaCycle, m: string) {
  const paid = paidBy(c, m)
  const due = cycleShareOf(c, m)
  if (due <= 0) return paid > 0
  return paid + 0.01 >= due
}
export const cycleComplete = (c: RoscaCycle) => (cycleTarget(c) > 0 ? cycleRemaining(c) <= 0.01 : c.payments.length > 0)

export type RoscaPlan = { cycles: RoscaCycle[]; members: string[]; share: number; frequency: string; current: RoscaCycle | null }

export function roscaPlan(details: D, memberList: string[]): RoscaPlan {
  const data = mapOf(details['سجل دورات الجمعية'])
  const frequency = str(details['تكرار المساهمة']) || 'شهري'
  const start = roscaParseDate(details['تاريخ البداية'])
  const totalAmount = num(details['إجمالي المساهمة'])
  const share = totalAmount > 0 && memberList.length ? totalAmount / memberList.length : num(details['المساهمة على الشخص'])
  let memberShares: Record<string, number> = {}
  for (const [k, v] of Object.entries(mapOf(details['تقسيم الأعضاء']))) {
    const amount = parseFloat(String(v))
    if (Number.isFinite(amount) && amount > 0 && memberList.includes(k)) memberShares[k] = amount
  }
  if (Object.keys(memberShares).length && Object.keys(memberShares).length !== memberList.length) memberShares = {}
  let count = memberList.length
  if (count <= 0) count = parseInt(str(details['عدد الدورات']), 10) || 0
  if (count <= 0) count = Object.keys(data).length
  const cycles: RoscaCycle[] = []
  for (let i = 1; i <= count; i++) {
    const saved = (data[String(i)] && typeof data[String(i)] === 'object' ? data[String(i)] : {}) as Record<string, unknown>
    const payments = (Array.isArray(saved['payments']) ? (saved['payments'] as Record<string, unknown>[]) : [])
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({ id: str(p['id']), member: str(p['member']), amount: num(p['amount']), date: str(p['date']), note: str(p['note']), receipt: str(p['receipt']) }))
    const savedReceiver = str(saved['receiver'])
    cycles.push({
      index: i,
      dueDate: start ? cycleDate(start, frequency, i - 1) : null,
      receiver: savedReceiver || (memberList.length >= i ? memberList[i - 1] : ''),
      payments,
      share,
      membersCount: memberList.length,
      payoutDate: str(saved['payout']),
      note: str(saved['note']),
      memberShares,
    })
  }
  return { cycles, members: memberList, share, frequency, current: cycles.find((c) => !cycleComplete(c)) ?? null }
}

export function cycleStatus(plan: RoscaPlan, c: RoscaCycle, today: Date): string {
  if (cycleComplete(c)) return 'مكتملة'
  if (c.dueDate && c.dueDate < today) return 'متأخرة'
  if (!plan.current || c.index !== plan.current.index) return 'قادمة'
  return 'جارية'
}
