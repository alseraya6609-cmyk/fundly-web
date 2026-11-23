import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/supabase'
import type { Entry } from '@/lib/data'
import { EntryError, FOLLOWUP_TYPES, addDocument, addFollowup, deleteFollowup, followupsOf } from '@/lib/personalWrite'
import { Confirm } from './Confirm'
import { Sheet } from './ui'
import { namedFile } from '@/components/DocName'

/*
  «المتابعة والتخطيط» و«مستند» داخل الالتزام كما في التطبيق (_addFollowupRow،
  _deleteFollowupRow، _saveAddedAttachment): المهمة والموعد والعادة والتذكير
  والملاحظات صفوف في «سجل المتابعة» داخل الالتزام نفسه، والمستند يصير
  المرفق الأول أو يُضاف بجانبه.
*/

const SAVED: Record<string, string> = { مهمة: 'المهمة', موعد: 'الموعد', عادة: 'العادة', تذكير: 'التذكير', ملاحظات: 'الملاحظات', ملاحظة: 'الملاحظة', مستند: 'المستند' }
const saved = (type: string) => SAVED[type] ?? type
const fieldClass = 'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none focus:border-gold'
const toDmy = (v: string) => {
  if (!v) return ''
  const [y, m, d] = v.split('-').map((x) => parseInt(x, 10))
  return `${d}/${m}/${y}`
}

function FollowupForm({ entry, type, onClose, onDone }: { entry: Entry; type: string; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [time, setTime] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    setError('')
    try {
      await addFollowup(entry, { النوع: type, العنوان: title, التفاصيل: details, التاريخ: toDmy(dateValue), الوقت: time })
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setConfirming(false)
      onDone(`${t('تم حفظ')} ${t(saved(type))} ${t('بنجاح')}`)
    } catch (e) {
      setError(e instanceof EntryError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">
        {t('إضافة')} {t(type)}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">
            {t('العنوان')}
            <span className="text-danger"> *</span>
          </span>
          <input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('التفاصيل')}</span>
          <textarea rows={2} dir="auto" value={details} placeholder={`${t('أوصف')} ${t(type)}`} onChange={(e) => setDetails(e.target.value)} className={`${fieldClass} h-auto py-3`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('التاريخ')}</span>
          <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('الوقت')}</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldClass} />
        </label>
      </div>
      {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={() => {
          if (!title.trim()) {
            setError('اكتب العنوان أولًا')
            return
          }
          setError('')
          setConfirming(true)
        }}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('حفظ')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد الحفظ"
        message={`${t('هل تريد حفظ')} ${t(saved(type))}؟`}
        confirmLabel="تأكيد"
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}

export function FollowupPanel({ entry, canWrite, onChanged }: { entry: Entry; canWrite: boolean; onChanged: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const rows = followupsOf(entry.details ?? {})
  const [type, setType] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Record<string, string> | null>(null)
  const [doc, setDoc] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setRemoving(null)
      setDoc(null)
      onChanged(message)
    } catch (e) {
      setError(e instanceof EntryError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }
  if (!canWrite && rows.length === 0) return null
  return (
    <div className="mt-5">
      <p className="mb-2 text-[14px] font-extrabold text-title">{t('المتابعة والتخطيط')}</p>
      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* الأحدث أولًا: السجل يُلحق بآخره. */}
          {[...rows].reverse().map((r, i) => (
            <div key={i} className="card-inner flex items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[12.5px] font-extrabold text-ink">
                  <span className="me-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] text-brand">{t(r['النوع'] || 'أخرى')}</span>
                  <span dir="auto">{r['العنوان']}</span>
                </p>
                {r['التفاصيل'] && (
                  <p dir="auto" className="mt-1 text-[12px] text-sub">
                    {r['التفاصيل']}
                  </p>
                )}
                {(r['التاريخ'] || r['الوقت']) && <p className="mt-0.5 text-[11px] text-muted">{[r['التاريخ'], r['الوقت']].filter(Boolean).join(' ')}</p>}
              </div>
              {canWrite && (
                <button type="button" aria-label={t('حذف من المتابعة')} onClick={() => (setError(''), setRemoving(r))} className="grid size-8 shrink-0 place-items-center rounded-inner text-danger hover:bg-danger-soft">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canWrite && (
        <div className="mt-2 flex flex-wrap gap-2">
          {FOLLOWUP_TYPES.map((x) => (
            <button key={x} type="button" onClick={() => setType(x)} className="flex h-9 items-center gap-1 rounded-inner border border-line bg-white px-3 text-[12.5px] font-bold text-ink hover:border-brand hover:text-brand">
              <Plus className="size-3.5" />
              {t(x)}
            </button>
          ))}
          <label className="flex h-9 cursor-pointer items-center gap-1 rounded-inner border border-line bg-white px-3 text-[12.5px] font-bold text-ink hover:border-brand hover:text-brand">
            <FileText className="size-3.5" />
            {t('مستند')}
            <input
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={async (e) => {
                setError('')
                const picked = e.target.files?.[0]
                e.target.value = ''
                const named = await namedFile(picked)
                if (named) setDoc(named)
              }}
            />
          </label>
        </div>
      )}
      {type && <FollowupForm entry={entry} type={type} onClose={() => setType(null)} onDone={(m) => (setType(null), onChanged(m))} />}
      <Confirm
        open={!!removing}
        title="حذف من المتابعة"
        message={`${t('سيُحذف')} «${removing?.['العنوان'] ?? ''}» ${t('نهائيًا. هل تريد الحذف؟')}`}
        confirmLabel="حذف"
        danger
        busy={busy}
        error={error}
        onConfirm={() => removing && run(() => deleteFollowup(entry, removing), 'تم الحذف')}
        onCancel={() => setRemoving(null)}
      />
      <Confirm
        open={!!doc}
        title="تأكيد الحفظ"
        message={`«${doc?.name ?? ''}» — ${t('هل تريد حفظ')} ${t('المستند')}؟`}
        confirmLabel="تأكيد"
        busy={busy}
        error={error}
        onConfirm={() => doc && run(() => addDocument(entry, doc), `${t('تم حفظ')} ${t('المستند')} ${t('بنجاح')}`)}
        onCancel={() => setDoc(null)}
      />
    </div>
  )
}
