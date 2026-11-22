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
