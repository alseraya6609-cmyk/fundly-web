import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { Stroke } from '@/lib/salary'
import { Sheet } from './ui'

/*
  لوحة التوقيع (signature_pad.dart): مربّع يُرسم فيه بالإصبع أو الفأرة، والنقاط
  نسبية (0..1) إلى ضلعه — فيُعرض التوقيع بالشكل نفسه في التطبيق والموقع.
*/

export function SignatureView({ strokes, className = '' }: { strokes: Stroke[]; className?: string }) {
  return (
    <svg viewBox="0 0 1 1" className={className} preserveAspectRatio="xMidYMid meet">
      {strokes.map((st, i) =>
        st.length === 1 ? (
          <circle key={i} cx={st[0][0]} cy={st[0][1]} r={0.006} fill="#0F1F1C" />
        ) : (
          <polyline key={i} points={st.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#0F1F1C" strokeWidth={0.012} strokeLinecap="round" strokeLinejoin="round" />
        ),
      )}
    </svg>
  )
}

export function SignaturePad({ open, title, subtitle, onClose, onDone }: { open: boolean; title: string; subtitle: string; onClose: () => void; onDone: (strokes: Stroke[]) => void }) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const drawing = useRef(false)
  useEffect(() => {
    if (!open) setStrokes([])
  }, [open])

  const point = (e: React.PointerEvent): [number, number] => {
    const rect = box.current!.getBoundingClientRect()
    const side = rect.width
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    return [clamp((e.clientX - rect.left) / side), clamp((e.clientY - rect.top) / side)]
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-sub">{subtitle}</p>
      <div
        ref={box}
        className="mt-4 aspect-square w-full touch-none select-none rounded-inner border-2 border-dashed border-line bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          setStrokes((x) => [...x, [point(e)]])
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const p = point(e)
          setStrokes((x) => {
            if (!x.length) return x
            const last = x[x.length - 1]
            return [...x.slice(0, -1), [...last, p]]
          })
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      >
        <SignatureView strokes={strokes} className="pointer-events-none size-full" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => setStrokes([])} className="flex h-12 items-center justify-center gap-1.5 rounded-field border border-line text-[13.5px] font-extrabold text-ink">
          <Eraser className="size-4" />
          {t('مسح')}
        </button>
        <button
          type="button"
          disabled={!strokes.length}
          onClick={() => onDone(strokes)}
          className="col-span-2 h-12 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {t('اعتماد التوقيع')}
        </button>
      </div>
    </Sheet>
  )
}
