import { useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { useCurrency, useStore } from '@/lib/data'
import { signatureStrokes, type Lease, type Row } from '@/lib/lease'
import { buildLeaseHtml, isInvestorLease, isVehicleLease } from '@/lib/leasePdf'
import { HtmlPreview } from './RecordShare'

/*
  «طباعة العقد» بنموذج العقد المعتمد (buildLeasePdf + TemplatePrintScreen):
  الترويسة من بيانات الملف الشخصي وشعاره، والتوقيع والختم المحفوظان إن
  كان العقد موقّعًا.
*/

type Job = { lease: Lease; title: string; activity?: boolean; assetMeta?: Row }

/** عنوان المستند كما في التطبيق (printOrShareLeaseContract / _shownTitle). */
export function leasePrintTitle(lease: Lease, activity = false, fallback = 'عقد الإيجار') {
  if (isVehicleLease(lease)) return fallback
  if (activity) return 'عقد إيجار النشاط التجاري'
  return isInvestorLease(lease) ? 'عقد مستثمر' : fallback
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function useLeasePrint(): { open: (job: Job) => void; ui: ReactNode } {
  const { t, lang, dir } = useI18n()
  const store = useStore()
  const { profile } = useSession()
  const currency = useCurrency()
  const [job, setJob] = useState<Job | null>(null)
  const html = useMemo(() => {
    if (!job) return ''
    const d = store.data ?? {}
    return buildLeaseHtml(job.lease, {
      t,
      lang,
      dir,
      origin: window.location.origin,
      title: job.title,
      activity: job.activity,
      assetMeta: job.assetMeta,
      currency,
      org: {
        name: str(d['settings_profile_name']) || profile?.display_name || '',
        city: str(d['settings_profile_city']),
        phone: str(d['settings_profile_phone']),
        email: str(d['settings_profile_email']),
        logo: str(d['user_logo_image_v1']) || null,
      },
      signature: signatureStrokes(d['user_signature_strokes_v1']),
      stamp: str(d['user_stamp_image_v1']),
    })
  }, [job, store.data, profile, currency, t, lang, dir])
  return {
    open: setJob,
    ui: job ? <HtmlPreview title={t(job.title)} html={html} onClose={() => setJob(null)} /> : null,
  }
}
