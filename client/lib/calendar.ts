import { useMemo } from 'react'
import { useAssets, useCalendarRecords, usePersonal, useShared } from './data'
import { needsFollowup, parseDate, useDocuments } from './documents'
import { sharedLabel } from './catalog'

/*
  الكلندر الذكي — نفس مجموعات التطبيق وألوانه (smart_calendar_screen.dart):
  متابعة وتخطيط، سينتهي قريبًا، استحقاقات، والمتأخر بالأحمر.
  البنود: مواعيد «أنا» والالتزامات المشتركة، انتهاء المستندات والعقود،
  وما أضافه المستخدم في الكلندر نفسه.
*/

export const GROUP_FOLLOW = 'متابعة وتخطيط'
export const GROUP_EXPIRY = 'سينتهي قريبًا'
export const GROUP_DUE = 'استحقاقات'

export const COLORS = {
  overdue: '#C4392E',
  high: '#F2A93F',
  follow: '#0E7161',
  expiry: '#CE8422',
  due: '#0A5A50',
}

export const LEGEND: [string, string][] = [
  ['متأخر', COLORS.overdue],
  ['أولوية عالية', COLORS.high],
  [GROUP_EXPIRY, COLORS.expiry],
  [GROUP_FOLLOW, COLORS.follow],
  [GROUP_DUE, COLORS.due],
]

// HomeDashboardService.closedStatuses
const CLOSED = new Set(['مكتملة', 'مكتمل', 'مؤرشف', 'ملغاة', 'ملغى', 'محذوف', 'تمت التسوية', 'مسددة'])
const FOLLOW_KINDS = ['مهمة', 'موعد', 'عادة', 'تذكير', 'ملاحظات']
// لا تُعدّ متأخرة بمرور تاريخها: عمليات تمّت، أو أحداث لا مواعيد سداد.
const NEVER_LATE = new Set(['ملاحظات', 'عادة', 'المصروفات الشخصية', 'مصروف', 'إيراد', 'تحويل مالي', 'عهدة مالية', 'أدوية', 'مناسبة', 'هدية'])

export type CalItem = {
  key: string
  title: string
  module: string
  kind: string
  group: string
  date: Date
  time?: string
  status: string
  priority?: string
  to?: string
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

function startOfToday() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

export const isDone = (item: CalItem) => CLOSED.has(item.status.trim())

export function isOverdue(item: CalItem): boolean {
  if (isDone(item) || NEVER_LATE.has(item.kind)) return false
  return item.date < startOfToday()
}

export function colorOf(item: CalItem): string {
  if (isDone(item)) return '#8C9A97'
  if (isOverdue(item)) return COLORS.overdue
  if (item.priority === 'عالية') return COLORS.high
  if (item.group === GROUP_EXPIRY) return COLORS.expiry
  if (item.group === GROUP_FOLLOW) return COLORS.follow
  return COLORS.due
}

function groupOfKind(kind: string): string {
  if (kind === 'مستند' || kind === 'ضمانات' || kind === 'انتهاء') return GROUP_EXPIRY
  if (FOLLOW_KINDS.includes(kind)) return GROUP_FOLLOW
  return GROUP_DUE
}

export function useCalendar() {
  const personal = usePersonal()
  const shared = useShared()
  const assets = useAssets()
  const records = useCalendarRecords()
  const { docs, loading: docsLoading } = useDocuments()

  const loading = personal.isLoading || shared.isLoading || assets.isLoading || records.isLoading || docsLoading

  const items = useMemo<CalItem[]>(() => {
    const out: CalItem[] = []
    for (const e of personal.data ?? []) {
      const d = parseDate(e.due_date)
      if (!d) continue
      out.push({
        key: `p${e.id}`,
        title: e.title,
        module: 'أنا',
        kind: e.entry_type,
        group: groupOfKind(e.entry_type),
        date: d,
        status: e.status ?? '',
        priority: String(e.details?.['الأولوية'] ?? ''),
        time: String(e.details?.['الوقت'] ?? e.details?.['وقت الموعد'] ?? '') || undefined,
        to: `/me?open=${e.id}`,
      })
    }
    for (const e of shared.data ?? []) {
      const d = parseDate(e.due_date)
      if (!d) continue
      out.push({
        key: `s${e.id}`,
        title: e.title,
        module: 'الالتزامات المشتركة',
        kind: sharedLabel(e.entry_type),
        group: GROUP_DUE,
        date: d,
        status: e.status ?? '',
        to: `/shared?open=${e.id}`,
      })
    }
    for (const a of assets.data ?? []) {
      const d = parseDate(a.end_date)
      if (!d) continue
      out.push({
        key: `a${a.id}`,
        title: a.title,
        module: 'العقارات والأنشطة والمركبات',
        kind: 'انتهاء',
        group: GROUP_EXPIRY,
        date: d,
        status: a.status ?? '',
        to: `/assets?open=${a.id}`,
      })
    }
    // مستندات بتاريخ انتهاء من خارج «أنا» (مستندات «أنا» سجلات فيه أصلًا).
    for (const doc of docs) {
      if (!doc.expiry || doc.module === 'الالتزامات الشخصية') continue
      out.push({
        key: `d${doc.key}`,
        title: `${doc.title}${doc.owner ? ` — ${doc.owner}` : ''}`,
        module: doc.module,
        kind: 'مستند',
        group: GROUP_EXPIRY,
        date: doc.expiry,
        status: needsFollowup(doc) ? '' : 'ساري',
        to: '/documents',
      })
    }
    for (const r of records.data ?? []) {
      const d = parseDate(r.date)
      if (!d) continue
      out.push({
        key: `c${r.id}`,
        title: r.title,
        module: 'الكلندر الذكي',
        kind: FOLLOW_KINDS.includes(r.type) ? r.type : 'مهمة',
        group: GROUP_FOLLOW,
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        time: r.time,
        status: r.status ?? '',
        priority: r.priority,
      })
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [personal.data, shared.data, assets.data, records.data, docs])

  return { loading, items }
}
