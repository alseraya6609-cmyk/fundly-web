import type { ReactNode } from 'react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { date, money } from '@/lib/format'
import {
  POT,
  PENDING,
  acceptances,
  budget,
  contributions,
  cycleCollected,
  cycleStatus,
  cycleTarget,
  expenses,
  fndIn,
  hasBudget,
  memberNets,
  memberNames,
  members,
  remaining,
  roscaPlan,
  settleTransfers,
  settlements,
  total,
  totalsByCategory,
  withoutFnd,
} from '@/lib/shared'
import { startOfToday } from '@/lib/metrics'
import { FileButton } from './FileButton'

const STATUS_COLOR: Record<string, string> = {
  مكتملة: '#0A5A50',
  متأخرة: '#C4392E',
  جارية: '#CE8422',
  قادمة: '#8C9A97',
}

function Block({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t(title)}
        {count !== undefined && <span className="rounded-full bg-surface px-2 text-[11px] text-sub">{count}</span>}
      </p>
      <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">{children}</div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const { t } = useI18n()
  return (
    <div className="card-inner px-3 py-2">
      <p className="text-[11px] text-muted">{t(label)}</p>
      <p className="text-[15px] font-extrabold" style={{ color: color ?? '#0F1F1C' }}>
        {value}
      </p>
    </div>
  )
}

/**
 * تفاصيل الالتزام المشترك كما يعرضها التطبيق: الأعضاء ودعواتهم، والميزانية
 * والمصروفات والأرصدة والتسوية، أو دورات الجمعية. للعرض فقط.
 */
export function SharedDetails({ details, entryType, currency }: { details: Record<string, unknown>; entryType: string; currency: string }) {
  const { t } = useI18n()
  const { profile } = useSession()
  const fnd = profile?.fnd_id ?? ''
  const cur = t(String(details['العملة'] ?? '').trim() || currency)
  const list = members(details)
  const names = memberNames(details)
  const replies = acceptances(details)
  const isCircle = entryType === 'جمعية مالية' || entryType === 'جمعية'
  const shown = (name: string) => (name === POT ? t(POT) : withoutFnd(name) || name)

  return (
    <div>
      {list.length > 0 && (
        <Block title="الأعضاء" count={list.length}>
          {list.map((m, i) => {
            const id = fndIn(m.name)
            const reply = id ? replies[id]?.state : ''
            const state = reply === 'accepted' ? 'قبِل' : reply === 'rejected' ? 'رفض' : reply === 'cancelled' ? 'أُلغيت الدعوة' : ''
            return (
              <div key={i} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span dir="auto" className="text-[13px] font-bold text-ink">
                  {withoutFnd(m.name) || m.name}
                  {id && id === fnd ? <span className="ms-1 text-[11px] text-brand">({t('أنا')})</span> : null}
                </span>
                <span className="text-[11px] text-muted">
                  {t(m.role)}
                  {state ? ` · ${t(state)}` : ''}
                </span>
              </div>
            )
          })}
        </Block>
      )}
      {isCircle ? <CircleView details={details} names={names} cur={cur} shown={shown} /> : <LedgerView details={details} names={names} cur={cur} shown={shown} />}
    </div>
  )
}

function CircleView({ details, names, cur, shown }: { details: Record<string, unknown>; names: string[]; cur: string; shown: (n: string) => string }) {
  const { t } = useI18n()
  const plan = roscaPlan(details, names)
  if (!plan.cycles.length) return null
  const today = startOfToday()
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Stat label="المساهمة على الشخص" value={money(plan.share, cur)} />
        <Stat label="تكرار المساهمة" value={t(plan.frequency)} />
        <Stat label="الدورة الجارية" value={plan.current ? `${plan.current.index} / ${plan.cycles.length}` : t('مكتملة')} />
        <Stat
          label="المستلم الحالي"
          value={plan.current ? shown(plan.current.receiver) || '—' : '—'}
        />
      </div>
      <Block title="الدورات" count={plan.cycles.length}>
        {plan.cycles.map((c) => {
          const status = cycleStatus(plan, c, today)
          return (
            <details key={c.index} className="card-inner px-3 py-2" open={plan.current?.index === c.index}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-extrabold text-title">
                  {t('الدورة رقم')} {c.index}
                  {c.receiver ? <span className="font-bold text-sub"> — {shown(c.receiver)}</span> : null}
                </span>
                <span className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted">{c.dueDate ? date(c.dueDate) : '—'}</span>
                  <span className="rounded-full px-2 py-0.5 font-bold text-white" style={{ background: STATUS_COLOR[status] }}>
                    {t(status)}
                  </span>
                </span>
              </summary>
              <p className="mt-1 text-[11px] text-sub">
                {t('المحصّل')}: {money(cycleCollected(c), cur)} / {money(cycleTarget(c), cur)}
                {c.payoutDate ? ` · ${t('سُلّم المبلغ')}: ${c.payoutDate}` : ''}
              </p>
              {c.payments.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
                  {c.payments.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-bold text-ink">{shown(p.member)}</span>
                      <span className="text-muted">{p.date}</span>
                      <span className="font-bold text-brand">{money(p.amount, cur)}</span>
                      {p.receipt && <FileButton file={{ localPath: p.receipt }} label="الإيصال" />}
                    </div>
                  ))}
                </div>
              )}
            </details>
          )
        })}
      </Block>
    </>
  )
}

function LedgerView({ details, names, cur, shown }: { details: Record<string, unknown>; names: string[]; cur: string; shown: (n: string) => string }) {
  const { t } = useI18n()
  const all = expenses(details)
  const contribs = contributions(details)
  const settles = settlements(details)
  if (!all.length && !contribs.length && !settles.length && !hasBudget(details)) return null
  const spent = total(details)
  const nets = memberNets(details, names)
  const transfers = settleTransfers(details, names)
  const byCategory = totalsByCategory(details)

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="إجمالي المصروفات" value={money(spent, cur)} />
        {hasBudget(details) && <Stat label="الميزانية" value={money(budget(details), cur)} />}
        {hasBudget(details) && (
          <Stat label="المتبقي" value={money(remaining(details), cur)} color={remaining(details) < -0.01 ? '#C4392E' : '#0A5A50'} />
        )}
      </div>

      {byCategory.length > 0 && (
        <Block title="المصروفات حسب التصنيف">
          {byCategory.map(([cat, v]) => (
            <div key={cat} className="card-inner flex items-center justify-between px-3 py-2 text-[12px]">
              <span className="font-bold text-ink">{t(cat)}</span>
              <span className="text-sub">{money(v, cur)}</span>
            </div>
          ))}
        </Block>
      )}

      {Object.keys(nets).length > 0 && (
        <Block title="الأرصدة">
          {Object.entries(nets).map(([name, v]) => (
            <div key={name} className="card-inner flex items-center justify-between px-3 py-2 text-[12px]">
              <span dir="auto" className="font-bold text-ink">
                {shown(name)}
              </span>
              <span className="font-bold" style={{ color: v > 0.01 ? '#0A5A50' : v < -0.01 ? '#C4392E' : '#8C9A97' }}>
                {v > 0.01 ? `${t('له')} ${money(v, cur)}` : v < -0.01 ? `${t('عليه')} ${money(-v, cur)}` : t('متعادل')}
              </span>
            </div>
          ))}
        </Block>
      )}

      {transfers.length > 0 && (
        <Block title="التسوية المقترحة" count={transfers.length}>
          {transfers.map((tr, i) => (
            <div key={i} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
              <span dir="auto" className="text-ink">
                <b>{shown(tr.from)}</b> {t('يدفع إلى')} <b>{shown(tr.to)}</b>
              </span>
              <span className="font-bold text-gold-dark">{money(tr.amount, cur)}</span>
            </div>
          ))}
        </Block>
      )}

      {all.length > 0 && (
        <Block title="المصروفات" count={all.length}>
          {all.map((e) => (
            <div key={e.id} className="card-inner px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span dir="auto" className="font-bold text-ink">
                  {e.description || t('مصروف')}
                </span>
                <span className="font-bold text-ink">{money(e.amount, cur)}</span>
              </div>
              <p className="text-[11px] text-muted">
                {t('دفع')}: {shown(e.payer)} · {e.date} · {t(e.category)} · {t(e.method)}
                {e.status !== 'معتمد' && <span className={e.status === PENDING ? 'font-bold text-gold-dark' : 'font-bold text-danger'}> · {t(e.status)}</span>}
              </p>
              {e.receipt && <FileButton className="mt-1" file={{ localPath: e.receipt }} label="الفاتورة" />}
            </div>
          ))}
        </Block>
      )}

      {contribs.length > 0 && (
        <Block title="المساهمات" count={contribs.length}>
          {contribs.map((c) => (
            <div key={c.id} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
              <span className="font-bold text-ink">{shown(c.member)}</span>
              <span className="text-muted">{c.date}</span>
              <span className="font-bold text-brand">
                {money(c.amount, cur)}
                {c.status !== 'معتمد' ? ` · ${t(c.status)}` : ''}
              </span>
              {c.receipt && <FileButton file={{ localPath: c.receipt }} label="الإيصال" />}
            </div>
          ))}
        </Block>
      )}

      {settles.length > 0 && (
        <Block title="التسويات" count={settles.length}>
          {settles.map((s) => (
            <div key={s.id} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
              <span dir="auto" className="text-ink">
                <b>{shown(s.from)}</b> {t('دفع إلى')} <b>{shown(s.to)}</b>
              </span>
              <span className="text-muted">{s.date}</span>
              <span className="font-bold text-brand">{money(s.amount, cur)}</span>
              {s.receipt && <FileButton file={{ localPath: s.receipt }} label="الإيصال" />}
            </div>
          ))}
        </Block>
      )}
    </>
  )
}
