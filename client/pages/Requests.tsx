import { Inbox, Megaphone, UserRound } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { inboxText, useInbox } from '@/lib/data'
import { date } from '@/lib/format'
import { Empty, ErrorBox, IconBadge, Loading, PageHeader } from '@/components/ui'

const ADMIN = ['announcement', 'admin_message', 'support']

export default function Requests() {
  const { t } = useI18n()
  const inbox = useInbox()
  const items = inbox.data ?? []

  return (
    <div>
      <PageHeader icon={Inbox} color="#CE8422" title="الطلبات" subtitle="الطلبات والردود" back={false} />
      {inbox.isLoading ? (
        <Loading />
      ) : inbox.error ? (
        <ErrorBox error={inbox.error} />
      ) : items.length === 0 ? (
        <Empty icon={Inbox} text="لا توجد طلبات الآن" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const admin = ADMIN.includes(item.action ?? '')
              return (
                <div key={item.id} className="card flex items-start gap-3 p-4">
                  <IconBadge icon={admin ? Megaphone : UserRound} color={admin ? '#0A5A50' : '#CE8422'} size={42} />
                  <div className="min-w-0 flex-1">
                    {admin && <p className="mb-0.5 text-[12px] font-bold text-brand">{t('من إدارة فوندلي')}</p>}
                    <p className="text-[14px] font-bold leading-relaxed text-ink">{inboxText(item, t)}</p>
                    <p className="mt-1 text-[11px] text-muted">{date(item.created_at)}</p>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
            {t('للرد على الطلبات وقبولها افتح التطبيق.')}
          </p>
        </>
      )}
    </div>
  )
}
