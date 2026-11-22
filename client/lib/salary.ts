import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useSession } from './session'
import { upsertDirectoryPerson } from './peopleWrite'

/*
  سندات القبض والرواتب كما في التطبيق (salary_receipts.dart و
  salary_receipts_screen.dart و salary_income_sync.dart):
  - الجدول fundly_salary_receipts: ما أصدرته (user_id) وما أُرسل إلى رقمي
    (employee_fnd).
  - التوقيع خطوط بنقاط نسبية 0..1 داخل مربّع، JSON بثلاث خانات عشرية.
  - المرسِل: مصروف مرتبط في «أنا» («سند القبض» = رقم السند) يصير «مكتملة»
    عند الاعتماد و«ملغاة» عند الرفض، ويُضاف المستلم إلى «الأفراد والجهات».
  - المستلم: الموافقة بتوقيع أو الرفض بسبب عبر fundly_salary_respond، والسند
    المعتمد يصير إيرادًا «مكتملة» عنده مرة واحدة.
*/

export const KIND_SALARY = 'راتب'
export const KIND_GENERAL = 'عام'
export const SIGN_HERE = 'here'
export const SIGN_REMOTE = 'remote'
export const PARTIES_EMPLOYER = 'employer'
export const PARTIES_HANDOVER = 'handover'
export const PENDING = 'بانتظار الاعتماد'
export const APPROVED = 'معتمد'
export const REJECTED = 'مرفوض'
export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const TABLE = 'fundly_salary_receipts'
const RECEIPT_KEY = 'سند القبض'

export type Receipt = {
  id: string
  user_id: string
  kind: string
  employee_fnd: string
  employee_name: string
  owner_name: string
  period: string
  receipt_date: string
  basic: number
  allowances: number
  overtime: number
  loan: number
  deductions: number
  total: number
  paid: number
  currency: string
  description: string
  notes: string
  sign_mode: string
  status: string
  signature: string
  signed_at: string | null
  reject_reason: string
  expense_id: string
  created_at: string | null
  parties: string
}

const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '')) || 0)
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function receiptOf(j: Record<string, unknown>): Receipt {
  return {
    id: s(j.id),
    user_id: s(j.user_id),
    kind: s(j.kind) || KIND_SALARY,
    employee_fnd: s(j.employee_fnd),
    employee_name: s(j.employee_name),
    owner_name: s(j.owner_name),
    period: s(j.period),
    receipt_date: s(j.receipt_date),
    basic: num(j.basic),
    allowances: num(j.allowances),
    overtime: num(j.overtime),
    loan: num(j.loan),
    deductions: num(j.deductions),
    total: num(j.total),
    paid: num(j.paid),
    currency: s(j.currency),
    description: s(j.description),
    notes: s(j.notes),
    sign_mode: s(j.sign_mode) || SIGN_HERE,
    status: s(j.status) || PENDING,
    signature: s(j.signature),
    signed_at: j.signed_at ? s(j.signed_at) : null,
    reject_reason: s(j.reject_reason),
    expense_id: s(j.expense_id),
    created_at: j.created_at ? s(j.created_at) : null,
    parties: s(j.parties) === PARTIES_HANDOVER ? PARTIES_HANDOVER : PARTIES_EMPLOYER,
  }
}

export const isSalary = (r: Pick<Receipt, 'kind'>) => r.kind === KIND_SALARY
export const isHandover = (r: Pick<Receipt, 'parties'>) => r.parties === PARTIES_HANDOVER
export const payerLabel = (r: Receipt) => (isHandover(r) ? 'المسلّم' : 'صاحب العمل')
export const payeeLabel = (r: Receipt) => (isSalary(r) && !isHandover(r) ? 'الموظف المستلم' : 'المستلم')
export const signHereLabel = (r: Pick<Receipt, 'parties'>) => (isHandover(r) ? 'وقّع على جوال المسلّم' : 'وقّع على جوال صاحب العمل')
export const yearOf = (r: Receipt) => parseInt(r.period.split('-')[0], 10) || null
export const monthOf = (r: Receipt) => parseInt(r.period.split('-')[1] ?? '', 10) || null
export const periodOf = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`

/** «مارس 2026». */
export function periodLabel(r: Receipt, tr: (x: string) => string = (x) => x): string {
  const m = monthOf(r)
  const y = yearOf(r)
  if (!m || !y || m < 1 || m > 12) return r.period
  return `${tr(MONTHS[m - 1])} ${y}`
}
/** «راتب مارس 2026» أو بيان السند العام. */
export function titleOf(r: Receipt, tr: (x: string) => string = (x) => x): string {
  return isSalary(r) ? `${tr('راتب')} ${periodLabel(r, tr)}` : r.description.trim() || tr('سند قبض')
}
/** رقم السند: أول 8 خانات من المعرّف. */
export const receiptNo = (r: Receipt) => {
  const id = r.id.replace(/-/g, '')
  return id ? id.slice(0, 8).toUpperCase() : '—'
}
export const plainNum = (v: number) => v.toFixed(Math.abs(v) % 1 === 0 ? 0 : 2)
export const dayOf = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`

// ---------------- التوقيع ----------------

export type Stroke = [number, number][]
export function decodeStrokes(raw: string): Stroke[] {
  if (!raw.trim()) return []
  try {
    const decoded = JSON.parse(raw)
    if (!Array.isArray(decoded)) return []
    return decoded
      .filter((st: unknown) => Array.isArray(st))
      .map((st: unknown[]) => st.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [Number((p as number[])[0]), Number((p as number[])[1])] as [number, number]))
      .filter((st: Stroke) => st.length > 0)
  } catch {
    return []
  }
}
export const encodeStrokes = (strokes: Stroke[]) => JSON.stringify(strokes.map((st) => st.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))])))

// ---------------- القراءة ----------------

const sorted = (list: Receipt[]) =>
  list.sort((a, b) => {
    const byPeriod = b.period.localeCompare(a.period)
    if (byPeriod) return byPeriod
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })

export function useSalaryReceipts() {
  const { user, profile } = useSession()
  const fnd = profile?.fnd_id ?? ''
  return useQuery({
    queryKey: ['salary', user?.id, fnd],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: mineRows, error } = await supabase.from(TABLE).select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
      if (error) throw error
      let toMeRows: Record<string, unknown>[] = []
      if (fnd) {
        const res = await supabase.from(TABLE).select('*').eq('employee_fnd', fnd).order('created_at', { ascending: false })
        if (res.error) throw res.error
        toMeRows = (res.data ?? []) as Record<string, unknown>[]
      }
      const mine = sorted(((mineRows ?? []) as Record<string, unknown>[]).map(receiptOf))
      const toMe = sorted(toMeRows.map(receiptOf))
      return { mine, toMe }
    },
  })
}

// ---------------- الكتابة ----------------

export class SalaryError extends Error {}

export type Draft = Omit<Receipt, 'id' | 'user_id' | 'created_at'> & { id?: string }

function rowOf(d: Draft): Record<string, unknown> {
  const row: Record<string, unknown> = {
    kind: d.kind,
    employee_fnd: d.employee_fnd,
    employee_name: d.employee_name,
    owner_name: d.owner_name,
    period: d.period,
    receipt_date: d.receipt_date,
    basic: d.basic,
    allowances: d.allowances,
    overtime: d.overtime,
    loan: d.loan,
    deductions: d.deductions,
    total: d.total,
    paid: d.paid,
    currency: d.currency,
    description: d.description,
    notes: d.notes,
    sign_mode: d.sign_mode,
    status: d.status,
    signature: d.signature,
    signed_at: d.signed_at,
    reject_reason: d.reject_reason,
    expense_id: d.expense_id,
  }
  // يُرسل فقط مع «المسلّم والمستلم» (كما في التطبيق).
  if (d.parties === PARTIES_HANDOVER) row.parties = d.parties
  return row
}

/** _withPartiesFallback: عمود parties غير موجود بعد ← يُحفظ بدونه. */
async function write(row: Record<string, unknown>, run: (row: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Record<string, unknown>> {
  let res = await run(row)
  if (res.error && 'parties' in row && String((res.error as { message?: string }).message ?? '').toLowerCase().includes('parties')) {
    const { parties: _drop, ...rest } = row
    void _drop
    res = await run(rest)
  }
  if (res.error) throw res.error
  return (res.data ?? {}) as Record<string, unknown>
}

const databaseDate = (value: string) => {
  const p = value.split('/')
  if (p.length !== 3) return value || null
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** _syncExpense: مصروف «أنا» المرتبط بالسند. يعيد معرّفه. */
async function syncExpense(r: Receipt, tr: (x: string) => string): Promise<string> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return ''
  void tr
  const title = `${titleOf(r)} — ${r.employee_name}`
  const details: Record<string, string> = {
    المبلغ: plainNum(r.paid),
    'التصنيف الرئيسي': isSalary(r) ? 'رواتب' : 'مصروفات أخرى',
    التاريخ: r.receipt_date,
    العنوان: title,
    ...(r.notes.trim() ? { الملاحظات: r.notes.trim() } : {}),
    'جهة الصرف': r.employee_name,
    'الفرد المرتبط': r.employee_name,
    [RECEIPT_KEY]: r.id,
  }
  const record = {
    category: 'financial',
    entry_type: 'المصروفات الشخصية',
    title,
    amount: Math.round(r.paid),
    due_date: databaseDate(r.receipt_date),
    status: r.status === APPROVED ? 'مكتملة' : 'نشطة',
    details,
  }
  if (r.expense_id) {
    const { data } = await supabase.from('personal_entries').update(record).eq('id', r.expense_id).select('id')
    if (data && data.length) return r.expense_id
  }
  const { data, error } = await supabase.from('personal_entries').insert({ user_id: uid, ...record, attachment_url: null }).select('id').single()
  if (error) throw error
  return String((data as { id: string }).id)
}

/** حفظ السند (إضافة أو تعديل)، ثم مصروفه، ثم المستلم في «الأفراد والجهات». */
export async function saveReceipt(d: Draft, tr: (x: string) => string, employeeWords: boolean): Promise<Receipt> {
  const row = rowOf(d)
  const returned = d.id
    ? await write(row, (body) => supabase.from(TABLE).update(body).eq('id', d.id!).select('*').single())
    : await write(row, (body) => supabase.from(TABLE).insert(body).select('*').single())
  // ما أُرسل مع ما أعاده الخادم (المعرّف والتواريخ).
  let saved = receiptOf({ ...row, parties: d.parties, ...returned })
  try {
    const expenseId = await syncExpense(saved, tr)
    if (expenseId && expenseId !== saved.expense_id) {
      const { data } = await supabase.from(TABLE).update({ expense_id: expenseId }).eq('id', saved.id).select('*').single()
      if (data) saved = receiptOf(data as Record<string, unknown>)
    }
  } catch {
    // المصروف خدمة مساعدة: فشله لا يُفشل حفظ السند (كما في التطبيق).
  }
  if (d.employee_fnd) {
    await upsertDirectoryPerson({
      fullName: d.employee_name,
      typeKey: employeeWords ? 'person_employee' : 'person_other',
      categoryName: employeeWords ? 'موظف' : 'أخرى',
      roleTitle: employeeWords ? 'موظف' : '',
      details: { 'الرقم التعريفي': d.employee_fnd },
      sourceNote: 'سند قبض',
    }).catch(() => {})
  }
  return saved
}

/** حذف السند ومصروفه. */
export async function deleteReceipt(r: Receipt) {
  if (r.expense_id) await supabase.from('personal_entries').delete().eq('id', r.expense_id)
  const { error } = await supabase.from(TABLE).delete().eq('id', r.id)
  if (error) throw error
}

/** _cancelRejectedExpenses: المرفوض ← مصروفه «ملغاة»، والمعتمد ← «مكتملة». */
export async function syncOwnerExpenses(mine: Receipt[]) {
  const rejected = mine.filter((r) => r.status === REJECTED && r.expense_id).map((r) => r.expense_id)
  const approved = mine.filter((r) => r.status === APPROVED && r.expense_id).map((r) => r.expense_id)
  if (!rejected.length && !approved.length) return
  const ids = [...rejected, ...approved]
  const { data } = await supabase.from('personal_entries').select('id, status').in('id', ids)
  for (const row of (data ?? []) as { id: string; status: string }[]) {
    if (rejected.includes(row.id)) {
      if (row.status === 'ملغاة' || row.status === 'محذوف') continue
      await supabase.from('personal_entries').update({ status: 'ملغاة' }).eq('id', row.id)
    } else if (approved.includes(row.id) && row.status === 'نشطة') {
      await supabase.from('personal_entries').update({ status: 'مكتملة' }).eq('id', row.id)
    }
  }
}

/** رد المستلم (fundly_salary_respond). null عند النجاح أو رسالة السبب. */
export async function respondReceipt(r: Receipt, accept: boolean, signature: string, reason: string, tr: (x: string) => string): Promise<string | null> {
  const { data, error } = await supabase.rpc('fundly_salary_respond', { p_id: r.id, p_accept: accept, p_signature: signature, p_reason: reason, p_name: '' })
  if (error) return 'تعذّر الحفظ. حاول مرة أخرى.'
  const result = String(data ?? '')
  const message =
    result === 'ok'
      ? null
      : result === 'answered'
        ? 'سبق الرد على هذا السند'
        : result === 'no_signature'
          ? 'التوقيع مطلوب للموافقة'
          : result === 'no_name'
            ? 'اكتب اسمك الثلاثي لإكمال الاعتماد'
            : result === 'not_yours' || result === 'not_found'
              ? 'لم يعد هذا السند قائمًا'
              : 'تعذّر الحفظ. حاول مرة أخرى.'
  if (message === null && accept) await addIncome(r, tr).catch(() => {})
  return message
}

/** SalaryIncomeSync.incomeFor — مرة واحدة لكل سند. */
async function addIncome(r: Receipt, tr: (x: string) => string) {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return
  void tr
  const { data: existing } = await supabase.from('personal_entries').select('id, details').eq('user_id', uid).eq('entry_type', 'إيراد')
  if ((existing ?? []).some((x) => String((x as { details?: Record<string, unknown> }).details?.[RECEIPT_KEY] ?? '') === r.id)) return
  const from = r.owner_name.trim()
  const base = titleOf(r)
  const title = from ? `${base} — ${from}` : base
  const details: Record<string, string> = {
    المبلغ: plainNum(r.paid),
    'التصنيف الرئيسي': isSalary(r) ? 'الراتب/معاش' : 'سند قبض',
    ...(isSalary(r) ? { 'التصنيف الفرعي': 'الراتب' } : {}),
    التاريخ: r.receipt_date,
    العنوان: title,
    ...(r.notes.trim() ? { الملاحظات: r.notes.trim() } : {}),
    ...(from ? { 'جهة الصرف': from } : {}),
    [RECEIPT_KEY]: r.id,
  }
  await supabase.from('personal_entries').insert({
    user_id: uid,
    category: 'financial',
    entry_type: 'إيراد',
    title,
    amount: Math.round(r.paid),
    due_date: databaseDate(r.receipt_date),
    status: 'مكتملة',
    details,
    attachment_url: null,
  })
}
