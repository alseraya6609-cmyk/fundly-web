import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building, LayoutGrid, UserRound, Users } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { useCurrency, usePeople, usePersonal, type Person } from '@/lib/data'
import { MODULE_COLORS } from '@/lib/catalog'
import { date, matches, money } from '@/lib/format'
import { Chevron, Chip, Empty, ErrorBox, IconBadge, InfoRow, Loading, PageHeader, SearchField, SectionTitle, Sheet } from '@/components/ui'
import { EntryCard } from '@/components/EntryCard'

// people_directory_store.dart: الجهة نوعها يبدأ بـ entity_.
const isEntity = (p: Person) => String(p.typeKey ?? '').startsWith('entity_')
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export default function People() {
  const { t } = useI18n()
  const { hidden, profile } = useSession()
  const people = usePeople()
  const personal = usePersonal()
  const currency = useCurrency()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<'all' | 'people' | 'entities'>('all')
  const [search, setSearch] = useState('')

  const all = people.data ?? []
  const list = useMemo(
    () =>
      all
        .map((p, index) => ({ p, index }))
        .filter(
          ({ p }) =>
            (filter === 'all' || (filter === 'entities') === isEntity(p)) &&
            matches(search, p.fullName, p.nickName, p.roleTitle, p.categoryName),
        )
        .sort((a, b) => Number(!!b.p.isPinned) - Number(!!a.p.isPinned)),
    [all, filter, search],
  )
  const openIndex = params.get('open')
  const open = openIndex !== null ? all[Number(openIndex)] : undefined

  if (moduleHidden(hidden, 'people')) {
    return (
      <>
        <PageHeader icon={Users} color={MODULE_COLORS.people} title="الأفراد والجهات" />
        <Empty icon={Users} text="غير متاح حاليًا" />
      </>
    )
  }

  return (
    <div>
      <PageHeader icon={Users} color={MODULE_COLORS.people} title="الأفراد والجهات" subtitle="سجل الأفراد والجهات ومستنداتهم والتزاماتهم" />

      {/* «أنا» داخل الأفراد والجهات كما في التطبيق */}
      {!moduleHidden(hidden, 'personal') && (
        <Link to="/me" className="card mb-4 flex items-center gap-3 p-4 hover:bg-line/70">
          <IconBadge icon={UserRound} color={MODULE_COLORS.personal} size={48} solid />
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-extrabold text-title">{t('أنا')}</p>
            <p className="text-[12px] text-sub">
              {t('صاحب الحساب')}
              {profile?.fnd_id ? (
                <>
                  {' · '}
                  <span className="ltr">{profile.fnd_id}</span>
                </>
              ) : null}
            </p>
          </div>
          <span className="rounded-full bg-brand-soft px-3 py-1 text-[13px] font-extrabold text-brand">{personal.data?.length ?? '…'}</span>
          <Chevron />
        </Link>
      )}

      <SearchField value={search} onChange={setSearch} placeholder="بحث" />

      <SectionTitle>{t('الفئات')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Chip active={filter === 'all'} label="الكل" icon={LayoutGrid} count={all.length} onClick={() => setFilter('all')} />
        <Chip active={filter === 'people'} label="الأفراد" icon={UserRound} count={all.filter((p) => !isEntity(p)).length} onClick={() => setFilter('people')} />
        <Chip active={filter === 'entities'} label="الجهات" icon={Building} count={all.filter(isEntity).length} onClick={() => setFilter('entities')} />
      </div>

      <SectionTitle count={list.length}>{t('الأفراد والجهات')}</SectionTitle>
      {people.isLoading ? (
        <Loading />
      ) : people.error ? (
        <ErrorBox error={people.error} />
      ) : list.length === 0 ? (
        <Empty icon={Users} text={search ? 'لا توجد نتائج مطابقة' : 'لا توجد بيانات حالياً'} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map(({ p, index }) => (
            <EntryCard
              key={index}
              icon={isEntity(p) ? Building : UserRound}
              color={MODULE_COLORS.people}
              title={p.fullName}
              type={t(p.roleTitle || p.categoryName || '')}
              badge={p.badge || undefined}
              amount={num(p.dueToYou) > 0 ? `${t('مستحق لك')}: ${money(p.dueToYou, t(currency))}` : undefined}
              meta={num(p.dueOnYou) > 0 ? `${t('مستحق عليك')}: ${money(p.dueOnYou, t(currency))}` : undefined}
              onClick={() => setParams({ open: String(index) })}
            />
          ))}
        </div>
      )}

      <Sheet open={!!open} onClose={() => setParams({})}>
        {open && (
          <div>
            <p className="text-[12px] font-bold" style={{ color: MODULE_COLORS.people }}>
              {t(isEntity(open) ? 'جهة' : 'فرد')}
              {open.categoryName ? ` · ${t(open.categoryName)}` : ''}
            </p>
            <h2 className="mt-1 text-[20px] font-extrabold text-title">{open.fullName}</h2>
            <div className="mt-4">
              <InfoRow label="اللقب" value={open.nickName} />
              <InfoRow label="الصفة" value={open.roleTitle ? t(open.roleTitle) : ''} />
              <InfoRow label="مستحق لك" value={num(open.dueToYou) > 0 ? money(open.dueToYou, t(currency)) : ''} />
              <InfoRow label="مستحق عليك" value={num(open.dueOnYou) > 0 ? money(open.dueOnYou, t(currency)) : ''} />
              <InfoRow label="مهام مفتوحة" value={num(open.openTasks) > 0 ? String(open.openTasks) : ''} />
              <InfoRow label="المستندات" value={num(open.documentsCount) > 0 ? String(open.documentsCount) : ''} />
              {Object.entries(open.details ?? {})
                .filter(([, v]) => String(v ?? '').trim() !== '')
                .slice(0, 30)
                .map(([k, v]) => (
                  <InfoRow key={k} label={k} value={String(v)} ltr={/^[\d+\s()-]+$/.test(String(v))} />
                ))}
              <InfoRow label="ملاحظة" value={open.statusNote} />
              <InfoRow label="آخر تحديث" value={date(open.lastUpdate)} />
            </div>
            <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
              {t('التعديل والإضافة من التطبيق حاليًا. الموقع للعرض في هذه المرحلة.')}
            </p>
          </div>
        )}
      </Sheet>
    </div>
  )
}
