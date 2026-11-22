import type { Entry } from './data'
import {
  POT,
  approvedContributions,
  approvedExpenses,
  baseShares,
  budget,
  cycleCollected,
  cycleComplete,
  cycleShareOf,
  cycleTarget,
  hasBudget,
  memberNames,
  memberPaid,
  members,
  paidBy,
  remaining,
  roscaPlan,
  shareOf,
  withoutFnd,
  type RoscaCycle,
  type RoscaPlan,
  type Transfer,
} from './shared'
import { roscaWithEnoughEnd } from './sharedWrite'
import { pdfSafeText, type PrintSection, type RecordDoc } from './recordPrint'

/*
  مستندا PDF في الالتزامات المشتركة (shared_commitments_screen.dart):
  - _shareCommitment: البيانات والأعضاء (ومساهمة كل عضو إن كانت ميزانية)،
    ودورات الجمعية والمساهمات المتأخرة.
  - _shareSettlementPdf: التحويلات، وإجمالي المساهمة والمتبقي، ومساهمة الأعضاء.
*/

type D = Record<string, unknown>
type Tr = (s: string) => string

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const asStrings = (d: D): Record<string, string> => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, str(v)]))

/** _money: القيمة المطلقة بلا كسور إن كانت صحيحة. */
export const pdfMoney = (value: number, currency: string) => {
  const abs = Math.abs(value)
  return `${abs.toFixed(abs % 1 === 0 ? 0 : 2)} ${currency}`
}

/** _shownName: بلا رقم FND، والصندوق باسمه. */
const shownName = (t: Tr, name: string) => (name === POT ? t(POT) : withoutFnd(name) || name)

/** _memberMath: ما وضعه العضو (حصته الأساسية + الإضافات المعتمدة) ونصيبه من المصروفات. */
export function memberMath(d: D, name: string) {
  const put = (baseShares(d)[name] ?? 0) + approvedContributions(d).reduce((s, c) => s + (c.member === name ? c.amount : 0), 0)
  const share = approvedExpenses(d).reduce((s, e) => s + (shareOf(e)[name] ?? 0), 0)
  return { put, share }
}

/** _managerName */
function managerName(d: D) {
  const m = members(d).find((x) => x.role === 'مسؤول')
  return m ? m.name.trim() : str(d['مدير الرحلة'] ?? d['المسؤول'])
}

const isRosca = (type: string) => type === 'جمعية مالية' || type === 'جمعية'
const roscaDate = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
const dueText = (c: RoscaCycle) => (c.dueDate ? roscaDate(c.dueDate) : '—')

/** RoscaPlan.statusOf بتسميات PDF (_roscaPdfSections). */
function cycleState(plan: RoscaPlan, c: RoscaCycle, today: Date) {
  if (c.payoutDate.trim()) return 'استلم حصته'
  if (cycleComplete(c)) return 'مكتملة'
  if (c.dueDate && c.dueDate < today) return 'متأخرة'
  if (!plan.current || c.index !== plan.current.index) return 'قادمة'
  return 'نشطة'
}

function roscaSections(d: D, t: Tr, currency: string): PrintSection[] {
  const plan = roscaPlan(d, memberNames(d))
  if (!plan.cycles.length) return []
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const money = (v: number) => pdfMoney(v, currency)
  const late: string[][] = []
  for (const c of plan.cycles) {
    if (!c.dueDate || !(c.dueDate < today)) continue
    for (const m of plan.members) {
      if (memberPaid(c, m)) continue
      // صاحب الدور الذي استلم: حصته خُصمت من مبلغ الدورة.
      if (c.payoutDate.trim() && m === c.receiver) continue
      late.push([pdfSafeText(shownName(t, m)), String(c.index), dueText(c), money(cycleShareOf(c, m) - paidBy(c, m))])
    }
  }
  return [
    {
      title: 'الدورات',
      heads: ['الدورة', 'صاحب الدور', 'تاريخ الاستلام', 'مبلغ الدورة', 'المحصّل', 'الحالة'],
      rows: plan.cycles.map((c) => [
        String(c.index),
        c.receiver.trim() ? pdfSafeText(shownName(t, c.receiver)) : '—',
        dueText(c),
        money(cycleTarget(c)),
        money(cycleCollected(c)),
        pdfSafeText(t(cycleState(plan, c, today))),
      ]),
    },
    ...(late.length ? [{ title: 'مساهمات متأخرة', heads: ['العضو', 'الدورة', 'الموعد', 'المتبقي'], rows: late }] : []),
  ]
}

function dueDmy(iso: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso))
  return m ? `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]}` : str(iso)
}

/** _shareCommitment */
export function commitmentDoc(entry: Entry, opts: { letterhead: boolean; t: Tr; currency: string; status: string }): RecordDoc {
  const { t, currency } = opts
  const d = (entry.details ?? {}) as D
  const rosca = isRosca(entry.entry_type)
  const withBudget = hasBudget(d)
  const money = (v: number) => pdfMoney(v, currency)
  const manager = managerName(d)
  const pairs: [string, string][] = [['النوع', pdfSafeText(t(entry.entry_type))]]
  const amount = Number(entry.amount) || 0
  if (amount > 0) pairs.push(['المبلغ', `${amount} ${currency}`])
  const due = dueDmy(entry.due_date)
  pairs.push(['التاريخ', due || pdfSafeText(t('غير محدد'))])
  pairs.push(['الحالة', pdfSafeText(t(opts.status))])
  if (manager) pairs.push(['المسؤول', pdfSafeText(shownName(t, manager))])
  if (rosca) {
    const ends = roscaWithEnoughEnd(asStrings(d))
    for (const key of ['تاريخ البداية', 'تاريخ النهاية', 'تكرار المساهمة']) if ((ends[key] ?? '').trim()) pairs.push([key, pdfSafeText(t(ends[key].trim()))])
  }
  if (withBudget) {
    pairs.push(['إجمالي المساهمة', money(budget(d))])
    pairs.push(['المتبقي من المساهمة', money(remaining(d))])
  }
  const rows = members(d)
    .filter((m) => m.name.trim())
    .map((m) => [pdfSafeText(shownName(t, m.name)), pdfSafeText(t(m.role)), ...(withBudget ? [money(memberMath(d, m.name).put)] : [])])
  return {
    title: pdfSafeText(entry.title),
    subtitle: 'SHARED COMMITMENT',
    letterhead: opts.letterhead,
    sections: [
      { title: 'البيانات', pairs },
      ...(rows.length ? [{ title: 'الأعضاء', heads: ['العضو', 'الدور', ...(withBudget ? ['المساهمة'] : [])], rows }] : []),
      ...(rosca ? roscaSections(d, t, currency) : []),
    ],
  }
}

/** _shareSettlementPdf: بترويسة دائمًا كما في التطبيق. */
export function settlementDoc(entry: Entry, transfers: Transfer[], date: string, opts: { t: Tr; currency: string; memberList: string[] }): RecordDoc {
  const { t, currency } = opts
  const d = (entry.details ?? {}) as D
  const money = (v: number) => pdfMoney(v, currency)
  const sum = transfers.reduce((s, x) => s + x.amount, 0)
  const withBudget = hasBudget(d)
  const pairs: [string, string][] = [
    ['الالتزام', pdfSafeText(entry.title)],
    ['التاريخ', date],
    ['مجموع التسوية', money(sum)],
  ]
  if (withBudget) {
    pairs.push(['إجمالي المساهمة', money(budget(d))])
    pairs.push(['المتبقي من المساهمة', money(remaining(d))])
  }
  return {
    title: `${t('تسوية حساب')} — ${pdfSafeText(entry.title)}`,
    subtitle: 'SETTLEMENT',
    letterhead: true,
    sections: [
      { title: 'البيانات', pairs },
      ...(transfers.length
        ? [{ title: 'التحويلات', heads: ['من', 'إلى', 'المبلغ'], rows: transfers.map((x) => [pdfSafeText(shownName(t, x.from)), pdfSafeText(shownName(t, x.to)), money(x.amount)]) }]
        : []),
      ...(withBudget
        ? [
            {
              title: 'مساهمة الأعضاء',
              heads: ['العضو', 'المساهمة', 'نصيبه من المصروفات'],
              rows: opts.memberList.map((name) => {
                const m = memberMath(d, name)
                return [pdfSafeText(shownName(t, name)), money(m.put), money(m.share)]
              }),
            },
          ]
        : []),
    ],
  }
}
