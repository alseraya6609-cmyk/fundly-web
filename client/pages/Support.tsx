import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, LifeBuoy, Loader2, MailCheck, Send } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { WEB_VERSION, useSession } from '@/lib/session'
import { supabase, errorText } from '@/lib/supabase'
import { cn } from '@/lib/format'
import { Empty, ErrorBox, Loading, PageHeader, SectionTitle } from '@/components/ui'

/*
  «إرسال بلاغ أو اقتراح» (SupportTicketsScreen في التطبيق): جدول
  fundly_support_tickets — المستخدم يرسل ويقرأ بلاغاته، والحالة والرد من
  لوحة التحكم. بعد الإرسال نافذة توضّح أين ذهب البلاغ وأين يصل الرد.
*/

export const SUPPORT_EMAIL = 'support@fundlyglobal.com'

const CATEGORIES = ['مشكلة تقنية', 'اقتراح', 'استفسار', 'الخصوصية وبياناتي (نسخة أو حذف)', 'أخرى']

type Ticket = { id: string; category: string; subject: string; body: string; status: string; admin_reply: string; created_at: string }

const statusLabel = (s: string) => (s === 'in_progress' ? 'قيد المعالجة' : s === 'closed' ? 'مغلق' : 'جديد')

function useTickets() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['support', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fundly_support_tickets')
        .select('id, category, subject, body, status, admin_reply, created_at')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as Ticket[]
    },
  })
}

/** نافذة بعد الإرسال: إلى أين ذهب البلاغ، وأين يصل الرد، وبريد الدعم. */
function SentNotice({ subject, onClose }: { subject: string; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4" onClick={onClose}>
      <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl">
        <p className="flex items-center gap-2 text-[17px] font-extrabold text-title">
          <MailCheck className="size-5 text-brand" />
          {t('تم إرسال البلاغ')}
        </p>
        <p className="mt-3 text-[13px] font-bold leading-relaxed text-title">
          {t('وصل بلاغك')} «<bdi>{subject}</bdi>» {t('إلى فريق الدعم الفني في فوندلي.')}
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-body">
          {t('سيصلك الرد في «الطلبات» مع إشعار، وتجد البلاغ وحالته في «بلاغاتي» أسفل هذه الصفحة.')}
        </p>
        <p className="mt-3 text-[12px] text-muted">{t('وللتواصل المباشر مع الدعم الفني بالبريد:')}</p>
        <a href={`mailto:${SUPPORT_EMAIL}`} dir="ltr" className="block text-[13px] font-extrabold text-brand underline">
          {SUPPORT_EMAIL}
        </a>
        <button type="button" onClick={onClose} className="mt-5 h-11 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
          {t('حسنًا')}
        </button>
      </div>
    </div>
  )
}

export default function Support() {
  const { t } = useI18n()
  const { user } = useSession()
  const qc = useQueryClient()
  const tickets = useTickets()
  const [category, setCategory] = useState(CATEGORIES[0])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')

  async function send() {
    const s = subject.trim()
    const b = body.trim()
    if (!s || !b) return setError('اكتب عنوان البلاغ وتفاصيله.')
    setBusy(true)
    setError('')
    try {
      const { error: e } = await supabase.from('fundly_support_tickets').insert({
        user_id: user!.id,
        category,
        subject: s,
        body: b,
        platform: 'web',
        app_version: `web ${WEB_VERSION}`,
      })
      if (e) throw e
      setSubject('')
      setBody('')
      await qc.invalidateQueries({ queryKey: ['support'] })
      setSent(s)
    } catch (e) {
      const text = errorText(e)
      setError(text.includes('تعذّر الاتصال') ? text : 'تعذّر الإرسال — تحقق من الاتصال')
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-field bg-field px-3 text-[13.5px] text-title outline-none ring-1 ring-line focus:ring-2 focus:ring-gold'

  return (
    <div>
      <PageHeader icon={LifeBuoy} color="#0A5A50" title="إرسال بلاغ أو اقتراح" />
      <div className="card p-4">
        <p className="text-[12.5px] font-bold leading-relaxed text-body">
          {t('اكتب المشكلة أو الاقتراح، ويصلك رد فريق الدعم في «الطلبات» وإشعارًا على الجوال.')}
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-bold text-sub">{t('نوع البلاغ')}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(field, 'h-11')}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-bold text-sub">
            {t('العنوان')} <span className="text-danger">*</span>
          </span>
          <input dir="auto" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className={cn(field, 'h-11')} />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-bold text-sub">
            {t('التفاصيل')} <span className="text-danger">*</span>
          </span>
          <textarea dir="auto" rows={5} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} className={cn(field, 'py-2')} />
          <span className="mt-0.5 block text-end text-[10.5px] text-muted">{body.length}/4000</span>
        </label>
        {error && <p className="mt-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t(busy ? 'جارٍ الإرسال...' : 'إرسال البلاغ')}
        </button>
      </div>

      <SectionTitle count={tickets.data?.length}>{t('بلاغاتي')}</SectionTitle>
      {tickets.isError ? (
        <ErrorBox error={tickets.error} />
      ) : tickets.isLoading ? (
        <Loading />
      ) : !tickets.data?.length ? (
        <Empty icon={Inbox} text="لم ترسل أي بلاغ بعد." />
      ) : (
        <div className="grid gap-2">
          {tickets.data.map((k) => {
            const d = new Date(k.created_at)
            return (
              <div key={k.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p dir="auto" className="min-w-0 flex-1 break-words text-[14px] font-extrabold text-title">
                    {k.subject}
                  </p>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold',
                      k.status === 'in_progress' ? 'bg-gold-soft text-gold-dark' : k.status === 'closed' ? 'bg-surface text-muted' : 'bg-brand-soft text-brand',
                    )}
                  >
                    {t(statusLabel(k.status))}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">
                  {t(k.category)} · {Number.isNaN(d.getTime()) ? '' : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`}
                </p>
                <p dir="auto" className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-body">
                  {k.body}
                </p>
                {k.admin_reply.trim() && (
                  <div className="mt-3 rounded-inner bg-brand-soft px-3 py-2">
                    <p className="text-[11.5px] font-extrabold text-brand">{t('رد فريق الدعم')}</p>
                    <p dir="auto" className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
                      {k.admin_reply}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
        {t('وللتواصل المباشر مع الدعم الفني بالبريد:')}{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} dir="ltr" className="font-extrabold text-brand underline">
          {SUPPORT_EMAIL}
        </a>
      </p>
      {sent && <SentNotice subject={sent} onClose={() => setSent('')} />}
    </div>
  )
}
