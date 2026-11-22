import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, ChevronDown, Inbox, Megaphone, Smartphone, UserRound, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { inboxText, useInbox, useStore, type InboxItem } from '@/lib/data'
import { date } from '@/lib/format'
import { canRespond, isInfo, markSeen, publicName, requestDetails, respond } from '@/lib/requestsWrite'
import { Empty, ErrorBox, IconBadge, InfoRow, Loading, PageHeader } from '@/components/ui'
import { Confirm } from '@/components/Confirm'

/*
  الطلبات (نافذة «وصلك طلب جديد» وصفحة الطلبات في التطبيق): قبول الدعوات
  والإسنادات والتفويضات أو رفضها، وإغلاق الإشعارات المقروءة.
*/

const ADMIN = ['announcement', 'admin_message', 'support']

function RequestCard({ item, onDone }: { item: InboxItem; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const { profile } = useSession()
  const store = useStore()
  const qc = useQueryClient()
  const [asking, setAsking] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [details, setDetails] = useState<[string, string][] | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const admin = ADMIN.includes(item.action ?? '')
  const respondable = canRespond(item)
  const info = isInfo(item)

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['inbox'] }),
      qc.invalidateQueries({ queryKey: ['shared'] }),
      qc.invalidateQueries({ queryKey: ['personal'] }),
    ])
  }

  async function run(accept: boolean) {
    setBusy(true)
    setError('')
    const result = await respond(item, accept, profile?.fnd_id ?? '', publicName(store.data, profile?.display_name ?? ''))
    setBusy(false)
    if (result) {
      setError(result)
      await refresh()
      return
    }
    setAsking(null)
    await refresh()
    onDone(accept ? 'تم القبول' : 'تم الرفض')
  }

  async function toggleDetails() {
    if (details) {
      setDetails(null)
      return
    }
    setLoadingDetails(true)
    setDetails(await requestDetails(item))
    setLoadingDetails(false)
  }

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <IconBadge icon={admin ? Megaphone : UserRound} color={admin ? '#0A5A50' : '#CE8422'} size={42} />
        <div className="min-w-0 flex-1">
          {admin && <p className="mb-0.5 text-[12px] font-bold text-brand">{t('من إدارة فوندلي')}</p>}
          <p className="text-[14px] font-bold leading-relaxed text-ink">{inboxText(item, t)}</p>
          <p className="mt-1 text-[11px] text-muted">{date(item.created_at)}</p>
        </div>
      </div>

      {details && (
        <div className="card-inner mt-3 px-3">
          {details.length === 0 ? (
            <p className="py-3 text-[12px] text-muted">{t('لا توجد تفاصيل إضافية')}</p>
          ) : (
            details.map(([k, v]) => <InfoRow key={k} label={k} value={v} />)
          )}
        </div>
      )}
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {respondable && (
          <>
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="flex h-10 items-center gap-1.5 rounded-inner bg-brand px-4 text-[13px] font-extrabold text-white hover:bg-brand-dark"
            >
              <Check className="size-4" />
              {t('قبول')}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="flex h-10 items-center gap-1.5 rounded-inner bg-danger-soft px-4 text-[13px] font-extrabold text-danger hover:bg-danger/15"
            >
              <X className="size-4" />
              {t('رفض')}
            </button>
            {item.source !== 'delegations' && (
              <button
                type="button"
                onClick={toggleDetails}
                disabled={loadingDetails}
                className="flex h-10 items-center gap-1.5 rounded-inner bg-surface px-3 text-[13px] font-bold text-body hover:bg-line"
              >
                <ChevronDown className={details ? 'size-4 rotate-180' : 'size-4'} />
                {t('التفاصيل')}
              </button>
            )}
          </>
        )}
        {!respondable && !info && (
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-sub">
            <Smartphone className="size-4" />
            {t('يُرد على هذا الطلب من التطبيق.')}
          </p>
        )}
        {info && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await markSeen([item.id]).catch(() => {})
              setBusy(false)
              await refresh()
            }}
            className="flex h-10 items-center gap-1.5 rounded-inner bg-surface px-4 text-[13px] font-extrabold text-body hover:bg-line disabled:opacity-60"
          >
            <Check className="size-4" />
            {t('حسنًا')}
          </button>
        )}
      </div>

      <Confirm
        open={asking !== null}
        title={asking ? 'قبول' : 'رفض'}
        message={`${inboxText(item, t)} — ${t(asking ? 'هل تريد القبول؟' : 'هل تريد الرفض؟')}`}
        confirmLabel={asking ? 'قبول' : 'رفض'}
        danger={asking === false}
        busy={busy}
        error={error}
        onConfirm={() => run(!!asking)}
        onCancel={() => {
          setAsking(null)
          setError('')
        }}
      />
    </div>
  )
}

export default function Requests() {
  const { t } = useI18n()
  const inbox = useInbox()
  const items = inbox.data ?? []
  const [notice, setNotice] = useState('')

  return (
    <div>
      <PageHeader icon={Inbox} color="#CE8422" title="الطلبات" subtitle="الطلبات والردود" back={false} />
      {notice && (
        <p className="mb-3 flex items-center gap-2 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(notice)}
        </p>
      )}
      {inbox.isLoading ? (
        <Loading />
      ) : inbox.error ? (
        <ErrorBox error={inbox.error} />
      ) : items.length === 0 ? (
        <Empty icon={Inbox} text="لا توجد طلبات الآن" />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <RequestCard
              key={item.id}
              item={item}
              onDone={(message) => {
                setNotice(message)
                window.setTimeout(() => setNotice(''), 4000)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
