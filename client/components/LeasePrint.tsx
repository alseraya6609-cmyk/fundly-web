import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { openFile, useAssetEntries, useCurrency, useStore } from '@/lib/data'
import { signatureStrokes, type Lease, type Row } from '@/lib/lease'
import { buildLeaseHtml, isImageFile, isInvestorLease, isVehicleLease, leaseAttachments, type LeaseAttachment } from '@/lib/leasePdf'
import { HtmlPreview } from './RecordShare'

/*
  «طباعة العقد» بنموذج العقد المعتمد (buildLeasePdf + TemplatePrintScreen):
  الترويسة من بيانات الملف الشخصي وشعاره، والتوقيع والختم المحفوظان إن
  كان العقد موقّعًا.
*/

/** [assetId]: لتسمية «المستندات المرفقة» من مستندات الأصل وصورها. */
type Job = { lease: Lease; title: string; activity?: boolean; assetMeta?: Row; assetId?: string }

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
  const entries = useAssetEntries()
  const [attachments, setAttachments] = useState<LeaseAttachment[]>([])
  // المرفقات بأسمائها، وروابط مؤقتة لصور ما هو صورة منها.
  useEffect(() => {
    if (!job) return setAttachments([])
    const docPaths: Record<string, string> = {}
    for (const e of entries.data ?? []) {
      if (e.kind !== 'document' || (job.assetId && e.asset_id !== job.assetId)) continue
      const data = (e.data ?? {}) as Record<string, unknown>
      const name = str(data['اسم المستند']) || str(data['نوع المستند'])
      const path = str(data['الملف المرفق'])
      if (name && path && !(name in docPaths)) docPaths[name] = path
    }
    const list = leaseAttachments(job.lease, docPaths)
    setAttachments(list)
    let cancelled = false
    void (async () => {
      const withUrls = await Promise.all(list.map(async (a) => (a.path && isImageFile(a.path) ? { ...a, url: (await openFile({ localPath: a.path }).catch(() => null)) ?? undefined } : a)))
      if (!cancelled) setAttachments(withUrls)
    })()
    return () => {
      cancelled = true
    }
  }, [job, entries.data])
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
      // المحفوظ داخل العقد عند توقيعه، وإلا (عقد وُقِّع قبل ذلك) توقيع هذا الحساب.
      ...(job.lease.signature || job.lease.stamp
        ? { signature: signatureStrokes(job.lease.signature ?? ''), stamp: job.lease.stamp ?? '' }
        : { signature: signatureStrokes(d['user_signature_strokes_v1']), stamp: str(d['user_stamp_image_v1']) }),
      attachments,
    })
  }, [job, store.data, profile, currency, t, lang, dir, attachments])
  return {
    open: setJob,
    ui: job ? <HtmlPreview title={t(job.title)} html={html} onClose={() => setJob(null)} /> : null,
  }
}
