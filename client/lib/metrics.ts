import { useMemo } from 'react'
import {
  useAssets,
  useCalendarRecords,
  useDelegations,
  usePeopleAll,
  usePersonalAll,
  useSavedReminders,
  useSharedAll,
  useUnitContracts,
  useUnitPayments,
  hasMine,
  type Entry,
} from './data'
import { useSession } from './session'
import { useCurrency, useStore } from './data'
import {
  approvedExpenses,
  budget as sharedBudget,
  contributions as sharedContributions,
  expenses as sharedExpenses,
  hasPot,
  iAmManager,
  memberNames,
  memberPaid,
  remaining as sharedRemaining,
  roscaPlan,
  total as sharedTotal,
  withoutFnd,
} from './shared'

/*
  نقل HomeDashboardService.loadMetrics من التطبيق (lib/data/home_dashboard_service.dart)
  ومعه دوال lib/data/entry_status.dart: نفس القواعد ونفس الأرقام في بطاقات
  الرئيسية («مالية تحتاج متابعة» و«مستندات تحتاج متابعة») ونفس بنود الكلندر.

  ومعه sharedAlertItems (shared_alerts.dart): المتابعات والمستندات، دورة
  الجمعية الجارية وتأخر المساهمات، اعتماد الصرف، وتنبيه الميزانية.
*/

export type CalItem = {
  key: string
  title: string
  module: string
  date: Date
  sourceId: string
  type: string
  status: string
  priority: string
  time: string
  entryType: string
  repeat: string
  isUserCreated: boolean
  isExpiry: boolean
  /** فئة البند الشخصي (organization = «المتابعة والتخطيط») — عليها رنة المنبّه. */
  category?: string
  /** أيام التذكير قبل الموعد: -1 = الافتراضي من الإعدادات، NO_REMINDER = بدون. */
  remindBeforeDays: number
  /** «وقت التذكير» بالدقائق قبل الموعد (التذكير المفعّل)، أو -1. */
  leadMinutes: number
  to?: string
}

/** HomeDashboardService.noReminder */
export const NO_REMINDER = -2

export type Metrics = {
  personalMoney: number
  personalDocs: number
  personalNeedsFollowup: number
  sharedMoney: number
  sharedDocs: number
  peopleMoney: number
  peopleDocs: number
  assetsMoney: number
  assetsDocs: number
  calendarItems: CalItem[]
}

// ---------------- entry_status.dart ----------------

export const CLOSED_STATUSES = new Set(['مكتملة', 'مكتمل', 'مؤرشف', 'ملغاة', 'ملغى', 'محذوف', 'تمت التسوية', 'مسددة'])
export const FINAL_STATUSES = new Set(['مكتملة', 'مؤرشف', 'ملغاة', 'تمت التسوية', 'محذوف', 'مجمّدة'])
export const TRANSACTION_TYPES = new Set(['المصروفات الشخصية', 'مصروف', 'إيراد', 'تحويل مالي'])
const FINANCIAL_TYPES = new Set(['المصروفات الشخصية', 'مصروف', 'إيراد', 'تحويل مالي', 'دين / قرض / سلفة', 'قسط', 'غرامة', 'جمعية'])
const PAYABLE_TYPES = new Set(['دين / قرض / سلفة', 'قسط'])
const EVENT_TYPES = new Set(['مناسبة', 'هدية'])
const REPEAT_MONTHS: Record<string, number> = {
  شهري: 1,
  شهريًا: 1,
  'ربع سنوي': 3,
  'كل 3 شهور': 3,
  'نصف سنوي': 6,
  'كل 6 شهور': 6,
  سنوي: 12,
  سنويًا: 12,
  'شهر أختاره': 12,
}
const REPEAT_DAYS: Record<string, number> = { يومي: 1, يوميًا: 1, أسبوعي: 7, أسبوعيًا: 7 }

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

function latinDigits(text: string) {
  let out = text
  for (let i = 0; i < 10; i++) out = out.split(ARABIC_DIGITS[i]).join(String(i)).split(PERSIAN_DIGITS[i]).join(String(i))
  return out
}

/** HomeDashboardService._parseDdMmYyyy: يوم/شهر/سنة أو سنة-شهر-يوم، ويُرفض التاريخ غير الصحيح. */
export function parseDay(input: unknown): Date | null {
  const value = latinDigits(str(input))
  if (!value) return null
  const parts = value.split(/[/\-]/)
  if (parts.length < 3) return null
  const a = parseInt(parts[0], 10)
  const b = parseInt(parts[1], 10)
  const c = parseInt(parts[2].split(/[ T]/)[0], 10)
  if ([a, b, c].some(Number.isNaN)) return null
  const [y, m, d] = parts[0].trim().length === 4 ? [a, b, c] : [c, b, a]
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

export function startOfToday() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const dayDiff = (from: Date, to: Date) =>
  Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000)

function addMonthsClamped(date: Date, months: number) {
  const total = date.getMonth() + months
  const year = date.getFullYear() + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(date.getDate(), last))
}

export function entryDerivedStatus(stored: string, details: Record<string, unknown>, today: Date) {
  if (FINAL_STATUSES.has(stored)) return stored
  const end = parseDay(details['إلى تاريخ']) ?? parseDay(details['تاريخ الانتهاء'])
  if (end && end < today) return 'منتهية'
  if (stored === 'منتهية') return 'نشطة'
  return stored
}

function entryIsRepeating(details: Record<string, unknown>) {
  const toggle = details['تفعيل عملية متكررة']
  if (toggle !== undefined && toggle !== null && str(toggle) !== 'نعم') return false
  const cycle = str(details['التكرار'])
  return cycle in REPEAT_MONTHS || cycle in REPEAT_DAYS
}

export function entryNextRepeatDate(first: Date | null, details: Record<string, unknown>, today: Date): Date | null {
  if (!first || !entryIsRepeating(details)) return null
  const cycle = str(details['التكرار'])
  const months = REPEAT_MONTHS[cycle] ?? 0
  const days = REPEAT_DAYS[cycle] ?? 0
  let next = first
  for (let i = 1; i < 5000 && next < today; i++) {
    next = months > 0 ? addMonthsClamped(first, months * i) : addDays(first, days * i)
  }
  return next
}

/** HomeDashboardService.nextOccurrence */
export function nextOccurrence(due: Date, repeat: string, today: Date) {
  const r = repeat.trim()
  const months = ['شهري', 'شهريًا'].includes(r) ? 1 : ['ربع سنوي', 'كل 3 شهور'].includes(r) ? 3 : ['نصف سنوي', 'كل 6 شهور'].includes(r) ? 6 : ['سنوي', 'سنويًا', 'شهر أختاره'].includes(r) ? 12 : 0
  const days = ['يومي', 'يوميًا'].includes(r) ? 1 : ['أسبوعي', 'أسبوعيًا'].includes(r) ? 7 : 0
  if (!months && !days) return due
  let next = due
  for (let i = 1; next < today && i < 5000; i++) next = months ? addMonthsClamped(due, months * i) : addDays(due, days * i)
  return next
}

function entryNumber(raw: unknown) {
  const text = latinDigits(str(raw).replace(/[,،٬\s]/g, '').replace('٫', '.'))
  const m = text.match(/\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) || 0 : 0
}

function jsonList(v: unknown): Record<string, unknown>[] {
  let list: unknown = v
  if (typeof v === 'string') {
    if (!v.trim()) return []
    try {
      list = JSON.parse(v)
    } catch {
      return []
    }
  }
  return Array.isArray(list) ? (list.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]) : []
}

function entryPaidTotal(details: Record<string, unknown>) {
  return Math.round(jsonList(details['سجل دفعات الالتزام']).reduce((sum, row) => sum + entryNumber(row['المبلغ']), 0))
}

function entryNextUnpaidInstallment(details: Record<string, unknown>, paid: number): Date | null {
  const rows: [Date, number][] = []
  for (let i = 1; i <= 600; i++) {
    const raw = details[`القسط ${i}`]
    if (raw === undefined || raw === null) break
    const parts = String(raw).split('—')
    const d = parseDay(parts[0].trim())
    if (!d) continue
    rows.push([d, parts.length > 1 ? entryNumber(parts[1]) : 0])
  }
  if (!rows.length) return null
  rows.sort((a, b) => a[0].getTime() - b[0].getTime())
  let covered = 0
  for (const [d, amount] of rows) {
    covered += amount
    if (covered > paid + 0.5) return d
  }
  return null
}

export function entryFollowDate(type: string, due: Date | null, details: Record<string, unknown>, today: Date): Date | null {
  if (!due) return null
  if (type === 'ملاحظات' || type === 'ملاحظة') return null
  if (type === 'عهدة مالية' || type === 'أدوية') return null
  if (TRANSACTION_TYPES.has(type)) return entryNextRepeatDate(due, details, today)
  if (type === 'عادة' && !entryIsRepeating(details)) return null
  if (type === 'قسط') {
    const next = entryNextUnpaidInstallment(details, entryPaidTotal(details))
    if (next) return next
  }
  return entryNextRepeatDate(due, details, today) ?? due
}

export function entryOutcomeStatus(type: string, due: Date | null, details: Record<string, unknown>, total: number, today: Date): string | null {
  if (PAYABLE_TYPES.has(type) && total > 0 && entryPaidTotal(details) >= total) return 'مكتملة'
  if (EVENT_TYPES.has(type) && due && !entryIsRepeating(details) && due < today) return 'منتهية'
  return null
}

/** reminderLeadMinutes: «قبل ساعة» / «قبل N ساعة|يوم» بالدقائق. */
export function reminderLeadMinutes(raw: string) {
  const s = latinDigits(raw.trim())
  if (!s) return -1
  if (s === 'قبل يوم') return 1440
  if (s === 'قبل ساعة') return 60
  const m = s.match(/قبل\s*(\d+)\s*(ساعة|ساعات|يوم|أيام)/)
  if (!m) return -1
  const n = parseInt(m[1], 10)
  return m[2].startsWith('ساع') ? n * 60 : n * 1440
}

/** _leadMinutesOf: حين يكون التذكير مفعّلًا. */
function leadMinutesOf(details: Record<string, unknown>) {
  if (str(details['تفعيل تذكير']) !== 'نعم') return -1
  return reminderLeadMinutes(str(details['وقت التذكير']))
}

/** _reminderDaysOf: أيام التذكير من حقل التذكير في السجل. */
function reminderDaysOf(details: Record<string, unknown>) {
  for (const key of ['التذكير قبل الانتهاء', 'تذكيرات', 'تذكير', 'التذكيرات']) {
    let raw = str(details[key])
    if (!raw) continue
    if (raw.includes('بدون')) return NO_REMINDER
    raw = latinDigits(raw)
    const known = ({ 'قبل يوم': 1, 'قبل 3 أيام': 3, 'قبل أسبوع': 7, 'قبل أسبوعين': 14, 'قبل شهر': 30 } as Record<string, number>)[raw] ?? 0
    if (known > 0) return known
    if (raw.includes('يومين')) return 2
    if (raw.includes('شهرين')) return 60
    const n = raw.match(/\d+/)
    const unit = raw.includes('شهر') ? 30 : raw.includes('أسبوع') || raw.includes('اسبوع') ? 7 : 1
    if (n) return parseInt(n[0], 10) * unit
    if (raw.includes('شهر')) return 30
  }
  return -1
}

function entryTimeOf(details: Record<string, unknown>) {
  const reminder = str(details['وقت التذكير'])
  if (str(details['تفعيل تذكير']) === 'نعم' && /^\d{1,2}:\d{2}/.test(reminder)) return reminder
  return str(details['الوقت'])
}

// ---------------- rent_payments_view.dart / lease_contract_data.dart ----------------

const payRemaining = (p: { amount_due: number; amount_paid: number }) => {
  const r = Number(p.amount_due || 0) - Number(p.amount_paid || 0)
  return r > 0.009 ? r : 0
}

function leaseSettled(notes: string | null) {
  const text = notes ?? ''
  return text.includes('"تمت تسوية المبالغ":"نعم"') && !text.includes('"أُلغي بدون تسوية":"نعم"')
}

function leaseCancelDate(notes: string | null): Date | null {
  try {
    const decoded = JSON.parse(notes ?? '')
    const raw = str(decoded?.contract?.['تاريخ إلغاء العقد'])
    if (!raw) return null
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
  } catch {
    return null
  }
}

function paymentWaivedByClosure(
  contract: { status: string; notes: string | null; end_date: string | null },
  payment: { amount_due: number; amount_paid: number; due_date: string | null },
) {
  const closed = ['expired', 'ended', 'cancelled'].includes(contract.status)
  if (!closed) return false
  if (payRemaining(payment) <= 0.009) return false
  if (leaseSettled(contract.notes)) return true
  const closedOn = leaseCancelDate(contract.notes) ?? parseDay(contract.end_date)
  const due = parseDay(payment.due_date)
  if (!due || !closedOn) return false
  return due > closedOn
}

// ---------------- التذكيرات المحفوظة ----------------

function savedReminderKind(id: string, title: string) {
  if (id.startsWith('custody_percent_')) return 'تنبيه الميزانية'
  const t = title.trim()
  if (t.startsWith('استحقاق')) return 'استحقاق'
  for (const kind of ['مهمة', 'موعد', 'عادة', 'تذكير', 'ملاحظات']) if (t.startsWith(kind)) return kind
  if (t.startsWith('ملاحظة')) return 'ملاحظات'
  return 'انتهاء'
}

function item(partial: Partial<CalItem> & Pick<CalItem, 'title' | 'module' | 'date' | 'sourceId'>): CalItem {
  return {
    key: `${partial.module}:${partial.sourceId}`,
    type: 'موعد',
    status: 'قادمة',
    priority: 'متوسطة',
    time: '',
    entryType: '',
    repeat: '',
    isUserCreated: false,
    isExpiry: false,
    remindBeforeDays: -1,
    leadMinutes: -1,
    ...partial,
  }
}

export function useMetrics(): { loading: boolean; metrics: Metrics } {
  const { profile } = useSession()
  const fnd = profile?.fnd_id ?? ''
  const personal = usePersonalAll()
  const shared = useSharedAll()
  const assets = useAssets()
  const contracts = useUnitContracts()
  const payments = useUnitPayments()
  const people = usePeopleAll()
  const reminders = useSavedReminders()
  const records = useCalendarRecords()
  const delegations = useDelegations()
  const store = useStore()
  const defaultCurrency = useCurrency()

  const loading = [personal, shared, assets, people, records].some((q) => q.isLoading)

  const metrics = useMemo<Metrics>(() => {
    const today = startOfToday()
    const in30 = addDays(today, 30)
    const cal: CalItem[] = []
    let personalMoney = 0
    let personalDocs = 0
    let personalNeedsFollowup = 0

    for (const e of personal.data ?? []) {
      const d = e.details ?? {}
      const closed = CLOSED_STATUSES.has(e.status)
      const due = parseDay(e.due_date)
      const type = e.entry_type
      const followDue = entryFollowDate(type, due, d, today)
      const finished =
        entryDerivedStatus(e.status, d, today) === 'منتهية' || entryOutcomeStatus(type, due, d, Math.round(Number(e.amount) || 0), today) !== null
      const needs = !closed && !finished && !!followDue && dayDiff(today, followDue) <= 7
      if (needs) personalNeedsFollowup += 1
      const isDocument = type === 'مستند' || type === 'ضمانات'
      if (isDocument) {
        if (!closed && due && due <= in30) personalDocs += 1
      } else if (needs && FINANCIAL_TYPES.has(type)) {
        personalMoney += 1
      }
      if (due && !closed) {
        const repeat = str(d['التكرار'])
        const recurring = entryIsRepeating(d) && type !== 'قسط' && type !== 'دين / قرض / سلفة'
        cal.push(
          item({
            title: e.title || type,
            module: 'الالتزامات الشخصية',
            category: e.category,
            date: recurring ? nextOccurrence(due, repeat, today) : due,
            sourceId: e.id,
            status: finished ? 'مكتملة' : e.status,
            entryType: type,
            time: entryTimeOf(d),
            repeat: recurring ? repeat : '',
            isExpiry: isDocument,
            leadMinutes: leadMinutesOf(d),
            remindBeforeDays: (() => {
              const days = reminderDaysOf(d)
              const lead = leadMinutesOf(d)
              // تذكير بالساعات: يظهر في التنبيهات من اليوم الذي يقع فيه.
              return days === -1 && lead > 0 ? Math.floor((lead + 1439) / 1440) : days
            })(),
            to: `/me?open=${e.id}`,
          }),
        )
      }
    }

    // ---- الأصول: الدفعات المعتمدة المتبقية، وانتهاء العقود والرخص.
    let assetsMoney = 0
    let assetsDocs = 0
    const liveAssets = assets.data ?? []
    const liveIds = new Set(liveAssets.map((a) => a.id))
    const contractById = new Map(
      (contracts.data ?? []).filter((c) => liveIds.has(c.asset_id) && c.status !== 'pending').map((c) => [c.id, c]),
    )
    for (const p of payments.data ?? []) {
      const c = contractById.get(p.contract_id)
      const due = parseDay(p.due_date)
      if (!c || !due) continue
      if (payRemaining(p) <= 0) continue
      if (paymentWaivedByClosure(c, p)) continue
      if (due > in30) continue
      assetsMoney += 1
    }
    for (const a of liveAssets) {
      const cancelled = (a.status ?? '').startsWith('ملغ')
      const end = parseDay(a.end_date)
      if (!cancelled && end && end <= in30) assetsDocs += 1
      if (end && !cancelled) {
        cal.push(item({ title: a.title, module: 'العقارات والأنشطة التجارية', date: end, sourceId: a.id, isExpiry: true, to: `/assets?open=${a.id}` }))
      }
    }
    const assetModules = new Set(['العقارات والأنشطة التجارية', 'الأنشطة التجارية', 'العقارات', 'المركبات ووسائل النقل'])
    for (const r of reminders.data ?? []) {
      const expiry = r.expiryDate ? new Date(r.expiryDate) : null
      if (!expiry || Number.isNaN(expiry.getTime())) continue
      const day = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate())
      if (assetModules.has(r.module) && !r.id.includes('payment') && day <= in30) assetsDocs += 1
      cal.push(item({ title: r.title, module: r.module, date: day, sourceId: r.id, entryType: savedReminderKind(r.id, r.title), remindBeforeDays: Number(r.remindBeforeDays ?? 0) || 0 }))
    }

    // ---- التفويضات: انتهاؤها.
    for (const dlg of delegations.data ?? []) {
      const end = parseDay(dlg.end_date)
      if (!end || dlg.is_paused || end < today) continue
      const received = (dlg.delegate_ref ?? '').startsWith('dir:received')
      cal.push(
        item({
          title: received ? `ينتهي تفويض ${dlg.delegate_name} لك` : `ينتهي تفويض ${dlg.delegate_name}`,
          module: 'التفويضات',
          date: end,
          sourceId: `delegation-${dlg.id}`,
          type: 'تفويض',
          isExpiry: true,
          remindBeforeDays: 7,
        }),
      )
    }

    // ---- بنود الكلندر الذكي.
    for (const r of records.data ?? []) {
      const d = new Date(r.date)
      if (Number.isNaN(d.getTime())) continue
      cal.push(
        item({
          title: r.title,
          module: 'التقويم الذكي',
          date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
          sourceId: r.id,
          type: r.type || 'مهمة',
          status: r.status || 'قادمة',
          priority: r.priority || 'متوسطة',
          time: r.time ?? '',
          isUserCreated: true,
          remindBeforeDays: Number(r.remindBeforeDays ?? 0) || 0,
        }),
      )
    }

    // ---- الالتزامات المشتركة.
    const myNames = [str(store.data?.['settings_profile_name']), str(store.data?.['settings_shared_nickname'])].filter(Boolean)
    const plain = (v: number) => {
      const x = Math.round(Math.abs(v) * 100) / 100
      return x % 1 === 0 ? x.toFixed(0) : x.toFixed(2)
    }
    let sharedMoney = 0
    let sharedDocs = 0
    for (const e of shared.data ?? []) {
      const d = e.details ?? {}
      const open =
        e.status !== 'مكتملة' && e.status !== 'مؤرشف' && e.status !== 'ملغاة' && !hasMine(d, 'مؤرشف عند', fnd)
      const name = e.title.trim() || e.entry_type
      const to = `/shared?open=${e.id}`
      const isCircle = e.entry_type === 'جمعية مالية' || e.entry_type === 'جمعية'
      const names = memberNames(d)
      const plan = isCircle ? roscaPlan(d, names) : null
      if (open && e.entry_type === 'جمعية مالية') {
        // موعد الدورة الجارية، وإلا تاريخ الالتزام.
        const due = plan?.current?.dueDate ?? parseDay(e.due_date)
        if (due && dayDiff(today, due) <= 7) sharedMoney += 1
      }
      if (open && jsonList(d['مستندات']).some((doc) => {
        const date = parseDay(doc['date'])
        return !!date && dayDiff(today, date) <= 30
      }))
        sharedDocs += 1
      if (!open) continue
      const currency = str(d['العملة']) || defaultCurrency
      // sharedAlertItems — المتابعة والتخطيط.
      jsonList(d['متابعة وتخطيط']).forEach((m, i) => {
        const date = parseDay(m['date'])
        if (!date) return
        const kind = str(m['kind']) || 'مهمة'
        const extra = (m['extra'] && typeof m['extra'] === 'object' ? m['extra'] : {}) as Record<string, unknown>
        if (str(extra['الحالة']) === 'مكتملة') return
        const repeat = str(extra['التكرار'])
        const recurring = !!repeat && !repeat.includes('بدون') && !repeat.includes('لا يتكرر')
        cal.push(
          item({
            title: `${str(m['title']) || kind} — ${name}`,
            module: 'الالتزامات المشتركة',
            date: recurring ? nextOccurrence(date, repeat, today) : date,
            sourceId: `${e.id}#f${i}`,
            type: kind,
            entryType: kind,
            time: str(extra['الوقت']),
            repeat: recurring ? repeat : '',
            to,
          }),
        )
      })
      // المستندات.
      jsonList(d['مستندات']).forEach((m, i) => {
        const date = parseDay(m['date'])
        if (!date) return
        cal.push(
          item({
            title: `انتهاء ${str(m['title']) || 'مستند'} — ${name}`,
            module: 'الالتزامات المشتركة',
            date,
            sourceId: `${e.id}#d${i}`,
            type: 'مستند',
            entryType: 'مستند',
            isExpiry: true,
            to,
          }),
        )
      })
      // الجمعية: الدورة الجارية، وتأخر المساهمات (لي، وللمسؤول عن الجميع).
      if (plan) {
        const current = plan.current
        if (current?.dueDate) {
          cal.push(
            item({
              title: `الدورة رقم: ${current.index} — ${name}`,
              module: 'الالتزامات المشتركة',
              date: current.dueDate,
              sourceId: `${e.id}#r${current.index}`,
              type: 'استحقاق',
              entryType: 'جمعية مالية',
              to,
            }),
          )
        }
        const manager = iAmManager(d, fnd, myNames)
        for (const cycle of plan.cycles) {
          if (!cycle.dueDate || !(cycle.dueDate < today)) continue
          names.forEach((member, idx) => {
            if (memberPaid(cycle, member)) return
            const mine = (!!fnd && member.includes(`(${fnd})`)) || myNames.includes(member)
            if (!mine && !manager) return
            cal.push(
              item({
                title: mine
                  ? `متأخرة: مساهمتك في الدورة ${cycle.index} — ${name}`
                  : `متأخرة: ${withoutFnd(member)} — الدورة رقم ${cycle.index} — ${name}`,
                module: 'الالتزامات المشتركة',
                date: cycle.dueDate!,
                sourceId: `${e.id}#r${cycle.index}-${idx}`,
                type: 'استحقاق',
                entryType: 'جمعية مالية',
                to,
              }),
            )
          })
        }
      }
      // اعتماد الصرف: للمسؤول، ما ينتظر اعتماده.
      if (iAmManager(d, fnd, myNames)) {
        for (const x of sharedExpenses(d).filter((x) => x.status === 'بانتظار الموافقة')) {
          cal.push(
            item({
              title: `مصروف بانتظار اعتمادك: ${x.description || 'مصروف'} ${plain(x.amount)} ${currency} — ${name}`,
              module: 'الالتزامات المشتركة',
              date: parseDay(x.date) ?? today,
              sourceId: `${e.id}#a${x.id}`,
              type: 'اعتماد صرف',
              entryType: 'اعتماد صرف',
              to,
            }),
          )
        }
        for (const c of sharedContributions(d).filter((c) => c.status === 'بانتظار الموافقة')) {
          cal.push(
            item({
              title: `ميزانية إضافية بانتظار اعتمادك: ${plain(c.amount)} ${currency} — ${name}`,
              module: 'الالتزامات المشتركة',
              date: parseDay(c.date) ?? today,
              sourceId: `${e.id}#c${c.id}`,
              type: 'اعتماد صرف',
              entryType: 'اعتماد صرف',
              to,
            }),
          )
        }
      }
      // تنبيه الميزانية: بلوغ النسبة المختارة أو تجاوزها.
      if (hasPot(d)) {
        const b = sharedBudget(d)
        const left = sharedRemaining(d)
        const percent = parseInt(str(d['تنبيه عند صرف نسبة']).match(/\d+/)?.[0] ?? '0', 10)
        const spentPct = (sharedTotal(d) * 100) / b
        const exceeded = left < -0.01
        if (exceeded || (percent > 0 && spentPct + 0.001 >= percent)) {
          const limit = exceeded ? b : (b * percent) / 100
          const rows = approvedExpenses(d)
            .map((x) => [parseDay(x.date) ?? today, x.amount] as [Date, number])
            .sort((a, z) => a[0].getTime() - z[0].getTime())
          let sum = 0
          let reached = today
          for (const [day, amount] of rows) {
            sum += amount
            if (exceeded ? sum > limit + 0.01 : sum + 0.01 >= limit) {
              reached = day
              break
            }
          }
          cal.push(
            item({
              title: exceeded
                ? `تجاوز الميزانية «${name}»: العجز ${plain(-left)} ${currency}`
                : `الميزانية «${name}»: صُرف ${Math.round(spentPct)}% من قيمتها`,
              module: 'الالتزامات المشتركة',
              date: reached,
              sourceId: `${e.id}#b`,
              type: 'تنبيه الميزانية',
              entryType: 'تنبيه الميزانية',
              to,
            }),
          )
        }
      }
      const due = parseDay(e.due_date)
      if (due) {
        cal.push(item({ title: name, module: 'الالتزامات المشتركة', date: due, sourceId: e.id, status: e.status, entryType: e.entry_type, remindBeforeDays: reminderDaysOf(d), to }))
      }
    }

    // ---- الأفراد والجهات.
    let peopleMoney = 0
    let peopleDocs = 0
    for (const p of people.data ?? []) {
      if (Number(p.dueToYou) > 0 || Number(p.dueOnYou) > 0) peopleMoney += 1
      const expiring = Object.entries(p.details ?? {}).some(([k, v]) => {
        if (!k.startsWith('انتهاء ')) return false
        const date = parseDay(v)
        return !!date && date <= in30
      })
      if (expiring) peopleDocs += 1
    }

    cal.sort((a, b) => a.date.getTime() - b.date.getTime())
    return {
      personalMoney,
      personalDocs,
      personalNeedsFollowup,
      sharedMoney,
      sharedDocs,
      peopleMoney,
      peopleDocs,
      assetsMoney,
      assetsDocs,
      calendarItems: cal,
    }
  }, [personal.data, shared.data, assets.data, contracts.data, payments.data, people.data, reminders.data, records.data, delegations.data, fnd, store.data, defaultCurrency])

  return { loading, metrics }
}

export type { Entry }
