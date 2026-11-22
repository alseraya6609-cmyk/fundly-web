import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Paperclip, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import type { AssetEntry } from '@/lib/data'
import { FileError, uploadDeviceFile } from '@/lib/files'
import { AssetError, saveEntry, validateEntry, type AssetGroup } from '@/lib/assetWrite'
import { Confirm } from './Confirm'
import { Sheet } from './ui'

/* نموذج سجل الأصل كما في التطبيق: حقول المجموعة بترتيبها، والمرفق ملف من ملفات التطبيق. */

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'
const toInputDate = (value: string) => {
  const p = value.split('/')
  if (p.length !== 3) return ''
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  if ([d, m, y].some(Number.isNaN)) return ''
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const fromInputDate = (value: string) => {
  if (!value) return ''
  const [y, m, d] = value.split('-').map((x) => parseInt(x, 10))
  return `${d}/${m}/${y}`
}

export function AssetEntryForm({
  assetId,
  assetTitle,
  group,
  entry,
  onClose,
  onDone,
}: {
  assetId: string
  assetTitle: string
  group: AssetGroup
  entry?: AssetEntry
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(group.fields.map((f) => [f.label, String(entry?.data?.[f.label] ?? '')])),
  )
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }))
  const tr = (m: string) =>
    m
      .split('|')
      .map((p) => t(p))
      .join('')

  async function save() {
    setBusy(true)
    setError('')
    try {
      await saveEntry(assetId, assetTitle, group, values, entry)
      await qc.invalidateQueries({ queryKey: ['asset-entries'] })
      setConfirming(false)
      onDone(entry ? 'تم حفظ التعديل بنجاح' : 'تم الحفظ بنجاح')
    } catch (e) {
      setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">
        {entry ? `${t('تعديل')} — ${t(group.title)}` : t(group.addTitle ?? `إضافة إلى ${group.title}`)}
      </p>
      <p className="mt-0.5 text-[12px] text-muted" dir="auto">
        {assetTitle}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {group.fields.map((f) => {
          const label = (
            <span className="text-[12px] font-bold text-sub">
              {t(f.display ?? f.label)}
              {(f.required || f === group.fields[0]) && <span className="text-danger"> *</span>}
            </span>
          )
          const v = values[f.label] ?? ''
          if (f.file)
            return (
              <div key={f.label} className="col-span-2">
                {v ? (
                  <span className="flex h-11 items-center justify-between gap-2 rounded-field bg-field px-3 text-[12.5px] font-bold text-ink">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Paperclip className="size-4 shrink-0 text-brand" />
                      <span className="truncate" dir="auto">
                        {v.split(/[\\/]/).pop()}
                      </span>
                    </span>
                    <button type="button" aria-label={t('إزالة')} onClick={() => set(f.label, '')} className="text-danger">
                      <X className="size-4" />
                    </button>
                  </span>
                ) : (
                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-field border border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft">
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                    {t('إرفاق مستند')}
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,application/pdf"
                      disabled={uploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        setUploading(true)
                        setError('')
                        try {
                          set(f.label, await uploadDeviceFile(file))
                        } catch (err) {
                          setError(err instanceof FileError ? err.message : 'تعذّر رفع الملف. حاول مرة أخرى.')
                        } finally {
                          setUploading(false)
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            )
          return (
            <label key={f.label} className={cn('flex flex-col gap-1', (f.multiline || !(f.date || f.numeric)) && 'col-span-2')}>
              {label}
              {f.options ? (
                <select value={v} onChange={(e) => set(f.label, e.target.value)} className={inputClass}>
                  <option value="">{t('اختر')}</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </select>
              ) : f.date ? (
                <input type="date" value={toInputDate(v)} onChange={(e) => set(f.label, fromInputDate(e.target.value))} className={inputClass} />
              ) : f.multiline ? (
                <textarea rows={3} dir="auto" value={v} onChange={(e) => set(f.label, e.target.value)} className={cn(inputClass, 'h-auto py-3')} />
              ) : (
                <input dir={f.numeric ? 'ltr' : 'auto'} inputMode={f.numeric ? 'decimal' : undefined} value={v} onChange={(e) => set(f.label, e.target.value)} className={inputClass} />
              )}
            </label>
          )
        })}
      </div>
      {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{tr(error)}</p>}
      <button
        type="button"
        onClick={() => {
          const problem = validateEntry(group, values)
          setError(problem ?? '')
          if (!problem) setConfirming(true)
        }}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t(entry ? 'حفظ التعديل' : 'حفظ')}
      </button>
      <Confirm
        open={confirming}
        title={entry ? 'تأكيد التعديل' : 'تأكيد الحفظ'}
        message={`«${values[group.fields[0].label] ?? ''}» — ${t(entry ? 'هل تريد حفظ التعديل؟' : 'هل تريد حفظ البيانات؟')}`}
        busy={busy}
        error={error ? tr(error) : ''}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}
