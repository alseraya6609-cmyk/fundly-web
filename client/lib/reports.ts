import { useMemo } from 'react'
import { useSession } from './session'
import { custodyRole, hasMine, useAssets, useCurrency, usePeopleAll, usePersonalAll, useSharedAll, useStore } from './data'
import {
  FINAL_STATUSES,
  TRANSACTION_TYPES,
  entryDerivedStatus,
  entryFollowDate,
  entryNextRepeatDate,
  entryOutcomeStatus,
  parseDay,
  startOfToday,
} from './metrics'

/*
  التقارير والأرشيف كما في التطبيق:
  - SummaryItem وHomeSummaryService.loadItems (lib/data/home_summary_service.dart):
    كل السجلات بشكل موحّد.
  - ReportFilter وapplyReportFilter وreportStateOf وbuildReportHtml
    (lib/data/report_document.dart): المعايير وتطبيقها والمستند نفسه (HTML ← PDF).
  - التقارير المحفوظة في reports_archive_records_v1 (main.dart ← _ReportsArchiveHubPage).

  الموقع يقرأ التقارير المحفوظة ويبنيها من البيانات الحالية كما يفعل التطبيق
  عند فتحها، والطباعة والحفظ PDF من المتصفح. لا يحفظ تقريرًا جديدًا.
*/

// ---------------- ScopeCatalog ----------------

export const SCOPE = {
  personal: 'الالتزامات الشخصية',
  shared: 'الالتزامات المشتركة',
  people: 'الأفراد والجهات',
  delegations: 'التفويضات',
  realEstate: 'العقارات',
  activities: 'الأنشطة التجارية',
  equipment: 'آليات ومعدات',
} as const

const TYPES_BY_SCOPE: Record<string, Record<string, string[]>> = {
  [SCOPE.personal]: {
    مالية: ['المصروفات الشخصية', 'إيراد', 'دين / قرض / سلفة', 'قسط', 'غرامة'],
    مستند: ['مستند'],
    'المتابعة والتخطيط': ['مهمة', 'موعد', 'عادة يومية', 'تذكير', 'ملاحظات'],
    التفويض: ['تفويض'],
    'أدوية وبيانات وكلمات سر': ['أدوية', 'كلمات سر'],
    'نمط الحياة': ['اشتراك', 'مناسبة'],
    'مواقع وأماكن': ['مكان'],
    'عهدة مالية': ['عهدة مالية'],
  },
  [SCOPE.shared]: {
    مالية: ['جمعية مالية'],
    'نمط الحياة': ['الرحلة / السفر', 'اللقاءات'],
    'المتابعة والتخطيط': ['مشاركات مشتركة'],
  },
  [SCOPE.people]: {
    الأفراد: ['فرد'],
    'الجهات والشركات': ['جهة'],
  },
}

const SECTIONS: Record<string, string[]> = {
  [SCOPE.personal]: ['مالية', 'مستند', 'المتابعة والتخطيط', 'التفويض', 'أدوية وبيانات وكلمات سر', 'نمط الحياة', 'مواقع وأماكن', 'عهدة مالية'],
  [SCOPE.shared]: ['مالية', 'نمط الحياة', 'المتابعة والتخطيط'],
  [SCOPE.people]: ['الأفراد', 'الجهات والشركات'],
}

const LEGACY_SECTION: Record<string, string> = {
  مصروف: 'مالية',
  دخل: 'مالية',
  ديون: 'مالية',
  اشتراكات: 'نمط الحياة',
  رحلة: 'نمط الحياة',
  جمعية: 'مالية',
  عادة: 'المتابعة والتخطيط',
  'التنظيم والمتابعة': 'المتابعة والتخطيط',
}

/** ScopeCatalog.sectionForType */
function sectionForType(scope: string, entryType: string, fallback = ''): string {
  const table = TYPES_BY_SCOPE[scope]
  if (table) for (const [section, types] of Object.entries(table)) if (types.includes(entryType)) return section
  const mapped = LEGACY_SECTION[entryType]
  if (mapped) return mapped
  if (fallback === 'التنظيم والمتابعة' || fallback === 'organization') return 'المتابعة والتخطيط'
  if ((SECTIONS[scope] ?? []).includes(fallback)) return fallback
  return fallback || 'أخرى'
}

// ---------------- SummaryItem ----------------

export type SummaryItem = {
  scope: string
  section: string
  type: string
  title: string
  amount: number
  date: Date | null
  status: string
  person: string
  payment: string
  subtitle: string
  createdAt: Date | null
  searchText: string
  followsDate: boolean
  followDate: Date | null
  canBeOverdue: boolean
}

function summaryItem(partial: Partial<SummaryItem> & Pick<SummaryItem, 'scope' | 'section' | 'type' | 'title'>): SummaryItem {
  return {
    amount: 0,
    date: null,
    status: '',
    person: '',
    payment: '',
    subtitle: '',
    createdAt: null,
    searchText: '',
    followsDate: true,
    followDate: null,
    canBeOverdue: true,
    ...partial,
  }
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()

function followDay(item: SummaryItem): Date | null {
  if (!item.followsDate) return null
  const d = item.followDate ?? item.date
  return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null
}

function personOf(details: Record<string, unknown>): string {
  for (const key of ['اسم الجهة', 'الجهة', 'اسم المستلم', 'اسم المفوَّض', 'الاسم']) {
    const value = str(details[key])
    if (value) return value
  }
  return ''
}

function isoDate(raw: unknown): Date | null {
  const text = str(raw)
  if (!text) return null
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

const detailsText = (details: Record<string, unknown>) =>
  Object.values(details ?? {})
    .map((v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v)))
    .join(' ')

/** HomeSummaryService.loadItems — التفويضات لا تدخل أي قسم من أقسام التقرير فلا تُجلب. */
export function useSummaryItems() {
  const { profile } = useSession()
  const fnd = profile?.fnd_id ?? ''
  const personal = usePersonalAll()
  const shared = useSharedAll()
  const assets = useAssets()
  const people = usePeopleAll()
  const loading = personal.isLoading || shared.isLoading || assets.isLoading || people.isLoading

  const items = useMemo<SummaryItem[]>(() => {
    const today = startOfToday()
    const out: SummaryItem[] = []

    for (const e of personal.data ?? []) {
      const details = e.details ?? {}
      if (e.entry_type === 'عهدة مالية' || e.entry_type === 'دين / قرض / سلفة') {
        const { role, accepted } = custodyRole(details, fnd)
        if (role === 'observer' || (role === 'holder' && !accepted)) continue
      }
      const due = parseDay(e.due_date)
      const amount = Math.round(Number(e.amount) || 0)
      const follow = entryFollowDate(e.entry_type, due, details, today)
      const outcome = entryOutcomeStatus(e.entry_type, due, details, amount, today)
      out.push(
        summaryItem({
          followsDate: follow !== null,
          followDate: follow,
          scope: SCOPE.personal,
          section: sectionForType(SCOPE.personal, e.entry_type, e.category),
          type: e.entry_type || 'غير مصنّف',
          title: e.title,
          amount,
          date: due,
          status: FINAL_STATUSES.has(e.status) ? e.status : (outcome ?? entryDerivedStatus(e.status, details, today)),
          person: personOf(details),
          payment: str(details['طريقة الدفع']),
          subtitle: e.category ?? '',
          createdAt: isoDate(e.created_at),
          searchText: detailsText(details),
        }),
      )
    }

    for (const e of shared.data ?? []) {
      const details = e.details ?? {}
      if (hasMine(details, 'مؤرشف عند', fnd)) continue
      const due = parseDay(e.due_date)
      const isTransaction = TRANSACTION_TYPES.has(e.entry_type)
      const next = isTransaction && due ? entryNextRepeatDate(due, details, today) : null
      out.push(
        summaryItem({
          followsDate: !isTransaction || next !== null,
          followDate: next,
          scope: SCOPE.shared,
          section: sectionForType(SCOPE.shared, e.entry_type, e.category),
          type: e.entry_type || 'غير مصنّف',
          title: e.title,
          amount: Math.round(Number(e.amount) || 0),
          date: due,
          status: e.status ?? '',
          person: personOf(details),
          payment: str(details['طريقة الدفع']),
          subtitle: e.category ?? '',
          createdAt: isoDate(e.created_at),
          searchText: detailsText(details),
        }),
      )
    }

    for (const a of assets.data ?? []) {
      const scope = a.category === 'real_estate' ? SCOPE.realEstate : a.category === 'business' || a.category === 'activity' ? SCOPE.activities : SCOPE.equipment
      const extra = a as typeof a & { description?: string | null; serial_number?: string | null }
      out.push(
        summaryItem({
          canBeOverdue: false,
          scope,
          section: a.sub_type || 'بيانات الأصل',
          type: a.sub_type || 'أصل',
          title: a.title,
          date: parseDay(a.end_date),
          status: a.status || 'نشط',
          person: a.tenant ?? a.owner ?? '',
          subtitle: a.location_or_type ?? '',
          searchText: [a.owner ?? '', a.tenant ?? '', extra.description ?? '', extra.serial_number ?? ''].join(' '),
        }),
      )
    }

    for (const p of people.data ?? []) {
      const typeKey = str(p.typeKey)
      const isEntity = typeKey.startsWith('entity_')
      const category = str(p.categoryName)
      const name = str(p.fullName)
      const record = p as typeof p & { phone?: string; email?: string; city?: string; address?: string }
      out.push(
        summaryItem({
          followsDate: false,
          scope: SCOPE.people,
          section: isEntity ? 'الجهات والشركات' : 'الأفراد',
          type: category || (isEntity ? 'جهة' : 'فرد'),
          title: name,
          amount: Math.round(Number(p.dueToYou) || 0) + Math.round(Number(p.dueOnYou) || 0),
          date: parseDay(p.createdAt),
          status: isEntity ? 'جهة' : 'فرد',
          person: name,
          subtitle: str(p.roleTitle),
          searchText: [p.nickName, record.phone, record.email, record.city, record.address].filter((v) => v !== undefined && v !== null).join(' '),
        }),
      )
    }
    return out
  }, [personal.data, shared.data, assets.data, people.data, fnd])

  return { loading, items }
}

// ---------------- search_matching.dart ----------------

function normalizeForSearch(input: string): string {
  let value = input.toLowerCase().trim()
  if (!value) return ''
  value = value.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  value = value.replace(/[ً-ٰٕـ]/g, '')
  const digits = '٠١٢٣٤٥٦٧٨٩'
  for (let i = 0; i < 10; i++) value = value.split(digits[i]).join(String(i))
  value = value.replace(/[^0-9a-zA-Z؀-ۿ\s]+/g, ' ')
  return value.replace(/\s+/g, ' ').trim()
}

function matchesSearchQuery(query: string, fields: string[]): boolean {
  const haystack = normalizeForSearch(fields.join(' '))
  const normalized = normalizeForSearch(query)
  const tokens = normalized ? normalized.split(' ').filter((tk) => tk.length >= 2 || /^\d+$/.test(tk)) : []
  if (!tokens.length) return !normalized || haystack.includes(normalized)
  const words = haystack.split(' ')
  return tokens.every((tk) => words.some((w) => w === tk || w.startsWith(tk) || (tk.length >= 3 && w.includes(tk))))
}

// ---------------- ReportFilter ----------------

export const REPORT_MODULES = ['الكل', 'الالتزامات الشخصية', 'الالتزامات المشتركة', 'الأفراد والجهات', 'العقارات', 'الأنشطة التجارية', 'المركبات ووسائل النقل']

/** الفترة ▼ (kAppFilterPeriods). */
export const PERIODS = ['اليوم', 'أمس', 'غدًا', 'آخر 7 أيام', 'بعد أسبوع', 'آخر 30 يوم', 'آخر شهرين', 'آخر 3 أشهر', 'آخر 6 أشهر', 'آخر سنة', 'مخصص']

/** الحالة ▼ (kAppFilterSelectStatuses)، وللأصول ما يخصها. */
export const SELECT_STATUSES = ['الأحدث أولاً', 'نشط', 'قريبة الاستحقاق', 'مستحقة', 'متأخرة', 'مكتملة']
const ASSET_EXTRA_STATUSES = ['ملغاة', 'مسودة', 'تنتهي قريبًا', 'منتهية']
export const statusesFor = (module: string) =>
  ['العقارات', 'الأنشطة التجارية', 'المركبات ووسائل النقل'].includes(module) ? [...SELECT_STATUSES, ...ASSET_EXTRA_STATUSES] : SELECT_STATUSES

export const AMOUNT_ORDERS = ['أعلى مبلغًا', 'أقل مبلغًا']
export const PAYMENT_METHODS = ['نقدًا', 'تحويل بنكي', 'بطاقة بنكية', 'محفظة إلكترونية', 'أخرى']

export type FilterValues = {
  mainCategory: string
  subCategory: string | null
  dateFrom: Date | null
  dateTo: Date | null
  datePeriod: string | null
  status: string
  amountFrom: number | null
  amountTo: number | null
  amountShortcut: string | null
  paymentMethod: string | null
  personName: string
  placeName: string
}

export type ReportFilter = { module: string; values: FilterValues; query: string }

export const emptyValues = (): FilterValues => ({
  mainCategory: 'الكل',
  subCategory: null,
  dateFrom: null,
  dateTo: null,
  datePeriod: null,
  status: 'كل الحالات',
  amountFrom: null,
  amountTo: null,
  amountShortcut: null,
  paymentMethod: null,
  personName: '',
  placeName: '',
})

/** AppFilterValues.fromMap */
function valuesFromMap(map: Record<string, unknown>): FilterValues {
  const text = (k: string) => {
    const v = map[k]
    if (v === null || v === undefined) return null
    const s = String(v)
    return s ? s : null
  }
  const num = (k: string) => {
    const v = map[k]
    if (typeof v === 'number') return v
    const n = v === null || v === undefined ? NaN : Number(v)
    return Number.isFinite(n) ? n : null
  }
  const day = (k: string) => {
    const v = text(k)
    if (!v) return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return {
    mainCategory: text('mainCategory') ?? 'الكل',
    subCategory: text('subCategory'),
    dateFrom: day('dateFrom'),
    dateTo: day('dateTo'),
    datePeriod: text('datePeriod'),
    status: text('status') ?? 'كل الحالات',
    amountFrom: num('amountFrom'),
    amountTo: num('amountTo'),
    amountShortcut: text('amountShortcut'),
    paymentMethod: text('paymentMethod'),
    personName: text('personName') ?? '',
    placeName: text('placeName') ?? '',
  }
}

/** appFilterPeriodRange */
export function periodRange(period: string): [Date, Date] {
  const now = startOfToday()
  const shift = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  const months = (n: number) => new Date(now.getFullYear(), now.getMonth() - n, now.getDate())
  switch (period) {
    case 'أمس':
      return [shift(-1), shift(-1)]
    case 'غدًا':
      return [shift(1), shift(1)]
    case 'بعد أسبوع':
      return [now, shift(7)]
    case 'آخر 7 أيام':
      return [shift(-6), now]
    case 'آخر 30 يوم':
      return [shift(-29), now]
    case 'آخر شهرين':
      return [months(2), now]
    case 'آخر 3 أشهر':
      return [months(3), now]
    case 'آخر 6 أشهر':
      return [months(6), now]
    case 'آخر سنة':
      return [new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), now]
    default:
      return [now, now]
  }
}

export function reportDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** ReportFilter.describe */
export function describeFilter(f: ReportFilter): [string, string][] {
  const v = f.values
  const out: [string, string][] = [['القسم', f.module]]
  if (v.mainCategory !== 'الكل' && v.mainCategory !== f.module) out.push(['الفئة', v.mainCategory])
  if (v.subCategory) out.push(['التصنيف', v.subCategory])
  if (v.dateFrom || v.dateTo) {
    const range = `${v.dateFrom ? reportDate(v.dateFrom) : '—'} ← ${v.dateTo ? reportDate(v.dateTo) : '—'}`
    out.push(['الفترة', v.datePeriod ? `${v.datePeriod} (${range})` : range])
  }
  if (v.status !== 'كل الحالات') out.push(['الحالة', v.status])
  if (v.amountShortcut) out.push(['المبلغ', v.amountShortcut])
  if (v.amountFrom !== null || v.amountTo !== null)
    out.push(['نطاق المبلغ', `${v.amountFrom !== null ? v.amountFrom.toFixed(0) : '—'} ← ${v.amountTo !== null ? v.amountTo.toFixed(0) : '—'}`])
  if (v.paymentMethod) out.push(['طريقة الدفع', v.paymentMethod])
  if (v.personName.trim()) out.push(['الشخص / الجهة', v.personName.trim()])
  if (v.placeName.trim()) out.push(['المكان', v.placeName.trim()])
  if (f.query.trim()) out.push(['كلمة البحث', f.query.trim()])
  return out
}

function scopeOfModule(module: string): string | null {
  switch (module) {
    case 'الالتزامات الشخصية':
      return SCOPE.personal
    case 'الالتزامات المشتركة':
      return SCOPE.shared
    case 'الأفراد والجهات':
      return SCOPE.people
    case 'العقارات':
      return SCOPE.realEstate
    case 'الأنشطة التجارية':
      return SCOPE.activities
    case 'المركبات ووسائل النقل':
      return SCOPE.equipment
    default:
      return null
  }
}

export const scopeLabel = (scope: string) => (scope === SCOPE.equipment ? 'المركبات ووسائل النقل' : scope)

// ---------------- الحالة ----------------

const CLOSED_WORDS = ['مكتمل', 'منته', 'مغلق', 'مسدد', 'منجز', 'مؤرشف', 'تسوية', 'مجمّد', 'محذوف']
const isClosed = (status: string) => CLOSED_WORDS.some((w) => status.includes(w))
const isCancelled = (status: string) => status.includes('ملغ')

function daysUntil(item: SummaryItem): number | null {
  const d = followDay(item)
  if (!d) return null
  const today = startOfToday()
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000)
}

export type ReportState = 'active' | 'dueSoon' | 'dueToday' | 'overdue' | 'done' | 'cancelled' | 'archived'

export function reportStateOf(item: SummaryItem): ReportState {
  const status = item.status.trim()
  if (status.includes('مؤرشف')) return 'archived'
  if (isCancelled(status)) return 'cancelled'
  if (isClosed(status)) return 'done'
  const days = daysUntil(item)
  if (days !== null && item.scope !== SCOPE.people) {
    if (days < 0) return item.canBeOverdue ? 'overdue' : 'active'
    if (days === 0) return 'dueToday'
    if (days <= 7) return 'dueSoon'
  }
  return 'active'
}

function matchesCategory(item: SummaryItem, category: string) {
  const wanted = category === 'أفراد' ? 'الأفراد' : category === 'جهات' ? 'الجهات والشركات' : category
  if (item.section === wanted || item.type === wanted || item.subtitle === wanted) return true
  return wanted === 'مشاركات مشتركة' && item.type === 'اللقاءات'
}

function matchesStatus(item: SummaryItem, option: string) {
  const status = item.status.trim()
  const days = daysUntil(item)
  const closed = isClosed(status) || isCancelled(status)
  switch (option) {
    case '':
    case 'كل الحالات':
    case 'الأحدث أولاً':
      return true
    case 'نشط':
      return !closed
    case 'قريبة الاستحقاق':
    case 'المستحق بعد 7 أيام':
      return !closed && days !== null && days >= 0 && days <= 7
    case 'تنتهي قريبًا':
      return !closed && days !== null && days >= 0 && days <= 30
    case 'مستحقة':
      return !closed && days === 0
    case 'متأخرة':
    case 'متأخر':
      return !closed && item.canBeOverdue && days !== null && days < 0
    case 'مكتملة':
    case 'مكتمل':
      return isClosed(status)
    case 'منتهية':
      return status.includes('منته') || (days !== null && days < 0)
    case 'ملغاة':
      return isCancelled(status)
    case 'مؤرشف':
      return status.includes('مؤرشف')
  }
  return status === option || status.includes(option)
}

const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

function matchesDate(v: FilterValues, d: Date | null) {
  if (!v.dateFrom && !v.dateTo) return true
  if (!d) return false
  const day = dayOnly(d)
  if (v.dateFrom && day < dayOnly(v.dateFrom)) return false
  if (v.dateTo && day > dayOnly(v.dateTo)) return false
  return true
}

/** applyReportFilter */
export function applyReportFilter(items: SummaryItem[], filter: ReportFilter): SummaryItem[] {
  const v = filter.values
  const scope = scopeOfModule(filter.module)
  const out = items.filter((item) => {
    if (scope === null) {
      if (item.scope === SCOPE.delegations) return false
    } else if (item.scope !== scope) return false
    if (v.mainCategory !== 'الكل' && v.mainCategory !== filter.module && !matchesCategory(item, v.mainCategory)) return false
    if (v.subCategory && !matchesCategory(item, v.subCategory)) return false
    if (!matchesDate(v, item.date ?? item.createdAt)) return false
    if (!matchesStatus(item, v.status)) return false
    if (v.amountFrom !== null && item.amount < v.amountFrom) return false
    if (v.amountTo !== null && item.amount > v.amountTo) return false
    if (v.paymentMethod) {
      if (v.paymentMethod === 'أخرى') {
        if (!item.payment.trim() || PAYMENT_METHODS.some((k) => k !== 'أخرى' && item.payment.includes(k))) return false
      } else if (!item.payment.includes(v.paymentMethod)) return false
    }
    if (v.personName.trim() && !matchesSearchQuery(v.personName, [item.person, item.title, item.searchText])) return false
    if (v.placeName.trim() && !matchesSearchQuery(v.placeName, [item.subtitle, item.searchText])) return false
    if (
      filter.query.trim() &&
      !matchesSearchQuery(filter.query, [item.title, item.subtitle, item.person, item.type, item.section, item.status, item.payment, item.searchText])
    )
      return false
    return true
  })

  const byDate = (a: SummaryItem, b: SummaryItem) => {
    const da = a.date ?? a.createdAt
    const db = b.date ?? b.createdAt
    if (!da && !db) return a.title.localeCompare(b.title)
    if (!da) return 1
    if (!db) return -1
    return da.getTime() - db.getTime()
  }
  if (v.amountShortcut === 'أعلى مبلغًا') out.sort((a, b) => b.amount - a.amount)
  else if (v.amountShortcut === 'أقل مبلغًا') out.sort((a, b) => a.amount - b.amount)
  else if (v.status === 'الأحدث أولاً') out.sort((a, b) => byDate(b, a))
  else out.sort(byDate)
  return out
}

// ---------------- التقارير المحفوظة ----------------

export type SavedReport = {
  id: string
  title: string
  type: string
  subject: string
  mode: string
  createdBy: string
  createdAt: Date
  filter: ReportFilter | null
  /** تقرير بصيغة قديمة (ScopeSelection) بلا معايير الفلتر الجديدة. */
  legacy: boolean
  archivedAt: Date | null
  archiveReason: string
}

function parseReport(map: Record<string, unknown>): SavedReport {
  const day = (v: unknown) => {
    if (v === null || v === undefined) return null
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const rawFilter = map['filter']
  const filter =
    rawFilter && typeof rawFilter === 'object'
      ? {
          module: str((rawFilter as Record<string, unknown>)['module']) || 'الكل',
          values:
            (rawFilter as Record<string, unknown>)['values'] && typeof (rawFilter as Record<string, unknown>)['values'] === 'object'
              ? valuesFromMap((rawFilter as Record<string, Record<string, unknown>>)['values'])
              : emptyValues(),
          query: str((rawFilter as Record<string, unknown>)['query']),
        }
      : null
  return {
    id: str(map['id']),
    title: str(map['title']),
    type: str(map['type']) || 'تقرير عام',
    subject: str(map['subject']),
    mode: str(map['mode']) || 'عام',
    createdBy: str(map['createdBy']),
    createdAt: day(map['createdAt']) ?? new Date(),
    filter,
    legacy: !filter && !!map['selection'] && typeof map['selection'] === 'object',
    archivedAt: day(map['archivedAt']),
    archiveReason: str(map['archiveReason']),
  }
}

/** reports_archive_records_v1: {recent: [...], archived: [...]} */
export function useSavedReports() {
  const store = useStore()
  const data = useMemo(() => {
    if (!store.isSuccess) return undefined
    let decoded: unknown = store.data?.['reports_archive_records_v1']
    if (typeof decoded === 'string') {
      try {
        decoded = JSON.parse(decoded)
      } catch {
        decoded = null
      }
    }
    const pick = (key: string) => {
      const list = decoded && typeof decoded === 'object' ? (decoded as Record<string, unknown>)[key] : null
      return Array.isArray(list) ? list.filter((r) => r && typeof r === 'object').map((r) => parseReport(r as Record<string, unknown>)) : []
    }
    return { recent: pick('recent'), archived: pick('archived') }
  }, [store.isSuccess, store.data])
  return { ...store, data }
}

/** إعدادات المستند: الاسم والعملة وإخفاء المبالغ وشعار المستخدم — من بيانات التطبيق. */
export function useReportSettings() {
  const store = useStore()
  const { profile } = useSession()
  const currency = useCurrency()
  return useMemo(() => {
    const logo = str(store.data?.['user_logo_image_v1'])
    return {
      name: str(store.data?.['settings_profile_name']) || profile?.display_name || '',
      currency,
      hideAmounts: store.data?.['settings_hide_amounts'] === true,
      userLogo: logo || null,
    }
  }, [store.data, profile, currency])
}

// ---------------- مستند التقرير ----------------

export type ReportDocument = {
  title: string
  archive: boolean
  reference: string
  createdAt: Date
  createdBy: string
  criteria: [string, string][]
  items: SummaryItem[]
  archivedAt: Date | null
  archiveReason: string
}

const refDigits = (id: string) => (id.length > 6 ? id.slice(-6) : id)

/** _documentFor */
export function documentFor(report: SavedReport, all: SummaryItem[], fallbackName: string): ReportDocument {
  const archived = report.archivedAt !== null || report.mode === 'أرشيف'
  return {
    title: report.title,
    archive: archived,
    reference: `${archived ? 'AR' : 'RP'}-${refDigits(report.id)}`,
    createdAt: report.createdAt,
    createdBy: report.createdBy.trim() || fallbackName,
    criteria: report.filter ? describeFilter(report.filter) : [['القسم', report.type]],
    items: report.filter ? applyReportFilter(all, report.filter) : [],
    archivedAt: report.archivedAt,
    archiveReason: report.archiveReason,
  }
}

const esc = (input: string) =>
  input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const BADGES: Record<ReportState, [string, string]> = {
  done: ['done', 'مكتمل'],
  cancelled: ['cancel', 'ملغى'],
  overdue: ['late', 'متأخر'],
  dueToday: ['today', 'مستحق اليوم'],
  dueSoon: ['soon', 'قريب الاستحقاق'],
  active: ['active', 'نشط'],
  archived: ['archived', 'مؤرشف'],
}

function rankIn(order: string[], key: string) {
  const i = order.indexOf(key)
  return i < 0 ? 1000 : i
}

function typeRank(scope: string, type: string) {
  const table = TYPES_BY_SCOPE[scope]
  if (!table) return 1000
  let index = 0
  for (const types of Object.values(table)) {
    for (const candidate of types) {
      if (candidate === type) return index
      index++
    }
  }
  return 1000
}

export type HtmlOptions = {
  t: (s: string) => string
  lang: string
  dir: 'rtl' | 'ltr'
  currency: string
  hideAmounts: boolean
  userLogo: string | null
  origin: string
}

/** buildReportHtml — نفس الصفحة ونفس التنسيق (A4) في التطبيق. */
export function buildReportHtml(doc: ReportDocument, o: HtmlOptions): string {
  const T = (s: string) => esc(o.t(s))
  const amount = (value: number) => {
    const negative = value < 0
    const digits = String(Math.round(Math.abs(value)))
    let buffer = ''
    for (let i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 === 0) buffer += ','
      buffer += digits[i]
    }
    return o.hideAmounts ? '••••' : `${negative ? '-' : ''}${buffer}`
  }
  const items = doc.items
  const currency = esc(o.t(o.currency))
  const total = items.reduce((s, i) => s + i.amount, 0)
  const states = items.map(reportStateOf)
  const overdue = states.filter((s) => s === 'overdue').length
  const soon = states.filter((s) => s === 'dueSoon' || s === 'dueToday').length
  const done = states.filter((s) => s === 'done').length
  const showScope = new Set(items.map((i) => i.scope)).size > 1

  const groups = new Map<string, [number, number]>()
  for (const item of items) {
    const key = showScope ? scopeLabel(item.scope) : item.type.trim() || 'غير مصنّف'
    const cur = groups.get(key) ?? [0, 0]
    groups.set(key, [cur[0] + 1, cur[1] + item.amount])
  }
  const scopeOfItems = items[0]?.scope ?? ''
  const rankOf = (key: string) => (showScope ? rankIn(REPORT_MODULES, key) : typeRank(scopeOfItems, key))
  const groupRows = [...groups.entries()].sort((a, b) => {
    const r = rankOf(a[0]) - rankOf(b[0])
    return r !== 0 ? r : b[1][0] - a[1][0]
  })
  const shareByAmount = total > 0

  const font = (file: string, weight: number) =>
    `@font-face{font-family:'ReportCairo';font-weight:${weight};src:url(${o.origin}/fonts/${file}) format('woff2');}`
  const kpi = (label: string, value: string, tone: string) => `<div class="kpi ${tone}"><span>${T(label)}</span><b>${value}</b></div>`

  const h: string[] = []
  h.push(
    `<!DOCTYPE html><html lang="${o.lang}" dir="${o.dir}"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>`,
    font('Cairo-Regular.woff2', 400),
    font('Cairo-SemiBold.woff2', 600),
    font('Cairo-Bold.woff2', 700),
    font('Cairo-ExtraBold.woff2', 800),
    REPORT_CSS,
    '</style></head><body>',
  )

  if (doc.archive) h.push(`<div class="watermark">${T('أرشيف')}</div>`)

  if (o.userLogo) {
    const mime = o.userLogo.startsWith('/9j/') ? 'image/jpeg' : 'image/png'
    h.push(
      `<div style="text-align:center;margin:0 0 10px;"><img src="data:${mime};base64,${o.userLogo}" style="max-height:70px;max-width:200px;object-fit:contain;"></div>`,
    )
  }

  // ---------- الرأس ----------
  h.push(
    '<header class="head"><div class="brand">',
    `<img class="logo" src="${o.origin}/img/logo.png" alt="">`,
    `<div class="brand-text"><div class="app">Fundly</div><div class="app-sub">${T('إدارة الالتزامات والأصول')}</div></div></div><div class="doc-id">`,
    `<span class="kind ${doc.archive ? 'kind-archive' : ''}">${T(doc.archive ? 'أرشيف' : 'تقرير')}</span>`,
    `<div class="ref">${T('رقم المرجع')}: <b>${esc(doc.reference)}</b></div>`,
    `<div class="ref">${T('تاريخ الإصدار')}: <b>${reportDate(doc.createdAt)}</b></div>`,
    '</div></header>',
    `<div class="title-block"><h1>${esc(doc.title)}</h1><div class="by">${T('أُعدّ بواسطة')}: <b>${esc(doc.createdBy)}</b></div></div>`,
  )

  // ---------- المعايير ----------
  h.push(`<section class="criteria"><div class="sec-title">${T(doc.archive ? 'معايير الأرشيف' : 'معايير التقرير')}</div><div class="chips">`)
  for (const [label, value] of doc.criteria) h.push(`<span class="chip"><i>${T(label)}</i>${T(value)}</span>`)
  h.push('</div></section>')

  if (doc.archive && (doc.archivedAt || doc.archiveReason.trim())) {
    h.push(
      `<section class="archive-box"><div class="ab-row"><span>${T('تاريخ الأرشفة')}</span><b>${doc.archivedAt ? reportDate(doc.archivedAt) : '—'}</b></div>`,
      `<div class="ab-row"><span>${T('سبب الأرشفة')}</span><b>${doc.archiveReason.trim() ? esc(doc.archiveReason) : T('غير محدد')}</b></div></section>`,
    )
  }

  // ---------- المؤشرات ----------
  h.push(
    '<section class="kpis">',
    kpi('عدد العناصر', String(items.length), 'teal'),
    kpi('إجمالي المبالغ', `${amount(total)} <small>${currency}</small>`, 'gold'),
    kpi('متأخرة', String(overdue), 'red'),
    kpi('قريبة / مستحقة', String(soon), 'amber'),
    kpi('مكتملة', String(done), 'green'),
    '</section>',
  )

  if (!items.length) {
    h.push(`<div class="empty">${T('لا توجد عناصر تطابق المعايير المختارة.')}</div>`)
  } else {
    // ---------- التوزيع ----------
    h.push(
      `<section class="block"><div class="sec-title">${T(showScope ? 'التوزيع حسب القسم' : 'التوزيع حسب التصنيف')}</div><div class="hint">`,
      shareByAmount
        ? `${T('النسبة = حصة كل صف من إجمالي المبالغ')} (${amount(total)} ${currency})`
        : `${T('النسبة = حصة كل صف من عدد العناصر')} (${items.length})`,
      `</div><table class="dist"><thead><tr><th>${T(showScope ? 'القسم' : 'التصنيف')}</th><th class="n">${T('العدد')}</th><th class="n">${T('الإجمالي')}</th>`,
      `<th class="bar-col">${T(shareByAmount ? 'النسبة من إجمالي المبالغ' : 'النسبة من عدد العناصر')}</th></tr></thead><tbody>`,
    )
    for (const [key, [n, sum]] of groupRows) {
      const part = shareByAmount ? sum : n
      const whole = shareByAmount ? total : items.length
      const percent = whole === 0 ? 0 : Math.round((part * 100) / whole)
      h.push(
        `<tr><td>${T(key)}</td><td class="n">${n}</td><td class="n">${amount(sum)}</td>`,
        `<td class="bar-col"><div class="bar"><span style="width:${percent}%"></span></div><em>${percent}%</em></td></tr>`,
      )
    }
    h.push('</tbody></table></section>')

    // ---------- التفاصيل ----------
    h.push(
      `<section class="block"><div class="sec-title">${T('التفاصيل')} <small>(${items.length})</small></div>`,
      `<table class="details"><thead><tr><th class="idx">#</th><th>${T('العنوان')}</th><th>${T(showScope ? 'القسم / التصنيف' : 'التصنيف')}</th>`,
      `<th>${T('الشخص / الجهة')}</th><th class="d">${T('التاريخ')}</th><th class="s">${T('الحالة')}</th><th class="n">${T('المبلغ')}</th></tr></thead><tbody>`,
    )
    items.forEach((item, i) => {
      const [badgeClass, badgeLabel] = BADGES[states[i]]
      const rawStatus = item.status.trim()
      const category = [showScope ? scopeLabel(item.scope) : '', item.type.trim() && item.type.trim() !== item.scope ? item.type.trim() : '']
        .filter(Boolean)
        .map((s) => esc(o.t(s)))
        .join(' › ')
      const d = item.date ?? item.createdAt
      h.push(
        `<tr><td class="idx">${i + 1}</td><td><b>${esc(item.title || '—')}</b>`,
        !item.subtitle.trim() || item.subtitle === item.type ? '' : `<div class="sub">${esc(o.t(item.subtitle))}</div>`,
        `</td><td>${category || '—'}</td><td>${item.person.trim() ? esc(item.person) : '—'}</td>`,
        `<td class="d">${d ? reportDate(d) : '—'}</td><td class="s"><span class="badge ${badgeClass}">${T(badgeLabel)}</span>`,
        !rawStatus || rawStatus === badgeLabel ? '' : `<div class="sub">${T(rawStatus)}</div>`,
        `</td><td class="n">${item.amount === 0 ? '—' : amount(item.amount)}</td></tr>`,
      )
    })
    h.push(
      `</tbody><tfoot><tr><td colspan="6">${T('الإجمالي')}</td><td class="n">${amount(total)} ${currency}</td></tr></tfoot></table></section>`,
    )
  }

  // ---------- التوقيعات والتذييل ----------
  h.push(
    `<section class="signs"><div class="sign"><span>${T('توقيع المُعِدّ')}</span><i></i><b>${esc(doc.createdBy)}</b></div>`,
    `<div class="sign"><span>${T('الاعتماد')}</span><i></i><b>&nbsp;</b></div></section>`,
    `<footer class="foot"><span>${T('صدر من تطبيق')} Fundly</span><span>${reportDate(new Date())} · ${esc(doc.reference)}</span></footer>`,
    '</body></html>',
  )
  return h.join('')
}

/*
  kReportCss من التطبيق كما هو، ومعه هوامش الصفحة التي يضعها التطبيق في إعداد
  الطباعة (12 مم أعلى وأسفل، 11 مم يمينًا ويسارًا)، وعرض الصفحة على الشاشة.
*/
export const REPORT_CSS = `
@page{size:A4;margin:12mm 11mm;}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{background:#fff;}
body{font-family:'ReportCairo','Cairo',sans-serif;color:#1d2b29;font-size:11px;
line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
@media screen{html{background:#E9EEED;}body{max-width:210mm;margin:16px auto;padding:12mm 11mm;
box-shadow:0 4px 24px rgba(2,46,42,.12);border-radius:6px;min-height:297mm;}}
b{font-weight:700;}
.watermark{position:fixed;top:42%;left:0;right:0;text-align:center;
font-size:120px;font-weight:800;color:rgba(166,105,26,.07);
transform:rotate(-24deg);z-index:0;pointer-events:none;}
.head{display:flex;justify-content:space-between;align-items:center;
padding:14px 18px;border-radius:14px;
background:linear-gradient(120deg,#022E2A 0%,#0A5A50 55%,#0E7161 100%);color:#fff;}
.brand{display:flex;align-items:center;gap:10px;}
.logo{width:34px;height:46px;object-fit:contain;background:#fff;border-radius:9px;
padding:5px 6px;}
.app{font-size:19px;font-weight:800;letter-spacing:.5px;line-height:1.1;}
.app-sub{font-size:10px;opacity:.8;font-weight:600;}
.doc-id{text-align:end;}
.kind{display:inline-block;background:#F2A93F;color:#3b2606;font-weight:800;
font-size:11px;padding:2px 14px;border-radius:999px;margin-bottom:4px;}
.kind-archive{background:#fff;color:#A6691A;}
.ref{font-size:10px;opacity:.92;}
.ref b{font-weight:700;}
.title-block{padding:14px 4px 6px;border-bottom:2px solid #E9F4F1;margin-bottom:12px;
display:flex;justify-content:space-between;align-items:flex-end;gap:12px;}
h1{font-size:21px;font-weight:800;color:#022E2A;line-height:1.3;}
.by{font-size:10.5px;color:#5C6B68;white-space:nowrap;}
.by b{color:#0A5A50;}
.sec-title{font-size:12.5px;font-weight:800;color:#022E2A;margin:0 0 7px;
padding-inline-start:9px;border-inline-start:4px solid #0E7161;line-height:1.3;}
.sec-title small{color:#8C9A97;font-weight:600;font-size:10.5px;}
.criteria{margin-bottom:12px;}
.chips{display:flex;flex-wrap:wrap;gap:6px;}
.chip{background:#F4F8F7;border:1px solid #E1EBE8;border-radius:999px;
padding:3px 11px;font-weight:700;color:#0A5A50;font-size:10.5px;}
.chip i{font-style:normal;color:#8C9A97;font-weight:600;margin-inline-end:5px;}
.chip i:after{content:':';}
.archive-box{display:flex;gap:10px;margin-bottom:12px;background:#FDEFDC;
border:1px solid #F5D9AE;border-radius:12px;padding:9px 14px;}
.ab-row{flex:1;}
.ab-row span{display:block;font-size:9.5px;color:#A6691A;font-weight:700;}
.ab-row b{font-size:11.5px;color:#3b2606;}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}
.kpi{border-radius:12px;padding:9px 11px;border:1px solid #E6EEEC;background:#FAFCFB;
position:relative;overflow:hidden;}
.kpi:before{content:'';position:absolute;inset-inline-start:0;top:0;bottom:0;width:4px;}
.kpi span{display:block;font-size:9.5px;color:#5C6B68;font-weight:700;}
.kpi b{display:block;font-size:17px;font-weight:800;color:#022E2A;line-height:1.35;}
.kpi b small{font-size:9.5px;color:#8C9A97;font-weight:600;}
.kpi.teal:before{background:#0E7161;}.kpi.gold:before{background:#CE8422;}
.kpi.red:before{background:#C4392E;}.kpi.amber:before{background:#F2A93F;}
.kpi.green:before{background:#34A894;}
.kpi.red b{color:#C4392E;}
.block{margin-bottom:14px;}
table{width:100%;border-collapse:separate;border-spacing:0;}
thead{display:table-header-group;}
tfoot{display:table-row-group;}
tr{page-break-inside:avoid;break-inside:avoid;}
th{background:#0A5A50;color:#fff;font-weight:700;font-size:10px;text-align:start;
padding:7px 8px;}
th:first-child{border-start-start-radius:9px;}
th:last-child{border-start-end-radius:9px;}
td{padding:6px 8px;border-bottom:1px solid #EEF3F2;vertical-align:top;font-size:10.5px;}
tbody tr:nth-child(even) td{background:#F7FAF9;}
td .sub{font-size:9px;color:#8C9A97;font-weight:600;margin-top:1px;}
.n{text-align:end;white-space:nowrap;font-variant-numeric:tabular-nums;}
.d{white-space:nowrap;text-align:center;}
.s{text-align:center;}
.idx{width:26px;text-align:center;color:#8C9A97;font-weight:700;}
.dist td{font-weight:600;}
.hint{font-size:9.5px;color:#8C9A97;font-weight:600;margin:-3px 0 6px;}
.dist th.bar-col{white-space:nowrap;}
.bar-col{width:38%;}
.bar{display:inline-block;width:calc(100% - 38px);height:8px;background:#EAF1EF;
border-radius:99px;overflow:hidden;vertical-align:middle;}
.bar span{display:block;height:100%;background:linear-gradient(90deg,#178F7B,#0A5A50);
border-radius:99px;}
.bar-col em{font-style:normal;font-size:9.5px;color:#5C6B68;font-weight:700;
display:inline-block;width:34px;text-align:end;}
tfoot td{background:#E9F4F1;font-weight:800;color:#022E2A;font-size:11px;
border-bottom:none;}
tfoot td:first-child{border-end-start-radius:9px;}
tfoot td:last-child{border-end-end-radius:9px;}
.badge{display:inline-block;padding:1px 9px;border-radius:999px;font-size:9.5px;
font-weight:700;white-space:nowrap;}
.badge.active{background:#E3F3EF;color:#0E7161;}
.badge.soon{background:#FFF3DF;color:#A6691A;}
.badge.today{background:#FDE9D2;color:#A6691A;}
.badge.late{background:#FBE5E2;color:#C4392E;}
.badge.done{background:#E2F5EC;color:#1C7A55;}
.badge.cancel{background:#EEF1F0;color:#5C6B68;}
.badge.archived{background:#FDEFDC;color:#A6691A;}
.empty{text-align:center;padding:30px;border:1px dashed #D5DEDB;border-radius:12px;
color:#8C9A97;font-weight:700;margin-bottom:14px;}
.signs{display:flex;gap:40px;margin-top:26px;page-break-inside:avoid;}
.sign{flex:1;}
.sign span{font-size:10px;color:#5C6B68;font-weight:700;}
.sign i{display:block;border-bottom:1.5px dashed #B9C7C4;height:34px;margin:2px 0 4px;}
.sign b{font-size:10.5px;color:#022E2A;}
.foot{display:flex;justify-content:space-between;margin-top:16px;padding-top:8px;
border-top:1px solid #E6EEEC;font-size:9px;color:#8C9A97;font-weight:600;}
`
