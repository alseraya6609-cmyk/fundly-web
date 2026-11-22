import { NavLink, Outlet } from 'react-router-dom'
import { Bell, CalendarDays, Ellipsis, FileText, House, LayoutDashboard, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { useInbox } from '@/lib/data'

type Item = { to: string; label: string; icon: LucideIcon; badge?: number }

/**
 * الهيكل العام: شريط سفلي على الجوال كما في التطبيق، وشريط جانبي على
 * الشاشات الكبيرة. المحتوى في عمود بعرض مريح للقراءة.
 */
export function AppShell() {
  const { t } = useI18n()
  const { account } = useSession()
  const inbox = useInbox()
  const items: (Item & { desktopOnly?: boolean })[] = [
    { to: '/', label: 'الرئيسية', icon: House },
    { to: '/summary', label: 'الملخص الشامل', icon: LayoutDashboard, desktopOnly: true },
    { to: '/documents', label: 'المستندات', icon: FileText },
    { to: '/calendar', label: 'الكلندر الذكي', icon: CalendarDays },
    { to: '/requests', label: 'الطلبات', icon: Bell, badge: inbox.data?.length ?? 0 },
    { to: '/more', label: 'المزيد', icon: Ellipsis },
  ]
  const mobile = items.filter((item) => !item.desktopOnly)

  return (
    <div className="min-h-screen bg-page lg:flex">
      {/* الشريط الجانبي — الشاشات الكبيرة */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-line bg-white px-4 py-6 lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <img src="/img/logo.png" alt="" className="h-10 w-auto" />
          <span className="text-[22px] font-extrabold text-brand">{t('فوندلي')}</span>
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex h-12 items-center gap-3 rounded-inner px-3 text-[14px] font-bold transition-colors',
                  isActive ? 'bg-brand-soft text-brand' : 'text-sub hover:bg-surface',
                )
              }
            >
              <item.icon className="size-5" />
              <span className="flex-1">{t(item.label)}</span>
              {!!item.badge && (
                <span className="grid min-w-6 place-items-center rounded-full bg-gold px-1.5 text-[11px] text-white">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {account?.frozen && (
          <div className="bg-gold-soft px-4 py-2 text-center text-[13px] font-bold text-gold-dark">
            {t('حسابك مجمّد')}
            {account.reason ? ` — ${account.reason}` : ''}
          </div>
        )}
        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 sm:px-6 lg:pb-12">
          <Outlet />
        </main>
      </div>

      {/* الشريط السفلي — الجوال، بنفس شكل التطبيق */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {mobile.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="flex flex-col items-center gap-1 py-2">
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'relative grid h-8 w-12 place-items-center rounded-full transition-colors',
                      isActive ? 'bg-brand-soft text-brand-dark' : 'text-muted',
                    )}
                  >
                    <item.icon className="size-5" strokeWidth={isActive ? 2.4 : 1.8} />
                    {!!item.badge && (
                      <span className="absolute -top-1 end-2 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-white">
                        {item.badge}
                      </span>
                    )}
                  </span>
                  <span className={cn('px-0.5 text-center text-[10px] leading-tight', isActive ? 'font-extrabold text-brand-dark' : 'text-muted')}>
                    {t(item.label)}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
