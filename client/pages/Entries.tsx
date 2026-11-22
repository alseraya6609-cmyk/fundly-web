import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClipboardList, LayoutGrid, UserRound, UsersRound, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { currencyOf, useCurrency, usePersonal, useShared, type Entry } from '@/lib/data'
import { MODULE_COLORS, PERSONAL_GROUPS, personalGroup, SHARED_GROUPS, sharedLabel } from '@/lib/catalog'
import { date, matches, money } from '@/lib/format'
import { Chip, Empty, ErrorBox, InfoRow, Loading, PageHeader, SearchField, SectionTitle, Sheet } from '@/components/ui'
import { EntryCard } from '@/components/EntryCard'

type Group = { key: string; label: string; icon: LucideIcon }

/** صفحة «أنا» — الالتزامات الشخصية (personal_entries). */
export function Personal() {
  const q = usePersonal()
  return (
    <EntriesPage
      page="personal"
      icon={UserRound}
      color={MODULE_COLORS.personal}
      title="أنا — صاحب الحساب"
      subtitle="صفحة الالتزامات الشخصية"
      query={q}
      groups={PERSONAL_GROUPS}
      groupOf={(e) => personalGroup(e.entry_type, e.category)}
      typeLabel={(e) => e.entry_type}
      adminTitle={(g) => g.label}
    />
  )
}

/** الالتزامات المشتركة (shared_entries). */
export function Shared() {
  const q = useShared()
  return (
    <EntriesPage
      page="shared"
      icon={UsersRound}
      color={MODULE_COLORS.shared}
      title="الالتزامات المشتركة"
      subtitle="إدارة ومتابعة الالتزامات المالية مع الآخرين"
      query={q}
      groups={SHARED_GROUPS}
      groupOf={(e) => e.entry_type}
      typeLabel={(e) => sharedLabel(e.entry_type)}
      adminTitle={(g) => g.key}
    />
  )
}

function EntriesPage({
  page,
  icon,
  color,
  title,
  subtitle,
  query,
  groups,
  groupOf,
  typeLabel,
  adminTitle,
}: {
  page: string
  icon: LucideIcon
  color: string
  title: string
  subtitle: string
  query: ReturnType<typeof usePersonal>
  groups: Group[]
  groupOf: (e: Entry) => string
  typeLabel: (e: Entry) => string
  /** اسم الفئة كما في لوحة التحكم (VISIBILITY_PAGES). */
  adminTitle: (g: Group) => string
}) {
  const { t } = useI18n()
  const { hidden } = useSession()
  const currency = useCurrency()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  // الفئات التي أخفتها الإدارة من لوحة التحكم لا تظهر (category:page:الفئة).
  const visibleGroups = groups.filter((g) => !hidden.has(`category:${page}:${adminTitle(g)}`))
  const all = (query.data ?? []).filter((e) => visibleGroups.some((g) => g.key === groupOf(e)) || !groups.some((g) => g.key === groupOf(e)))
  const list = useMemo(
    () =>
      all.filter(
        (e) => (filter === 'all' || groupOf(e) === filter) && matches(search, e.title, e.entry_type, typeLabel(e)),
      ),
    [all, filter, search, groupOf, typeLabel],
  )
  const open = all.find((e) => e.id === params.get('open'))

  if (moduleHidden(hidden, page)) {
    return (
      <>
        <PageHeader icon={icon} color={color} title={title} subtitle={subtitle} />
        <Empty icon={icon} text="غير متاح حاليًا" />
      </>
    )
  }

  return (
    <div>
      <PageHeader icon={icon} color={color} title={title} subtitle={subtitle} />
      <SearchField value={search} onChange={setSearch} placeholder="بحث" />

      <SectionTitle>{t('الفئات')}</SectionTitle>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip active={filter === 'all'} label="الكل" icon={LayoutGrid} count={all.length} onClick={() => setFilter('all')} />
        {visibleGroups.map((g) => {
          const n = all.filter((e) => groupOf(e) === g.key).length
          if (!n) return null
          return <Chip key={g.key} active={filter === g.key} label={g.label} icon={g.icon} count={n} onClick={() => setFilter(g.key)} />
        })}
      </div>

      <SectionTitle count={list.length}>{t('جميع الالتزامات')}</SectionTitle>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : list.length === 0 ? (
        <Empty icon={ClipboardList} text={search ? 'لا توجد نتائج مطابقة' : 'لا توجد بيانات حالياً'} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map((e) => {
            const group = groups.find((g) => g.key === groupOf(e))
            return (
              <EntryCard
                key={e.id}
                icon={group?.icon ?? ClipboardList}
                color={color}
                title={e.title}
                type={t(typeLabel(e))}
                amount={Number(e.amount) > 0 ? `${t('المبلغ')}: ${money(e.amount, t(currencyOf(e.details, currency)))}` : undefined}
                meta={e.due_date ? `${t('التاريخ')}: ${date(e.due_date)}` : undefined}
                onClick={() => setParams({ open: e.id })}
              />
            )
          })}
        </div>
      )}

      <Sheet open={!!open} onClose={() => setParams({})}>
        {open && <EntryDetails entry={open} color={color} typeLabel={typeLabel(open)} currency={currency} />}
      </Sheet>
    </div>
  )
}

// قيم لا تُعرض في الموقع حتى لو حفظها التطبيق (كلمات السر والرموز).
const SENSITIVE = /(كلمة|كلمات|سر|رمز|pin|pass|password|secret|otp|cvv)/i

function EntryDetails({ entry, color, typeLabel, currency }: { entry: Entry; color: string; typeLabel: string; currency: string }) {
  const { t } = useI18n()
  const extras = Object.entries(entry.details ?? {})
    .filter(([key, value]) => /[؀-ۿ]/.test(key) && ['string', 'number'].includes(typeof value) && String(value).trim() !== '')
    .slice(0, 30)
  return (
    <div>
      <p className="text-[12px] font-bold" style={{ color }}>
        {t(typeLabel)}
      </p>
      <h2 className="mt-1 text-[20px] font-extrabold text-title">{entry.title}</h2>
      <div className="mt-4">
        {Number(entry.amount) > 0 && <InfoRow label="المبلغ" value={money(entry.amount, t(currencyOf(entry.details, currency)))} />}
        <InfoRow label="التاريخ" value={date(entry.due_date)} />
        <InfoRow label="الحالة" value={t(entry.status)} />
        {extras.map(([key, value]) => (
          <InfoRow key={key} label={key} value={SENSITIVE.test(key) ? t('مخفية في الموقع') : String(value)} />
        ))}
        <InfoRow label="تاريخ الإضافة" value={date(entry.created_at)} />
        <InfoRow label="آخر تحديث" value={date(entry.updated_at)} />
      </div>
      <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
        {t('التعديل والإضافة من التطبيق حاليًا. الموقع للعرض في هذه المرحلة.')}
      </p>
    </div>
  )
}
