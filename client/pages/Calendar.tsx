import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { COLORS, GROUP_DUE, GROUP_EXPIRY, GROUP_FOLLOW, LEGEND, colorOf, groupOf, isOverdue, kindOf, sameDay, useCalendar, type CalItem } from '@/lib/calendar'
import { cn, date } from '@/lib/format'
import { Chevron, Chip, Empty, Loading, PageHeader, SectionTitle } from '@/components/ui'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
// الأسبوع يبدأ بالأحد كما في التطبيق.
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function Calendar() {
  const { t, dir } = useI18n()
  const navigate = useNavigate()
  const { loading, items } = useCalendar()
  const today = new Date()
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState<Date | null>(new Date(today.getFullYear(), today.getMonth(), today.getDate()))
  const [group, setGroup] = useState<string | null>(null)

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [month])

  const inMonth = items.filter((i) => i.date.getMonth() === month.getMonth() && i.date.getFullYear() === month.getFullYear())
  const filtered = (list: CalItem[]) => (group ? list.filter((i) => (group === 'متأخر' ? isOverdue(i) : groupOf(i) === group)) : list)
  const dayItems = filtered(selected ? items.filter((i) => sameDay(i.date, selected)) : inMonth)

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight

  return (
    <div>
      <PageHeader icon={CalendarDays} color="#0A5A50" title="الكلندر الذكي" subtitle="كل الاستحقاقات والمواعيد في تقويم واحد" back={false} />
      {loading ? (
        <Loading />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <button type="button" onClick={() => shift(-1)} className="grid size-9 place-items-center rounded-full hover:bg-line" aria-label={t('الشهر السابق')}>
                  <Prev className="size-5 text-body" />
                </button>
                <p className="text-[17px] font-extrabold text-title">
                  {t(MONTHS[month.getMonth()])} {month.getFullYear()}
                </p>
                <button type="button" onClick={() => shift(1)} className="grid size-9 place-items-center rounded-full hover:bg-line" aria-label={t('الشهر التالي')}>
                  <Next className="size-5 text-body" />
                </button>
              </div>
              <div className="grid grid-cols-7 text-center text-[11px] font-bold text-sub">
                {DAYS.map((d) => (
                  <span key={d} className="truncate py-1">
                    {t(d)}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day) => {
                  const own = day.getMonth() === month.getMonth()
                  const its = filtered(items.filter((i) => sameDay(i.date, day)))
                  const isSel = selected && sameDay(day, selected)
                  const isToday = sameDay(day, today)
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => setSelected(isSel ? null : day)}
                      className={cn(
                        'flex h-12 flex-col items-center justify-center rounded-inner text-[13px] font-bold transition-colors',
                        !own && 'opacity-35',
                        isSel ? 'bg-brand text-white' : its.length ? 'bg-brand-tint text-title' : 'text-title hover:bg-line',
                        isToday && !isSel && 'ring-2 ring-gold',
                      )}
                    >
                      {day.getDate()}
                      <span className="mt-0.5 flex h-1.5 gap-0.5">
                        {its.slice(0, 3).map((i) => (
                          <span key={i.key} className="size-1.5 rounded-full" style={{ background: isSel ? '#fff' : colorOf(i) }} />
                        ))}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-4 mb-2 text-[13px] font-extrabold text-title">{t('دليل الألوان')}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {LEGEND.map(([label, color]) => (
                  <span key={label} className="flex items-center gap-1.5 text-[11px] text-sub">
                    <span className="size-2 rounded-full" style={{ background: color }} />
                    {t(label)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap gap-2">
              <Chip active={!group} label="الكل" count={inMonth.length} onClick={() => setGroup(null)} />
              {[GROUP_FOLLOW, GROUP_EXPIRY, GROUP_DUE].map((g) => (
                <Chip key={g} active={group === g} label={g} count={inMonth.filter((i) => groupOf(i) === g).length} onClick={() => setGroup(g)} />
              ))}
              <Chip active={group === 'متأخر'} label="متأخر" count={items.filter(isOverdue).length} onClick={() => setGroup('متأخر')} />
            </div>
            <SectionTitle count={dayItems.length}>
              {selected ? date(selected) : `${t(MONTHS[month.getMonth()])} ${month.getFullYear()}`}
            </SectionTitle>
            {dayItems.length === 0 ? (
              <Empty icon={CalendarDays} text="لا توجد عناصر في هذا اليوم" />
            ) : (
              <div className="flex flex-col gap-2">
                {dayItems.map((i, n) => (
                  <button
                    key={`${i.key}-${n}`}
                    type="button"
                    disabled={!i.to}
                    onClick={() => i.to && navigate(i.to)}
                    className="card flex items-center gap-3 p-3 text-start enabled:hover:bg-line/70"
                  >
                    <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(i) }} />
                    <div className="min-w-0 flex-1">
                      <p dir="auto" className="break-words text-[14px] font-extrabold text-title">
                        {i.title}
                      </p>
                      <p className="text-[11px] text-sub">
                        {t(kindOf(i) || 'موعد')} · {t(i.module)}
                        {!selected && ` · ${date(i.date)}`}
                        {i.time ? ` · ${i.time}` : ''}
                        {isOverdue(i) && <span className="font-bold" style={{ color: COLORS.overdue }}> · {t('متأخر')}</span>}
                      </p>
                    </div>
                    {i.to && <Chevron />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
