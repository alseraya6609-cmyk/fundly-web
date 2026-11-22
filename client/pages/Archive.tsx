import { useMemo, useState } from 'react'
import { Archive as ArchiveIcon, Building2, LayoutGrid, UserRound, Users, UsersRound, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { ARCHIVED, assetUnits, hasMine, personArchived, useAssets, usePeopleAll, usePersonalAll, useSharedAll, useStore } from '@/lib/data'
import { date, matches } from '@/lib/format'
import { Chip, Empty, IconBadge, Loading, PageHeader, SearchField, SectionTitle } from '@/components/ui'

/*
  الأرشيف — نفس مصادر ArchiveCenter في التطبيق (lib/data/archive_center.dart):
  الشخصية المؤرشفة، المشتركة المؤرشفة أو المكتملة، الأفراد المؤرشفون،
  ووحدات العقارات المؤرشفة. للعرض فقط؛ إلغاء الأرشفة من التطبيق.
*/

type Row = { key: string; source: string; title: string; subtitle: string }

const SOURCES: { key: string; icon: LucideIcon; color: string }[] = [
  { key: 'الالتزامات الشخصية', icon: UserRound, color: '#0A5A50' },
  { key: 'الالتزامات المشتركة', icon: UsersRound, color: '#2B8CB0' },
  { key: 'الأفراد والجهات', icon: Users, color: '#6B6FC7' },
  { key: 'العقارات والأنشطة', icon: Building2, color: '#D9902A' },
]

export default function Archive() {
  const { t } = useI18n()
  const { profile } = useSession()
  const fnd = profile?.fnd_id ?? ''
  const personal = usePersonalAll()
  const shared = useSharedAll()
  const people = usePeopleAll()
  const assets = useAssets()
  const store = useStore()
  const [source, setSource] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const loading = personal.isLoading || shared.isLoading || people.isLoading || assets.isLoading

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const join = (...parts: unknown[]) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(' · ')
    for (const e of personal.data ?? []) {
      if (e.status !== ARCHIVED) continue
      out.push({ key: `p${e.id}`, source: 'الالتزامات الشخصية', title: e.title, subtitle: join(t(e.entry_type), Number(e.amount) > 0 ? e.amount : '', date(e.due_date)) })
    }
    // المكتمل يبقى في الأرشيف حتى يُعرض في التطبيق ويُعاد (shared_completed_shown_v1).
    const shownRaw = store.data?.['shared_completed_shown_v1']
    const shown = new Set(Array.isArray(shownRaw) ? shownRaw.map(String) : [])
    for (const e of shared.data ?? []) {
      const archived = (e.status ?? '').includes(ARCHIVED) || hasMine(e.details, 'مؤرشف عند', fnd) || (e.status === 'مكتملة' && !shown.has(e.id))
      if (!archived) continue
      out.push({ key: `s${e.id}`, source: 'الالتزامات المشتركة', title: e.title, subtitle: join(t(e.entry_type), Number(e.amount) > 0 ? e.amount : '', date(e.due_date)) })
    }
    ;(people.data ?? []).forEach((p, i) => {
      if (!personArchived(p)) return
      out.push({ key: `h${i}`, source: 'الأفراد والجهات', title: p.fullName, subtitle: join(t(p.roleTitle ?? ''), t(p.categoryName ?? '')) })
    })
    for (const a of assets.data ?? []) {
      if (a.status === ARCHIVED) {
        out.push({ key: `a${a.id}`, source: 'العقارات والأنشطة', title: a.title, subtitle: join(t(a.sub_type), a.location_or_type) })
      }
      assetUnits(a).forEach((u, i) => {
        if (u['status'] !== 'مؤرشفة') return
        out.push({ key: `u${a.id}-${i}`, source: 'العقارات والأنشطة', title: String(u['name'] ?? t('وحدة')), subtitle: `${t('وحدة في')} «${a.title}»` })
      })
    }
    return out
  }, [personal.data, shared.data, people.data, assets.data, store.data, fnd, t])

  const list = rows.filter((r) => (!source || r.source === source) && matches(search, r.title, r.subtitle))

  return (
    <div>
      <PageHeader icon={ArchiveIcon} color="#0A5A50" title="الأرشيف" subtitle="ما أرشفته من كل الأقسام" back={false} />
      <SearchField value={search} onChange={setSearch} placeholder="بحث" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Chip active={!source} label="الكل" icon={LayoutGrid} count={rows.length} onClick={() => setSource(null)} />
        {SOURCES.map((s) => {
          const n = rows.filter((r) => r.source === s.key).length
          if (!n) return null
          return <Chip key={s.key} active={source === s.key} label={s.key} icon={s.icon} count={n} onClick={() => setSource(s.key)} />
        })}
      </div>
      <SectionTitle count={list.length}>{t('العناصر المؤرشفة')}</SectionTitle>
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={ArchiveIcon} text="لا توجد عناصر في الأرشيف" />
      ) : (
        <>
          <div className="grid gap-2 lg:grid-cols-2">
            {list.map((r) => {
              const s = SOURCES.find((x) => x.key === r.source)!
              return (
                <div key={r.key} className="card flex items-center gap-3 p-4">
                  <IconBadge icon={s.icon} color={s.color} size={44} />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="break-words text-[14px] font-extrabold text-title">
                      {r.title}
                    </p>
                    <p className="text-[12px] font-bold" style={{ color: s.color }}>
                      {t(r.source)}
                    </p>
                    {r.subtitle && (
                      <p dir="auto" className="text-[11px] text-muted">
                        {r.subtitle}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">{t('لإلغاء الأرشفة افتح التطبيق.')}</p>
        </>
      )}
    </div>
  )
}
