import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, CalendarDays, ClipboardList, FileText, Inbox, LayoutDashboard, UsersRound, UserRound, Wallet, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { useAssets, useInbox, usePeople, usePersonal, useShared, useStore } from '@/lib/data'
import { ASSET_GROUPS, MODULE_COLORS, assetGroup, personalGroup, PERSONAL_GROUPS, sharedLabel, SHARED_GROUPS } from '@/lib/catalog'
import { matches } from '@/lib/format'
import { useMetrics } from '@/lib/metrics'
import { Chevron, IconBadge, SearchField, SectionTitle } from '@/components/ui'

// home_layout_store.dart: الترتيب الافتراضي ومفاتيح الحفظ.
const DEFAULT_ORDER = ['people', 'shared', 'assets'] as const
type ModuleId = (typeof DEFAULT_ORDER)[number]

export default function Home() {
  const { t } = useI18n()
  const { profile, hidden } = useSession()
  const store = useStore()
  const personal = usePersonal()
  const shared = useShared()
  const assets = useAssets()
  const people = usePeople()
  const inbox = useInbox()
  const [query, setQuery] = useState('')

  const name =
    String(store.data?.['settings_profile_name'] ?? '').trim() || profile?.display_name?.trim() || ''

  // ترتيب الأقسام وإخفاؤها كما اختارها المستخدم في التطبيق، ثم ما أخفته الإدارة.
  const order = useMemo<ModuleId[]>(() => {
    const saved = store.data?.['home_layout_order_v2']
    const savedHidden = store.data?.['home_layout_hidden_v1']
    const list = Array.isArray(saved) ? (saved as string[]) : []
    const off = new Set(Array.isArray(savedHidden) ? (savedHidden as string[]) : [])
    const result: ModuleId[] = []
    for (const id of [...list, ...DEFAULT_ORDER]) {
      if ((DEFAULT_ORDER as readonly string[]).includes(id) && !result.includes(id as ModuleId)) result.push(id as ModuleId)
    }
    return result.filter((id) => !off.has(id) && !moduleHidden(hidden, id))
  }, [store.data, hidden])

  const modules: Record<ModuleId, { title: string; icon: LucideIcon; color: string; to: string; count?: number }> = {
    people: {
      title: 'الأفراد والجهات',
      icon: UserRound,
      color: MODULE_COLORS.people,
      to: '/people',
      count: people.data ? people.data.length + (personal.data?.length ?? 0) : undefined,
    },
    shared: {
      title: 'الالتزامات المشتركة',
      icon: UsersRound,
      color: MODULE_COLORS.shared,
      to: '/shared',
      count: shared.data?.length,
    },
    assets: {
      title: 'العقارات والأنشطة والمركبات',
      icon: Building2,
      color: MODULE_COLORS.assets,
      to: '/assets',
      count: assets.data?.length,
    },
  }

  const requests = inbox.data?.length ?? 0

  // «مالية تحتاج متابعة» و«مستندات تحتاج متابعة» بحساب التطبيق نفسه (metrics.ts).
  const { metrics, loading: metricsLoading } = useMetrics()
  const follow: Record<ModuleId, [number, number]> = {
    people: [metrics.peopleMoney, metrics.peopleDocs],
    shared: [metrics.sharedMoney, metrics.sharedDocs],
    assets: [metrics.assetsMoney, metrics.assetsDocs],
  }

  return (
    <div>
      {/* الترويسة الخضراء كما في رئيسية التطبيق */}
      <section className="relative -mx-4 -mt-4 overflow-hidden rounded-b-[28px] bg-brand px-5 pb-6 pt-6 sm:-mx-6 sm:px-8 lg:mx-0 lg:mt-0 lg:rounded-card">
        <div className="absolute -end-16 -top-16 size-56 rounded-full bg-white/5" />
        <div className="absolute -bottom-20 start-10 size-44 rounded-full bg-white/5" />
        <div className="relative flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-relaxed text-white/90">
              {t('أموالك، أصولك، التزاماتك وعلاقاتك في لوحة واحدة')}
            </p>
            {name && <p className="mt-2 text-[20px] font-extrabold text-white">{name}</p>}
            {profile?.fnd_id && (
              <p className="mt-0.5 text-[12px] font-bold text-gold-light">
                <span className="ltr">{profile.fnd_id}</span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Link to="/calendar" aria-label={t('الكلندر الذكي')} className="grid size-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
              <CalendarDays className="size-5" />
            </Link>
            <Link to="/more" aria-label={t('المزيد')} className="grid size-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
              <UserRound className="size-5" />
            </Link>
          </div>
        </div>
        <div className="relative mt-5">
          <SearchField value={query} onChange={setQuery} placeholder="أبحث عن أي شيء" />
        </div>
      </section>

      {query.trim() ? (
        <SearchResults query={query} />
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <HomeCard
              to="/summary"
              icon={LayoutDashboard}
              title="ملخص شامل"
              subtitle="عرض البيانات"
            />
            <HomeCard
              to="/requests"
              icon={Inbox}
              title="الطلبات"
              subtitle={requests ? `${t('طلبات جديدة')}: ${requests}` : 'لا توجد طلبات الآن'}
              tone={requests ? 'gold' : 'brand'}
            />
          </div>

          <SectionTitle>{t('إدارة أمورك باحترافية')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {/* قبل وصول إعدادات الحساب لا تُرسم الأقسام الافتراضية، وإلا ظهر المخفي منها ثم اختفى. */}
            {store.isPending &&
              DEFAULT_ORDER.map((id) => <div key={id} aria-hidden className="card h-[178px] animate-pulse bg-line/60" />)}
            {!store.isPending && order.map((id) => {
              const m = modules[id]
              return (
                <Link key={id} to={m.to} className="card flex flex-col gap-3 p-4 transition-colors hover:bg-line/70">
                  <div className="flex items-start justify-between gap-2">
                    <IconBadge icon={m.icon} color={m.color} size={46} solid />
                    <Chevron className="mt-1" />
                  </div>
                  <p className="-mt-1 text-[15px] font-extrabold leading-snug text-title">{t(m.title)}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['مالية تحتاج متابعة', Wallet, '#A6691A', follow[id][0]],
                        ['مستندات تحتاج متابعة', FileText, '#0A5A50', follow[id][1]],
                      ] as const
                    ).map(([label, Icon, color, n]) => (
                      <div key={label} className="card-inner flex flex-col gap-1 px-2.5 py-2">
                        <span className="text-[11px] leading-snug text-sub">{t(label)}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[17px] font-extrabold text-title">{metricsLoading ? '…' : n}</span>
                          <Icon className="size-4" style={{ color }} />
                        </span>
                      </div>
                    ))}
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function HomeCard({
  to,
  icon,
  title,
  subtitle,
  tone = 'brand',
}: {
  to: string
  icon: LucideIcon
  title: string
  subtitle: string
  tone?: 'brand' | 'gold'
}) {
  const { t } = useI18n()
  return (
    <Link to={to} className="card flex items-center gap-3 p-4 transition-colors hover:bg-line/70">
      <IconBadge icon={icon} color={tone === 'gold' ? '#CE8422' : '#0A5A50'} size={46} />
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-extrabold text-title">{t(title)}</p>
        <p className="text-[12px] text-sub">{t(subtitle)}</p>
      </div>
      <Chevron />
    </Link>
  )
}

/** البحث في كل الأقسام — نفس فكرة «أبحث عن أي شيء» في التطبيق. */
function SearchResults({ query }: { query: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const personal = usePersonal()
  const shared = useShared()
  const assets = useAssets()
  const people = usePeople()

  const results = useMemo(() => {
    const out: { key: string; icon: LucideIcon; color: string; title: string; sub: string; to: string }[] = []
    for (const e of personal.data ?? []) {
      if (!matches(query, e.title, e.entry_type)) continue
      const group = PERSONAL_GROUPS.find((g) => g.key === personalGroup(e.entry_type, e.category))
      out.push({ key: `p${e.id}`, icon: group?.icon ?? ClipboardList, color: MODULE_COLORS.personal, title: e.title, sub: `${t('أنا')} · ${t(e.entry_type)}`, to: `/me?open=${e.id}` })
    }
    for (const e of shared.data ?? []) {
      if (!matches(query, e.title, e.entry_type)) continue
      const group = SHARED_GROUPS.find((g) => g.key === e.entry_type)
      out.push({ key: `s${e.id}`, icon: group?.icon ?? UsersRound, color: MODULE_COLORS.shared, title: e.title, sub: `${t('الالتزامات المشتركة')} · ${t(sharedLabel(e.entry_type))}`, to: `/shared?open=${e.id}` })
    }
    for (const a of assets.data ?? []) {
      if (!matches(query, a.title, a.sub_type, a.location_or_type, a.tenant, a.owner)) continue
      const group = ASSET_GROUPS.find((g) => g.key === assetGroup(a.category))
      out.push({ key: `a${a.id}`, icon: group?.icon ?? Building2, color: MODULE_COLORS.assets, title: a.title, sub: `${t(group?.label ?? '')} · ${t(a.sub_type)}`, to: `/assets?open=${a.id}` })
    }
    ;(people.data ?? []).forEach((p, i) => {
      if (!matches(query, p.fullName, p.nickName, p.roleTitle, p.categoryName)) return
      out.push({ key: `h${i}`, icon: UserRound, color: MODULE_COLORS.people, title: p.fullName, sub: `${t('الأفراد والجهات')} · ${t(p.categoryName || p.roleTitle || '')}`, to: `/people?open=${i}` })
    })
    return out
  }, [query, personal.data, shared.data, assets.data, people.data, t])

  return (
    <div className="mt-5">
      <SectionTitle count={results.length}>{t('نتائج البحث')}</SectionTitle>
      {results.length === 0 ? (
        <p className="rounded-card bg-surface px-5 py-10 text-center text-[14px] text-sub">{t('لا توجد نتائج مطابقة')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {results.slice(0, 80).map((r) => (
            <button key={r.key} type="button" onClick={() => navigate(r.to)} className="card flex items-center gap-3 p-3 text-start hover:bg-line/70">
              <IconBadge icon={r.icon} color={r.color} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-extrabold text-title">{r.title}</p>
                <p className="truncate text-[12px] text-sub">{r.sub}</p>
              </div>
              <Chevron />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
