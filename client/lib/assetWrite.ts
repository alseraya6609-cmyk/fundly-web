import { supabase } from './supabase'
import type { AssetEntry, UnitPayment } from './data'
import { changeReminders, isoOf, reminderDays } from './reminders'

/*
  سجلات الأصل (project_asset_entries) كما في التطبيق
  (projects_activities_screen.dart ← _groups و_persistEntry و_deleteEntry):
  العقود والصيانة والإيجارات والمصروفات والإيرادات والمستندات، و«المتابعة
  والتخطيط» (سجلات rental بنوع متابعة). البيانات = كل حقول النموذج نصًّا مع
  _reminder_id، ومن له «تاريخ الانتهاء» يُسجَّل تذكيره. العقود والحركات
  المالية والإيجارات لا تُحذف — تُعدَّل فقط.
*/

export type AssetField = { label: string; numeric?: boolean; date?: boolean; multiline?: boolean; file?: boolean; options?: string[]; required?: boolean; display?: string }
export type AssetGroup = { key: string; kind: string; title: string; addTitle?: string; fields: AssetField[] }

export const FILE_FIELD = 'الملف المرفق'
const LEADS = ['قبل أسبوع', 'قبل يوم', 'قبل 3 أيام', 'قبل أسبوعين', 'قبل شهر']
const DOC_TYPES = ['عقود', 'إيصال', 'ضمان', 'فاتورة', 'تقرير ضريبي', 'إنذار', 'مستندات أخرى']
export const FOLLOW_KINDS = ['مهمة', 'موعد', 'عادة يومية', 'تذكير', 'ملاحظات']

export const ASSET_GROUPS_W: AssetGroup[] = [
  {
    key: 'contract',
    kind: 'contract',
    title: 'العقود',
    fields: [
      { label: 'اسم العقد', required: true },
      { label: FILE_FIELD, file: true },
      { label: 'الطرف الآخر' },
      { label: 'تاريخ البداية', date: true },
      { label: 'تاريخ الانتهاء', date: true },
      { label: 'التذكير قبل الانتهاء', options: LEADS },
      { label: 'قيمة العقد', numeric: true },
      { label: 'ملاحظات', multiline: true },
    ],
  },
  {
    key: 'maintenance',
    kind: 'maintenance',
    title: 'الصيانة',
    fields: [{ label: 'وصف العطل' }, { label: 'الأولوية' }, { label: 'تاريخ الطلب', date: true }, { label: 'تاريخ التنفيذ', date: true }, { label: 'التكلفة', numeric: true }, { label: 'الفني / المقاول' }],
  },
  {
    key: 'rental',
    kind: 'rental',
    title: 'الإيجارات',
    fields: [{ label: 'اسم المستأجر', required: true }, { label: 'الوحدة / الرقم' }, { label: 'قيمة الإيجار', numeric: true }, { label: 'تاريخ البداية', date: true }, { label: 'تاريخ الانتهاء', date: true }, { label: 'دورة الدفع' }],
  },
  {
    key: 'expense',
    kind: 'expense',
    title: 'المصروفات',
    fields: [
      { label: 'البند', display: 'التصنيف', required: true },
      { label: 'المبلغ', numeric: true, required: true },
      { label: 'تاريخ المصروف', date: true, required: true },
      { label: 'الفئة' },
      { label: 'ملاحظات', multiline: true },
      { label: FILE_FIELD, file: true },
    ],
  },
  {
    key: 'revenue',
    kind: 'revenue',
    title: 'الإيرادات',
    addTitle: 'إضافة دخل إضافي',
    fields: [
      { label: 'المصدر', required: true },
      { label: 'المبلغ', numeric: true, required: true },
      { label: 'تاريخ الإيراد', date: true },
      { label: 'الفئة' },
      { label: 'ملاحظات', multiline: true },
      { label: FILE_FIELD, file: true },
    ],
  },
  {
    key: 'document',
    kind: 'document',
    title: 'المستندات',
    fields: [
      { label: 'اسم المستند', required: true },
      { label: 'نوع المستند', options: DOC_TYPES },
      { label: 'تاريخ الانتهاء', date: true },
      { label: 'التذكير قبل الانتهاء', options: LEADS },
      { label: 'ملاحظات', multiline: true },
      { label: FILE_FIELD, file: true },
    ],
  },
  {
    key: 'follow',
    kind: 'rental',
    title: 'المتابعة والتخطيط',
    fields: [{ label: 'العنوان', required: true }, { label: 'نوع المتابعة', options: FOLLOW_KINDS, required: true }, { label: 'التاريخ', date: true }, { label: 'التفاصيل', multiline: true }],
  },
]

/** نموذج السجل: المتابعة سجل rental فيه «نوع المتابعة». */
export function groupOf(entry: AssetEntry): AssetGroup | undefined {
  if (entry.kind === 'rental' && 'نوع المتابعة' in (entry.data ?? {})) return ASSET_GROUPS_W.find((g) => g.key === 'follow')
  return ASSET_GROUPS_W.find((g) => g.key === entry.kind)
}

const NO_DELETE = new Set(['contract', 'rental', 'revenue', 'expense'])
export const canDeleteEntry = (entry: AssetEntry) => !NO_DELETE.has(entry.kind)

export class AssetError extends Error {}

/** «أكمل: …» — الإلزامية والحقل الأول دائمًا. */
export function validateEntry(group: AssetGroup, values: Record<string, string>): string | null {
  const first = group.fields[0].label
  const missing = group.fields.filter((f) => (f.required || f.label === first) && !(values[f.label] ?? '').trim()).map((f) => f.display ?? f.label)
  return missing.length ? `أكمل:| |${missing.join('|، |')}` : null
}

async function uid() {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new AssetError('انتهت الجلسة — ادخل من جديد')
  return data.user.id
}

/** _syncEntryReminder: لما فيه «تاريخ الانتهاء». */
async function syncReminder(group: AssetGroup, data: Record<string, string>, assetTitle: string) {
  const id = data['_reminder_id'] ?? ''
  if (!id) return
  const expiry = isoOf(data['تاريخ الانتهاء'] ?? '')
  if (!expiry) {
    if ('تاريخ الانتهاء' in data) await changeReminders([], [id])
    return
  }
  void assetTitle
  await changeReminders([{ id, title: data[group.fields[0].label] || group.title, module: 'العقارات والأنشطة التجارية', expiryDate: expiry, remindBeforeDays: reminderDays(data['التذكير قبل الانتهاء'] ?? '') }])
}

/** إضافة سجل أو تعديله (upsertEntry): البيانات القائمة تبقى، وحقول النموذج تُستبدل. */
export async function saveEntry(assetId: string, assetTitle: string, group: AssetGroup, values: Record<string, string>, existing?: AssetEntry) {
  const problem = validateEntry(group, values)
  if (problem) throw new AssetError(problem)
  const user = await uid()
  const base: Record<string, string> = Object.fromEntries(Object.entries(existing?.data ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]))
  const data: Record<string, string> = { ...base }
  for (const f of group.fields) data[f.label] = (values[f.label] ?? '').trim()
  if (group.key === 'follow') data['نوع المتابعة'] = (values['نوع المتابعة'] ?? '').trim()
  data['_reminder_id'] = base['_reminder_id'] || `asset-entry-${Date.now() * 1000}`
  delete data['_id']
  if (existing) {
    const { data: saved, error } = await supabase.from('project_asset_entries').update({ data }).eq('id', existing.id).select('id')
    if (error) throw error
    if (!saved || !saved.length) throw new AssetError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
  } else {
    const { error } = await supabase.from('project_asset_entries').insert({ user_id: user, asset_id: assetId, kind: group.kind, data, attachment_url: null })
    if (error) throw error
  }
  await syncReminder(group, data, assetTitle).catch(() => {})
}

/** _deleteEntry: المستندات والصيانة والمتابعة فقط. */
export async function deleteEntry(entry: AssetEntry) {
  if (!canDeleteEntry(entry)) throw new AssetError('العقود والحركات المالية لا تُحذف — للتصحيح استعمل «تعديل»')
  const { error } = await supabase.from('project_asset_entries').delete().eq('id', entry.id)
  if (error) throw error
  const reminder = String(entry.data?.['_reminder_id'] ?? '')
  if (reminder) await changeReminders([], [reminder]).catch(() => {})
}

// ---------------- سداد دفعات عقود الوحدات (rent_payments_view.dart ← _settle) ----------------


/** decodePayExtra: ملاحظات الدفعة JSON (نوعها واسمها وطريقة دفعها...). */
export function payExtra(notes: string | null): Record<string, string> {
  const text = (notes ?? '').trim()
  if (!text) return {}
  if (!text.startsWith('{')) return { ملاحظة: text }
  try {
    const decoded = JSON.parse(text)
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return { ملاحظة: text }
    return Object.fromEntries(Object.entries(decoded).filter(([k]) => k !== '__pay__').map(([k, v]) => [k, String(v ?? '').trim()]))
  } catch {
    return { ملاحظة: text }
  }
}

/** الشيك يُسدَّد كاملًا فقط. */
export const isCheque = (p: UnitPayment) => payExtra(p.notes)['طريقة الدفع'] === 'شيك'

const localIso = (d: Date) => {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** سداد كامل أو جزئي: يعيد true إن صارت الدفعة مسددة بالكامل. */
export async function settlePayment(p: UnitPayment, paidNowText: string | null): Promise<boolean> {
  const due = Number(p.amount_due) || 0
  const paid = Number(p.amount_paid) || 0
  const remaining = due - paid
  if (remaining <= 0.009) throw new AssetError('سبق سداد هذه الدفعة')
  let paidNow = remaining
  if (paidNowText !== null) {
    if (isCheque(p)) throw new AssetError('الشيك يُسدَّد كاملًا')
    const typed = parseFloat(paidNowText.trim())
    if (!(typed > 0)) throw new AssetError('أدخل المبلغ')
    paidNow = Math.min(typed, remaining)
  }
  const newPaid = paid + paidNow
  const settled = newPaid + 0.001 >= due
  // بشرط ألا يكون المدفوع تغيّر منذ عُرض (سداد من التطبيق في الوقت نفسه).
  const { data, error } = await supabase
    .from('property_unit_payments')
    .update({ amount_paid: newPaid, paid_at: localIso(new Date()), status: settled ? 'paid' : 'partial' })
    .eq('id', p.id)
    .eq('amount_paid', p.amount_paid)
    .select('id')
  if (error) throw error
  if (!data || !data.length) throw new AssetError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
  return settled
}
