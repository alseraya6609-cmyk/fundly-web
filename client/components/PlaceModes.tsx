import { useState } from 'react'
import { Link2, LocateFixed, MapPinPlus, MapPinned, PencilLine } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import { clipboardLink, coordsMapsUrl, currentLocation, mapsSearchUrl } from '@/lib/geo'
import { Confirm } from './Confirm'
import { Chevron } from './ui'

/*
  «مواقع وأماكن» في الالتزامات الشخصية والمشتركة: ثلاث طرق للموقع
  (أنا في المكان الآن / لصق رابط خرائط جوجل / كتابة العنوان بنفسي).
  «أنا في المكان الآن» يجلب الموقع فورًا، و«لصق الرابط» يلصق المنسوخ فعلًا
  أو يشرح الطريقة ويفتح خرائط جوجل (pasteMapsLink).
*/

type Mode = 'current' | 'link' | 'manual'

const MODES: [Mode, string, typeof LocateFixed][] = [
  ['current', 'أنا في المكان الآن', LocateFixed],
  ['link', 'لصق رابط خرائط جوجل', Link2],
  ['manual', 'كتابة العنوان بنفسي', PencilLine],
]

const HINTS: Record<Mode, string> = {
  current: 'وأنت داخل المكان: يُحفظ موقعك الحالي من GPS الجوال في «الموقع أو الرابط».',
  link: 'افتح المكان في خرائط جوجل ← مشاركة ← نسخ الرابط، ثم الصقه في «الموقع أو الرابط».',
  manual: 'اكتب العنوان أو وصف الطريق بنفسك في الحقول.',
}

function openMaps(url = 'https://www.google.com/maps') {
  window.open(url, '_blank', 'noopener')
}

/** رسالة قصيرة تحت الأزرار بدل SnackBar التطبيق. */
function Note({ text, error }: { text: string; error: boolean }) {
  const { t } = useI18n()
  if (!text) return null
  return (
    <p role="status" className={cn('rounded-inner px-3 py-2 text-[12px] font-bold', error ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand')}>
      {text
        .split('|')
        .map((p) => t(p))
        .join('')}
    </p>
  )
}

/** يجلب الموقع الحالي، ويعيد القيمة أو يعرض السبب. */
export function useGeoFetch() {
  const [note, setNote] = useState<{ text: string; error: boolean }>({ text: '', error: false })
  const [busy, setBusy] = useState(false)
  async function fetchNow(successNote = true): Promise<string | null> {
    setBusy(true)
    setNote({ text: '', error: false })
    const r = await currentLocation()
    setBusy(false)
    if ('message' in r) {
      setNote({ text: r.message, error: true })
      return null
    }
    if (successNote) setNote({ text: `حُفظ الموقع:| ${r.value}`, error: false })
    return r.value
  }
  return { note, setNote, busy, fetchNow }
}

export function PlaceModes({ onValue, personal = false }: { onValue: (value: string) => void; personal?: boolean }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('manual')
  const [noLink, setNoLink] = useState(false)
  const geo = useGeoFetch()

  async function paste() {
    const link = await clipboardLink()
    if (!link) {
      setNoLink(true)
      return
    }
    onValue(link)
    geo.setNote({ text: 'تم لصق الرابط في «الموقع أو الرابط»', error: false })
  }

  async function current() {
    // الشخصي يعرض «حُفظ الموقع: …»، والمشترك يملأ الحقل بلا رسالة نجاح.
    const value = await geo.fetchNow(personal)
    if (value) onValue(value)
  }

  return (
    <div className="col-span-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-[7px]">
        {MODES.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            onClick={() => {
              setMode(key)
              if (key === 'link') void paste()
              else if (key === 'current') void current()
            }}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-extrabold',
              mode === key ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub hover:border-brand',
            )}
          >
            <Icon className="size-4" />
            {t(label)}
          </button>
        ))}
      </div>
      <p className="text-[11px] font-bold leading-relaxed text-sub">{t(HINTS[mode])}</p>
      {personal && mode === 'link' && (
        <button type="button" onClick={() => void paste()} className="flex h-11 items-center justify-center gap-2 rounded-field border border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft">
          <Link2 className="size-4" />
          {t('لصق الرابط المنسوخ')}
        </button>
      )}
      {personal && mode === 'current' && (
        <button
          type="button"
          disabled={geo.busy}
          onClick={() => void current()}
          className="flex items-center gap-2.5 rounded-inner border border-brand bg-brand-soft/60 p-3.5 text-start disabled:opacity-60"
        >
          <LocateFixed className="size-5 text-brand" />
          <span className="flex-1 text-[13px] font-extrabold text-title">{t(geo.busy ? 'جارٍ جلب الموقع…' : 'جلب موقعي الآن مرة أخرى')}</span>
          <Chevron className="size-4 text-muted" />
        </button>
      )}
      {!personal && geo.busy && <p className="text-[11px] font-bold text-muted">{t('جارٍ جلب الموقع…')}</p>}
      <Note text={geo.note.text} error={geo.note.error} />
      <Confirm
        open={noLink}
        title="لا يوجد رابط منسوخ"
        message={t('افتح المكان في خرائط جوجل ← مشاركة ← نسخ الرابط، ثم ارجع واضغط «لصق رابط خرائط جوجل» مرة أخرى.')}
        confirmLabel="فتح خرائط جوجل"
        onConfirm={() => {
          setNoLink(false)
          openMaps()
        }}
        onCancel={() => setNoLink(false)}
      />
    </div>
  )
}

/** زر الموقع في آخر حقل «الموقع الجغرافي»: يملؤه بالإحداثيات الحالية. */
export function GeoFieldButton({ filled, onValue }: { filled: boolean; onValue: (value: string) => void }) {
  const { t } = useI18n()
  const geo = useGeoFetch()
  return (
    <>
      <button
        type="button"
        title={t('جلب الموقع الحالي')}
        aria-label={t('جلب الموقع الحالي')}
        disabled={geo.busy}
        onClick={async () => {
          const value = await geo.fetchNow(true)
          if (value) onValue(value)
        }}
        className="absolute end-0 top-0 grid h-12 w-11 place-items-center disabled:opacity-50"
      >
        {filled ? <MapPinned className="size-5 text-brand" /> : <LocateFixed className="size-5 text-muted" />}
      </button>
      {geo.note.text && (
        <span className="mt-1 block">
          <Note text={geo.note.text} error={geo.note.error} />
        </span>
      )}
    </>
  )
}

/** «موقعك ومكانك» في نموذج الفرد: الموقع الحالي (رابط خرائط) أو فتح الخريطة. */
export function PersonPlaceButton({ value, onValue }: { value: string; onValue: (value: string) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const geo = useGeoFetch()
  return (
    <>
      <button
        type="button"
        title={t('تحديد من الخريطة')}
        aria-label={t('تحديد من الخريطة')}
        onClick={() => setOpen(true)}
        className="absolute end-0 top-0 grid h-11 w-11 place-items-center text-brand"
      >
        <MapPinPlus className="size-5" />
      </button>
      {geo.note.text && (
        <span className="mt-1 block">
          <Note text={geo.note.text} error={geo.note.error} />
        </span>
      )}
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-black text-title">{t('موقعك ومكانك')}</p>
            <button
              type="button"
              onClick={async () => {
                setOpen(false)
                const coords = await geo.fetchNow(false)
                if (coords) onValue(coordsMapsUrl(coords))
              }}
              className="mt-2 flex w-full items-center gap-3 rounded-inner px-1 py-3 text-start hover:bg-brand-soft"
            >
              <LocateFixed className="size-5 text-brand" />
              <span className="text-[13.5px] font-bold text-title">{t('استخدام موقعي الحالي')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                openMaps(mapsSearchUrl(value))
              }}
              className="flex w-full items-start gap-3 rounded-inner px-1 py-3 text-start hover:bg-brand-soft"
            >
              <MapPinned className="mt-0.5 size-5 text-brand" />
              <span className="flex flex-col">
                <span className="text-[13.5px] font-bold text-title">{t('اختيار من الخريطة')}</span>
                <span className="text-[11px] text-muted">{t('تُفتح الخريطة: حدّد المكان ثم انسخ رابطه والصقه في الحقل')}</span>
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
