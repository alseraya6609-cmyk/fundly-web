import { useMemo } from 'react'
import { useSession } from './session'
import { usePersonalAll, useShared } from './data'
import { expenses, contributions, PENDING } from './shared'
import { useSalaryReceipts, titleOf, PENDING as SALARY_PENDING } from './salary'
import { DEBT_PENDING, debtRequestsOf, iAmDebtCreditor, debtOtherParty } from './personalWrite'

/*
  ما ينتظر الرد في «الطلبات» من مصادره (RequestsData.load في التطبيق):
  - approvals «بانتظار اعتمادك»: مصروفات العهدة، طلبات المشتركة، سداد الدين.
  - sent «أرسلتها بانتظار الرد»: إسناد عهدة/دين لم يُقبل، سداد دين بانتظار
    موافقة الدائن، وسند قبض بانتظار اعتماد الموظف.
  وما وصلني للرد عليه (دعوة، إسناد، تفويض، سند) في صندوق الطلبات نفسه.
*/

/** [label] يُترجم، و[value] كما هو: «بانتظار الموافقة من» + «زين». */
export type RequestCardItem = { key: string; title: string; label: string; value: string; to: string; at: string }

const str = (v: unknown) => String(v ?? '').trim()

function rowsOf(raw: unknown): Record<string, unknown>[] {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw ?? []
    return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : []
  } catch {
    return []
  }
}

export function useRequestLists() {
  const { profile } = useSession()
  const me = profile?.fnd_id ?? ''
  const personal = usePersonalAll()
  const shared = useShared()
  const salary = useSalaryReceipts()
  return useMemo(() => {
    const approvals: RequestCardItem[] = []
    const sent: RequestCardItem[] = []
    for (const e of personal.data ?? []) {
      const d = e.details ?? {}
      const owner = str(d['عهدة_مالك_المعرّف'])
      const holder = str(d['عهدة_مسندة_إلى'])
      const state = str(d['عهدة_حالة_الإسناد'])
      const at = e.created_at ?? ''
      if (state === 'بانتظار القبول' && owner === me && holder) {
        sent.push({ key: `p-${e.id}`, title: e.title || e.entry_type, label: 'بانتظار الموافقة من', value: str(d['عهدة_المسند_إليه_الاسم']) || holder, to: `/me?open=${e.id}`, at })
      }
      if (e.entry_type === 'عهدة مالية' && owner === me) {
        const n = rowsOf(d['سجل صرفيات العهدة']).filter((r) => str(r['حالة الاعتماد']) === 'بانتظار الاعتماد').length
        if (n) approvals.push({ key: `c-${e.id}`, title: e.title, label: 'مصروفات بانتظار اعتمادك:', value: String(n), to: `/me?open=${e.id}`, at })
      }
      if (e.entry_type === 'دين / قرض / سلفة' && state === 'مقبولة' && (owner === me || holder === me)) {
        const n = debtRequestsOf(d).filter((r) => r['الحالة'] === DEBT_PENDING).length
        if (n) {
          if (iAmDebtCreditor(d, me)) approvals.push({ key: `d-${e.id}`, title: e.title, label: 'سداد بانتظار موافقتك:', value: String(n), to: `/me?open=${e.id}`, at })
          else sent.push({ key: `d-${e.id}`, title: e.title, label: 'سداد بانتظار موافقة', value: `${debtOtherParty(d, me)}: ${n}`, to: `/me?open=${e.id}`, at })
        }
      }
    }
    for (const e of shared.data ?? []) {
      const d = e.details ?? {}
      if (str(d['معرف المنشئ']) !== me) continue
      const n = expenses(d).filter((x) => x.status === PENDING).length + contributions(d).filter((x) => x.status === PENDING).length
      if (n) approvals.push({ key: `s-${e.id}`, title: e.title, label: 'طلبات بانتظار موافقتك:', value: String(n), to: `/shared?open=${e.id}`, at: e.created_at ?? '' })
    }
    for (const r of salary.data?.mine ?? []) {
      if (r.status !== SALARY_PENDING) continue
      sent.push({ key: `r-${r.id}`, title: titleOf(r), label: 'بانتظار اعتماد', value: r.employee_name, to: `/salary?open=${r.id}`, at: r.created_at ?? '' })
    }
    const newest = (a: RequestCardItem, b: RequestCardItem) => (b.at || '').localeCompare(a.at || '')
    return { approvals: approvals.sort(newest), sent: sent.sort(newest) }
  }, [personal.data, shared.data, salary.data, me])
}
