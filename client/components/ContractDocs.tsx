import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckSquare, FilePlus2, FolderOpen, Paperclip, Square } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { FileError, uploadDeviceFile } from '@/lib/files'
import { addContractDocument } from '@/lib/assetWrite'
import { usePageEntries } from '@/lib/delegatedAssets'
import { Sheet } from './ui'

/*
  «مستندات العقار» / «مستندات المركبة» في نموذج العقد (_contractDocumentsBox):
  يُختار من مستندات الأصل ما يُرفق بالعقد (شروطك مثلًا)، أو يُضاف مستند
  جديد من ملف فيُحفظ في «المستندات» ويُختار مباشرة. الأسماء في
  «المستندات المرفقة» سطرًا سطرًا.
*/

export function ContractDocsBox({ assetId, label, value, onChange }: { assetId: string; label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const attached = value
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-3 rounded-card bg-surface p-4">
      <button type="button" onClick={() => setOpen(true)} className="flex h-11 w-full items-center justify-center gap-2 rounded-inner border border-brand bg-white text-[13px] font-extrabold text-brand hover:bg-brand-soft">
        <FolderOpen className="size-4" />
        {t(label)}
        {attached.length > 0 && ` (${attached.length})`}
      </button>
      <p className="mt-1.5 text-center text-[11px] font-bold text-muted">
        {t('أرفق مستند شروطك من')} {t(label)}{t('، أو من ملف')}
      </p>
      {attached.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {attached.map((name) => (
            <p key={name} dir="auto" className="flex items-center gap-1.5 text-[12px] font-extrabold text-title">
              <Paperclip className="size-3.5 text-brand" />
              {name}
            </p>
          ))}
        </div>
      )}
      {open && (
        <Picker
          assetId={assetId}
          label={label}
          initial={attached}
          onClose={() => setOpen(false)}
          onPick={(names) => {
            setOpen(false)
            onChange(names.join('\n'))
          }}
        />
      )}
    </div>
  )
}

function Picker({ assetId, label, initial, onClose, onPick }: { assetId: string; label: string; initial: string[]; onClose: () => void; onPick: (names: string[]) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const entries = usePageEntries()
  const [selected, setSelected] = useState<string[]>(initial)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const names: string[] = []
  for (const e of entries.data ?? []) {
    if (e.asset_id !== assetId || e.kind !== 'document') continue
    const n = String(e.data['اسم المستند'] ?? e.data['نوع المستند'] ?? '').trim()
    if (n && !names.includes(n)) names.push(n)
  }
  // ما أُرفق سابقًا يبقى ظاهرًا ولو تغيّر اسمه.
  for (const n of selected) if (!names.includes(n)) names.push(n)
  const toggle = (n: string) => setSelected((x) => (x.includes(n) ? x.filter((y) => y !== n) : [...x, n]))

  async function addNew() {
    const finalName = name.trim()
    if (!file || !finalName) return
    setBusy(true)
    setError('')
    try {
      const path = await uploadDeviceFile(file)
      await addContractDocument(assetId, finalName, path)
      await qc.invalidateQueries({ queryKey: ['asset-entries'] })
      setSelected((x) => (x.includes(finalName) ? x : [...x, finalName]))
      setFile(null)
      setName('')
    } catch (e) {
      setError(e instanceof FileError ? e.message : errorText(e) || 'تعذّر حفظ المستند. تحقّق من الاتصال وحاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[16px] font-extrabold text-title">{t(label)}</p>
      <p className="mt-0.5 text-[11.5px] font-bold text-muted">{t('اختر من مستندات العقار، أو أضف مستندًا جديدًا من الملفات أو الاستوديو أو التصوير')}</p>
      {file ? (
        <div className="mt-3 flex flex-col gap-2 rounded-inner border border-line p-3">
          <p dir="auto" className="truncate text-[12px] font-bold text-sub">
            {file.name}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('اسم المستند')}</span>
            <input dir="auto" autoFocus value={name} placeholder={t('مثال: شروط العقد')} onChange={(e) => setName(e.target.value)} className="h-11 rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none focus:border-gold" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setFile(null)} className="h-10 rounded-inner border border-line text-[12.5px] font-extrabold text-ink">
              {t('إلغاء')}
            </button>
            <button type="button" disabled={busy || !name.trim()} onClick={addNew} className="h-10 rounded-inner bg-brand text-[12.5px] font-extrabold text-white disabled:opacity-50">
              {t(busy ? 'جارٍ الحفظ…' : 'حفظ')}
            </button>
          </div>
        </div>
      ) : (
        <label className="mt-3 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-inner border border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft">
          <FilePlus2 className="size-4" />
          {t('إضافة مستند (ملف / استوديو / تصوير)')}
          <input
            type="file"
            className="hidden"
            accept="image/*,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ''
              if (!f) return
              setFile(f)
              setName(f.name.replace(/\.[^.]+$/, ''))
            }}
          />
        </label>
      )}
      {error && <p className="mt-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <div className="mt-3 flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
        {names.length === 0 ? (
          <p className="py-6 text-center text-[12px] font-bold text-muted">{t('لا توجد مستندات بعد — أضف مستند شروطك في «المستندات» ثم ارفقه هنا')}</p>
        ) : (
          names.map((n) => {
            const on = selected.includes(n)
            return (
              <button key={n} type="button" onClick={() => toggle(n)} className={cn('flex items-center gap-2 rounded-inner px-2 py-2.5 text-start text-[12.5px] font-bold', on ? 'text-brand' : 'text-ink')}>
                {on ? <CheckSquare className="size-5" /> : <Square className="size-5 text-muted" />}
                <span dir="auto">{n}</span>
              </button>
            )
          })
        )}
      </div>
      <button type="button" onClick={() => onPick(selected)} className="mt-4 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
        {t('إرفاق بالعقد')} ({selected.length})
      </button>
    </Sheet>
  )
}
