import { TRANSACTION_TYPES, CLOSED_STATUSES, startOfToday, useMetrics, type CalItem } from './metrics'

/*
  الكلندر الذكي — نفس smart_calendar_screen.dart: البنود هي calendarItems من
  HomeDashboardService (metrics.ts)، وتصنيفها وألوانها ومنطق «متأخر» نفسه.
*/

export type { CalItem }

export const GROUP_FOLLOW = 'متابعة وتخطيط'
export const GROUP_EXPIRY = 'سينتهي قريبًا'
export const GROUP_DUE = 'استحقاقات'
const GROUP_APPROVAL = 'اعتماد صرف'
const GROUP_BUDGET = 'تنبيه الميزانية'

export const COLORS = {
  overdue: '#C4392E',
  budget: '#A82F26',
  approval: '#34A894',
  high: '#F2A93F',
  expiry: '#CE8422',
  follow: '#0E7161',
  due: '#0A5A50',
}

export const LEGEND: [string, string][] = [
  ['متأخر', COLORS.overdue],
  [GROUP_BUDGET, COLORS.budget],
  [GROUP_APPROVAL, COLORS.approval],
  ['أولوية عالية', COLORS.high],
  [GROUP_EXPIRY, COLORS.expiry],
  [GROUP_FOLLOW, COLORS.follow],
  [GROUP_DUE, COLORS.due],
]

const FOLLOW_KINDS = ['مهمة', 'موعد', 'عادة', 'تذكير', 'ملاحظات']

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export const isDone = (item: CalItem) => CLOSED_STATUSES.has(item.status.trim())

export const kindOf = (item: CalItem) => item.entryType.trim() || item.type.trim()

export function groupOf(item: CalItem): string {
  const kind = kindOf(item)
  if (kind === GROUP_APPROVAL) return GROUP_APPROVAL
  if (kind === GROUP_BUDGET) return GROUP_BUDGET
  if (item.isExpiry || kind === 'مستند' || kind === 'ضمانات' || kind === 'انتهاء') return GROUP_EXPIRY
  if (item.isUserCreated || FOLLOW_KINDS.includes(kind)) return GROUP_FOLLOW
  return GROUP_DUE
}

export function isOverdue(item: CalItem): boolean {
  if (isDone(item)) return false
  const kind = kindOf(item)
  if (kind === 'ملاحظات' || kind === 'عادة' || item.repeat) return false
  if (TRANSACTION_TYPES.has(kind)) return false
  if (['عهدة مالية', 'أدوية', 'مناسبة', 'هدية'].includes(kind)) return false
  const group = groupOf(item)
  if (group === GROUP_APPROVAL || group === GROUP_BUDGET) return false
  return item.date < startOfToday()
}

export function colorOf(item: CalItem): string {
  if (isDone(item)) return '#8C9A97'
  const group = groupOf(item)
  if (group === GROUP_APPROVAL) return COLORS.approval
  if (group === GROUP_BUDGET) return COLORS.budget
  if (isOverdue(item)) return COLORS.overdue
  if (item.priority === 'عالية') return COLORS.high
  if (group === GROUP_EXPIRY) return COLORS.expiry
  if (group === GROUP_FOLLOW) return COLORS.follow
  return COLORS.due
}

export function useCalendar() {
  const { loading, metrics } = useMetrics()
  return { loading, items: metrics.calendarItems }
}
