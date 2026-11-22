import { Link } from 'react-router-dom'
import { Building2, HandCoins, LayoutDashboard, TrendingDown, TrendingUp, UserRound, Users, UsersRound, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { currencyOf, useAssets, useCurrency, usePeople, usePersonal, usePersonalAll, useShared, type Entry } from '@/lib/data'
import { DEBT_TYPES, EXPENSE_TYPES, INCOME_TYPES, MODULE_COLORS } from '@/lib/catalog'
import { money } from '@/lib/format'
import { Chevron, IconBadge, Loading, PageHeader, SectionTitle } from '@/components/ui'

/** مجموع المبالغ لكل عملة على حدة — لا تُجمع عملتان مختلفتان. */
// كما في HomeDashboardService: الملغى بلا مبلغ، والدين المغلق لا يُحسب.
const CLOSED = new Set(['مكتملة', 'مكتمل', 'مؤرشف', 'ملغاة', 'ملغى', 'محذوف', 'تمت التسوية', 'مسددة'])

function totals(entries: Entry[], types: string[], fallback: string, openOnly = false): [string, number][] {
  const map = new Map<string, number>()
  for (const e of entries) {
    if (!types.includes(e.entry_type)) continue
    if (e.status === 'ملغاة' || e.status === 'ملغى') continue
    if (openOnly && CLOSED.has(e.status)) continue
    const c = currencyOf(e.details, fallback)
    map.set(c, (map.get(c) ?? 0) + (Number(e.amount) || 0))
  }
  return [...map.entries()].filter(([, v]) => v > 0)
}

export default function Summary() {
  const { t } = useI18n()
  const { hidden } = useSession()
  const personal = usePersonal()
  const shared = useShared()
  const assets = useAssets()
  const people = usePeople()
  const currency = useCurrency()

  const loading = personal.isLoading || shared.isLoading || assets.isLoading || people.isLoading
  // الإجماليات من كل السجلات كالتطبيق (ومنها المؤرشف)، والأعداد بلا المؤرشف.
  const all = usePersonalAll()
  const entries = all.data ?? []

  const money_cards: { title: string; icon: LucideIcon; color: string; rows: [string, number][] }[] = [
    { title: 'إجمالي الدخل', icon: TrendingUp, color: '#0A5A50', rows: totals(entries, INCOME_TYPES, currency) },
    { title: 'إجمالي المصروفات', icon: TrendingDown, color: '#C4392E', rows: totals(entries, EXPENSE_TYPES, currency) },
    { title: 'إجمالي الديون', icon: HandCoins, color: '#A6691A', rows: totals(entries, DEBT_TYPES, currency, true) },
  ]

  const modules = [
    { id: 'personal', title: 'أنا', icon: UserRound, color: MODULE_COLORS.personal, to: '/me', n: personal.data?.length },
    { id: 'shared', title: 'الالتزامات المشتركة', icon: UsersRound, color: MODULE_COLORS.shared, to: '/shared', n: shared.data?.length },
    { id: 'people', title: 'الأفراد والجهات', icon: Users, color: MODULE_COLORS.people, to: '/people', n: people.data?.length },
    { id: 'assets', title: 'إجمالي الأصول', icon: Building2, color: MODULE_COLORS.assets, to: '/assets', n: assets.data?.length },
  ].filter((m) => !moduleHidden(hidden, m.id))

  return (
    <div>
      <PageHeader icon={LayoutDashboard} color="#0A5A50" title="الملخص الشامل" subtitle="عرض جميع بياناتك هنا" back={false} />
      {loading ? (
        <Loading />
      ) : (
        <>
          {!moduleHidden(hidden, 'personal') && (
            <>
              <SectionTitle>{t('الالتزامات الشخصية')}</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-3">
                {money_cards.map((card) => (
                  <div key={card.title} className="card p-4">
                    <div className="flex items-center gap-2">
                      <IconBadge icon={card.icon} color={card.color} size={38} />
                      <p className="text-[14px] font-extrabold text-title">{t(card.title)}</p>
                    </div>
                    <div className="mt-3 flex flex-col gap-1">
                      {card.rows.length === 0 ? (
                        <p className="text-[18px] font-extrabold text-muted">{money(0)}</p>
                      ) : (
                        card.rows.map(([c, v]) => (
                          <p key={c} className="text-[18px] font-extrabold" style={{ color: card.color }}>
                            {money(v, t(c))}
                          </p>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionTitle>{t('معلومات الوحدات')}</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {modules.map((m) => (
              <Link key={m.id} to={m.to} className="card flex items-center gap-3 p-4 hover:bg-line/70">
                <IconBadge icon={m.icon} color={m.color} size={44} />
                <p className="min-w-0 flex-1 text-[15px] font-extrabold text-title">{t(m.title)}</p>
                <span className="text-[20px] font-extrabold" style={{ color: m.color }}>
                  {m.n ?? 0}
                </span>
                <Chevron />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
