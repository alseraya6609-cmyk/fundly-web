import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** المبلغ كما في التطبيق: رقمان بعد الفاصلة ثم العملة. */
export function money(value: unknown, currency = ''): string {
  const n = Number(value)
  const text = Number.isFinite(n) ? n.toFixed(2) : '0.00'
  return currency ? `${text} ${currency}` : text
}

/** التاريخ كما في التطبيق: يوم/شهر/سنة بأرقام لاتينية. */
export function date(value: unknown): string {
  if (!value) return ''
  const raw = String(value)
  const d = value instanceof Date ? value : new Date(raw.length === 10 ? `${raw}T00:00:00` : raw)
  if (Number.isNaN(d.getTime())) return raw
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

export function count(value: number): string {
  return String(value ?? 0)
}

/** مقارنة نصية تتجاهل التشكيل والهمزات والحالة — لبحث مريح بالعربية. */
export function normalize(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim()
}

export function matches(query: string, ...fields: unknown[]): boolean {
  const q = normalize(query)
  if (!q) return true
  return fields.some((f) => normalize(f).includes(q))
}

/**
  لحظة سطر في السجل (_logMoment في التطبيق): التاريخ «17/10/2026» أو
  «2026-10-17» أو «2026/10/17» أو ISO، ومعه الوقت «14:32» إن وُجد.
*/
export function logMoment(raw: unknown, time?: unknown): number | null {
  const text = `${String(raw ?? '').trim()} ${String(time ?? '').trim()}`
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(text.trim()) ? Date.parse(text.trim()) : NaN
  if (!Number.isNaN(iso)) return iso
  const clock = text.match(/(\d{1,2}):(\d{2})/)
  const ymd = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  const dmy = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  const parts = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null
  if (!parts) return null
  const [y, m, d] = parts.map((x) => parseInt(x, 10))
  return new Date(y, m - 1, d, clock ? parseInt(clock[1], 10) : 0, clock ? parseInt(clock[2], 10) : 0).getTime()
}

/**
  صفوف السجل الأحدث أولًا (_newestFirst): بتاريخها ووقتها، وما تساوى أو بلا
  تاريخ بترتيب الحفظ — [appended]: السجل يُلحق بآخره فيُعكس قبل الترتيب.
*/
export function newestFirst<T>(rows: T[], momentOf: (row: T) => number | null, appended = true): T[] {
  const list = (appended ? [...rows].reverse() : [...rows]).map((row, i) => ({ row, i, at: momentOf(row) }))
  list.sort((a, b) => {
    if (a.at !== null && b.at !== null && a.at !== b.at) return b.at - a.at
    if (a.at !== null && b.at === null) return -1
    if (a.at === null && b.at !== null) return 1
    return a.i - b.i
  })
  return list.map((x) => x.row)
}

/** وقت سطر السجل من مفاتيحه المعروفة. */
export function rowMoment(row: Record<string, unknown>): number | null {
  const date = row['التاريخ'] ?? row['date'] ?? row['at'] ?? row['تاريخ الدفع'] ?? row['من تاريخ'] ?? row['تاريخ التسليم'] ?? ''
  const time = row['وقت التسجيل'] ?? row['الوقت'] ?? row['time'] ?? ''
  return logMoment(date, time)
}
