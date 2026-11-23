import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRequestLists, type RequestCardItem } from '@/lib/requestsList'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, ChevronDown, ChevronLeft, FileCheck2, Inbox, Megaphone, Send, ReceiptText, Smartphone, UserRound, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { inboxText, useInbox, useStore, type InboxItem } from '@/lib/data'
import { date } from '@/lib/format'
import { canRespond, isInfo, markSeen, publicName, requestDetails, respond } from '@/lib/requestsWrite'
import { Chip, Empty, ErrorBox, IconBadge, InfoRow, Loading, PageHeader, SectionTitle } from '@/components/ui'
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
        {item.source === 'salary_receipts' && item.record_id && (
          <Link to={`/salary?open=${item.record_id}`} className="flex h-10 items-center gap-1.5 rounded-inner bg-brand px-4 text-[13px] font-extrabold text-white hover:bg-brand-dark">
            <ReceiptText className="size-4" />
            {t('فتح السند')}
          </Link>
        )}
        {!respondable && !info && item.source !== 'salary_receipts' && (
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

/** بطاقة «بانتظار اعتمادك» أو «أرسلتها بانتظار الرد»: تفتح السجل نفسه. */
function LinkCard({ item, sent }: { item: RequestCardItem; sent: boolean }) {
  const { t } = useI18n()
  return (
    <Link to={item.to} className="card flex items-center gap-3 p-4 hover:ring-1 hover:ring-brand">
      <IconBadge icon={sent ? Send : FileCheck2} color={sent ? '#8C9A97' : '#0E7161'} size={42} />
      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate text-[14px] font-extrabold text-ink">
          {item.title}
        </p>
        <p className="mt-0.5 text-[12.5px] font-bold text-sub">
          {t(item.label)} <bdi>{item.value}</bdi>
        </p>
        {item.at && <p className="mt-0.5 text-[11px] text-muted">{date(item.at)}</p>}
      </div>
      <ChevronLeft className="size-4 shrink-0 text-muted ltr:rotate-180" />
    </Link>
  )
}

export default function Requests() {
  const { t } = useI18n()
  const inbox = useInbox()
  const items = inbox.data ?? []
  const [notice, setNotice] = useState('')
  const lists = useRequestLists()
  // تصنيف أعلى الصفحة: الكل، بانتظار قبولي (ما أرد عليه وما أعتمده)، بانتظار قبول الآخرين.
  const [filter, setFilter] = useState<'all' | 'mine' | 'others'>('all')
  const mineInbox = items.filter((i) => canRespond(i))
  const shownInbox = filter === 'all' ? items : filter === 'mine' ? mineInbox : []
  const mineCount = mineInbox.length + lists.approvals.length
  const othersCount = lists.sent.length
  const allCount = items.length + lists.approvals.length + lists.sent.length

  return (
    <div>
      <PageHeader icon={Inbox} color="#CE8422" title="الطلبات" subtitle="الطلبات والردود" back={false} />
      {notice && (
        <p className="mb-3 flex items-center gap-2 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(notice)}
        </p>
      )}
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <Chip active={filter === 'all'} label="الكل" icon={Inbox} count={allCount} onClick={() => setFilter('all')} />
        <Chip active={filter === 'mine'} label="بانتظار قبولي" icon={FileCheck2} count={mineCount} onClick={() => setFilter('mine')} />
        <Chip active={filter === 'others'} label="بانتظار قبول الآخرين" icon={Send} count={othersCount} onClick={() => setFilter('others')} />
      </div>
      {filter !== 'others' && lists.approvals.length > 0 && (
        <>
          <SectionTitle count={lists.approvals.length}>{t('بانتظار اعتمادك')}</SectionTitle>
          <div className="mb-3 flex flex-col gap-2">
            {lists.approvals.map((item) => (
              <LinkCard key={item.key} item={item} sent={false} />
            ))}
          </div>
        </>
      )}
      {filter !== 'mine' && lists.sent.length > 0 && (
        <>
          <SectionTitle count={lists.sent.length}>{t('أرسلتها بانتظار الرد')}</SectionTitle>
          <div className="mb-3 flex flex-col gap-2">
            {lists.sent.map((item) => (
              <LinkCard key={item.key} item={item} sent />
            ))}
          </div>
        </>
      )}
      {filter !== 'others' && shownInbox.length > 0 && (filter === 'mine' || lists.approvals.length > 0 || lists.sent.length > 0) && (
        <SectionTitle count={shownInbox.length}>{t(filter === 'mine' ? 'بانتظار ردك' : 'الطلبات والردود')}</SectionTitle>
      )}
      {inbox.isLoading ? (
        <Loading />
      ) : inbox.error ? (
        <ErrorBox error={inbox.error} />
      ) : shownInbox.length === 0 ? (
        (filter === 'others' ? lists.sent.length === 0 : filter === 'mine' ? lists.approvals.length === 0 : lists.approvals.length + lists.sent.length === 0) && <Empty icon={Inbox} text="لا توجد طلبات الآن" />
      ) : (
        <div className="flex flex-col gap-2">
          {shownInbox.map((item) => (
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
