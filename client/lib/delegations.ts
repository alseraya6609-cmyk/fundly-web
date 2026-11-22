import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useSession } from './session'

/*
  التفويضات كما في التطبيق (delegations_repository.dart، main.dart ←
  _DelegationsHubPage، received_delegations.dart، delegation_targets.dart):
  - الجدول delegations: النطاق نص «رئيسي — فرع، فرع»، والصلاحيات قائمة نصوص
    فيها أيضًا بيانات تبدأ بـ @ (@fnd: رقم المفوَّض، @ownername: اسم المالك،
    @accept: رده، @target: عنصر محدد، @limit: سقف المبلغ، @log: سجل الأحداث)،
    و«يتطلب موافقة المالك».
  - الحالة تُشتق من الرد والتواريخ والإيقاف، ولا تُخزَّن.
  - المفوَّض: يقبل أو يرفض أو يلغيه من عنده ويعود إليه، ويرى السجلات المفوَّضة
    (fundly_delegated_records) ويديرها بصلاحياته (fundly_delegate_edit_entry
    و fundly_delegate_trash_entry).
*/

export const SCOPES = [
  'كل الأقسام',
  'الالتزامات الشخصية',
  'الالتزامات المشتركة',
  'الأفراد والجهات',
  'العقارات والأنشطة والمركبات',
  'المستندات',
  'التقارير والأرشيف',
  'التنبيهات والكلندر ومراكز المتابعة',
  'الإعدادات والتفويضات',
]

export const SUB_SCOPES: Record<string, string[]> = {
  'الالتزامات الشخصية': ['مالية', 'مستند', 'المتابعة والتخطيط', 'أدوية وبيانات وكلمات سر', 'نمط الحياة', 'مواقع وأماكن', 'عهدة مالية'],
  'الالتزامات المشتركة': ['مشاركات مشتركة', 'الرحلة / السفر', 'جمعية مالية'],
  'الأفراد والجهات': ['الأفراد', 'الجهات والشركات', 'المستحقات والمدفوعات', 'مستندات الأفراد والجهات'],
  'العقارات والأنشطة والمركبات': ['العقارات', 'الأنشطة التجارية', 'المركبات ووسائل النقل', 'العقود والإيجارات'],
  المستندات: ['مستندات الالتزامات الشخصية', 'مستندات الالتزامات المشتركة', 'مستندات الأفراد والجهات', 'مستندات العقارات والأنشطة والمركبات'],
  'التقارير والأرشيف': ['التقارير', 'الأرشيف', 'قوالب المستندات والإيصالات'],
  'التنبيهات والكلندر ومراكز المتابعة': ['مركز التنبيهات', 'الكلندر الذكي', 'مراكز المتابعة'],
  'الإعدادات والتفويضات': ['الإعدادات العامة', 'التوقيع الإلكتروني والختم', 'منح تفويضات فرعية'],
}

export const ORDERED = ['عرض البيانات', 'إضافة السجلات', 'تعديل السجلات', 'حذف السجلات']
export const EXTRAS = ['الموافقة على الطلبات', 'تنفيذ المدفوعات والتحويلات', 'تصدير ومشاركة التقارير', 'إدارة المستندات والمرفقات', 'إدارة التنبيهات والمتابعة', 'منح تفويض فرعي']
export const ALL = [...ORDERED, ...EXTRAS]
export const LEVELS: Record<string, string[]> = {
  'اطّلاع فقط': ['عرض البيانات'],
  'إدخال فقط': ['عرض البيانات', 'إضافة السجلات'],
  'تعديل فقط': ['عرض البيانات', 'تعديل السجلات'],
  'تعديل ومسح فقط': ['عرض البيانات', 'تعديل السجلات', 'حذف السجلات'],
  'إدخال وتعديل ومسح فقط': ['عرض البيانات', 'إضافة السجلات', 'تعديل السجلات', 'حذف السجلات'],
  'إدارة كاملة': ALL,
}
const MANAGE_EXTRAS = ['تصدير ومشاركة التقارير', 'إدارة المستندات والمرفقات', 'إدارة التنبيهات والمتابعة']
export const LEVEL_EXTRAS: Record<string, string[]> = {
  'اطّلاع فقط': ['تصدير ومشاركة التقارير'],
  'إدخال فقط': MANAGE_EXTRAS,
  'تعديل فقط': MANAGE_EXTRAS,
  'تعديل ومسح فقط': MANAGE_EXTRAS,
  'إدخال وتعديل ومسح فقط': [...MANAGE_EXTRAS, 'الموافقة على الطلبات', 'تنفيذ المدفوعات والتحويلات'],
  'إدارة كاملة': EXTRAS,
}
export const FULL_LEVEL = 'إدارة كاملة'
export const NEEDS_APPROVAL = 'يتطلب موافقة المالك'
export const DURATIONS: [string, number][] = [
  ['أسبوع', 7],
  ['شهر', 30],
  ['3 أشهر', 90],
  ['6 أشهر', 182],
  ['سنة', 365],
  ['مخصص', 0],
]
const RECEIVED_MARKER = 'dir:received'
const SEP = ' — '

export const coreOf = (level: string) => (LEVELS[level] ?? []).filter((p) => ORDERED.includes(p))

export function levelOf(permissions: string[]): string {
  const set = new Set(permissions)
  if (ALL.every((p) => set.has(p))) return FULL_LEVEL
  const core = [...set].filter((p) => ORDERED.includes(p))
  for (const level of Object.keys(LEVELS)) {
    if (level === FULL_LEVEL) continue
    const c = coreOf(level)
    if (c.length === core.length && c.every((p) => core.includes(p))) return level
  }
  return Object.keys(LEVELS)[0]
}

export const isMeta = (p: string) => p.startsWith('@')
const meta = (permissions: string[], prefix: string) => (permissions.find((p) => p.startsWith(prefix)) ?? '').slice(prefix.length).trim()
export const fndOf = (permissions: string[]) => meta(permissions, '@fnd:')
export const answerOf = (permissions: string[]) => meta(permissions, '@accept:')
export const ownerNameOf = (permissions: string[]) => meta(permissions, '@ownername:')
export const plainPermissions = (permissions: string[]) => permissions.filter((p) => !isMeta(p))
export function limitOf(permissions: string[]): number | null {
  const p = permissions.find((x) => x.startsWith('@limit:'))
  if (!p) return null
  const n = parseInt(p.slice(7), 10)
  return Number.isNaN(n) ? null : n
}

/** logEntry: «@log:ISO|الحدث» — ويبقى آخر 30 حدثًا. */
const dartIsoNow = () => {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
export function withLog(permissions: string[], event: string): string[] {
  const list = [...permissions, `@log:${dartIsoNow()}|${event.replace(/\|/g, '/')}`]
  const logs = list.filter((p) => p.startsWith('@log:'))
  if (logs.length <= 30) return list
  const drop = new Set(logs.slice(0, logs.length - 30))
  return list.filter((p) => !drop.has(p))
}
export function logOf(permissions: string[]): [Date, string][] {
  const out: [Date, string][] = []
  for (const p of permissions) {
    if (!p.startsWith('@log:')) continue
    const body = p.slice(5)
    const cut = body.indexOf('|')
    if (cut <= 0) continue
    const at = new Date(body.slice(0, cut))
    if (Number.isNaN(at.getTime())) continue
    out.push([at, body.slice(cut + 1)])
  }
  return out.sort((a, b) => b[0].getTime() - a[0].getTime())
}

// ---------------- العناصر المحددة (DelegationTarget) ----------------

export type Target = { sub: string; kind: string; id: string; label: string; subtitle?: string }
export const targetKey = (t: Target) => `${t.sub}|${t.kind}|${t.id}`
export function encodeTarget(t: Target): string {
  const clean = (v: string) => v.replace(/\|/g, '/')
  return `@target:${clean(t.sub)}|${t.kind}|${clean(t.id)}|${clean(t.label)}`
}
export function decodeTarget(raw: string): Target | null {
  if (!raw.startsWith('@target:')) return null
  const parts = raw.slice(8).split('|')
  if (parts.length < 4) return null
  return { sub: parts[0], kind: parts[1], id: parts[2], label: parts.slice(3).join('|') }
}
export const targetsOf = (permissions: string[]) => permissions.map(decodeTarget).filter((t): t is Target => !!t)

const PERSONAL_SLUGS: Record<string, string> = {
  مالية: 'financial',
  مستند: 'document',
  'المتابعة والتخطيط': 'organization',
  'أدوية وبيانات وكلمات سر': 'medical_accounts',
  'نمط الحياة': 'lifestyle',
  'مواقع وأماكن': 'location',
  'عهدة مالية': 'custody',
}
const SHARED_TYPES = ['مشاركات مشتركة', 'الرحلة / السفر', 'جمعية مالية']
const ASSET_CATEGORIES: Record<string, string> = { العقارات: 'real_estate', 'الأنشطة التجارية': 'business', 'المركبات ووسائل النقل': 'equipment' }

export function supportsTargets(main: string, sub: string): boolean {
  if (main === 'الالتزامات الشخصية') return sub in PERSONAL_SLUGS
  if (main === 'الالتزامات المشتركة') return SHARED_TYPES.includes(sub)
  if (main === 'الأفراد والجهات') return sub === 'الأفراد' || sub === 'الجهات والشركات'
  if (main === 'العقارات والأنشطة والمركبات') return sub in ASSET_CATEGORIES
  return false
}

const joinParts = (parts: string[]) => parts.filter((p) => p.trim()).join(' • ')

/** DelegationTargets.load: عناصر القسم الفرعي من بيانات المالك. */
export async function loadTargets(main: string, sub: string, uid: string): Promise<Target[]> {
  if (main === 'الالتزامات الشخصية') {
    const slug = PERSONAL_SLUGS[sub]
    if (!slug) return []
    const { data } = await supabase.from('personal_entries').select('id, category, entry_type, title, amount, status, details').eq('user_id', uid)
    return ((data ?? []) as { id: string; category: string; entry_type: string; title: string; amount: number; status: string; details: Record<string, unknown> }[])
      .filter((r) => r.status !== 'محذوف' && (r.category === slug || (slug === 'custody' && r.entry_type === 'عهدة مالية')))
      .map((r) => ({
        sub,
        kind: 'personal',
        id: r.id,
        label: r.title?.trim() || r.entry_type,
        subtitle: joinParts([r.title?.trim() ? r.entry_type : '', String(r.details?.['اسم المستلم'] ?? ''), Number(r.amount) ? String(r.amount) : '', r.status]),
      }))
  }
  if (main === 'الالتزامات المشتركة') {
    const { data } = await supabase.from('shared_entries').select('id, entry_type, title, amount, status, due_date').eq('user_id', uid)
    return ((data ?? []) as { id: string; entry_type: string; title: string; amount: number; status: string; due_date: string | null }[])
      .filter((r) => r.status !== 'محذوف' && (r.entry_type === 'اللقاءات' ? 'مشاركات مشتركة' : r.entry_type) === sub)
      .map((r) => ({ sub, kind: 'shared', id: r.id, label: r.title?.trim() || r.entry_type, subtitle: joinParts([Number(r.amount) ? String(r.amount) : '', r.due_date ?? '', r.status]) }))
  }
  if (main === 'الأفراد والجهات') {
    const entities = sub === 'الجهات والشركات'
    const { data } = await supabase.from('fundly_user_store').select('value').eq('user_id', uid).eq('key', 'people_management_records_v1').maybeSingle()
    let list: Record<string, unknown>[] = []
    try {
      const wrapper = JSON.parse(String((data as { value?: string } | null)?.value ?? ''))
      const raw = wrapper?.t === 's' ? JSON.parse(String(wrapper.v)) : []
      if (Array.isArray(raw)) list = raw
    } catch {
      list = []
    }
    return list
      .filter((p) => String(p.fullName ?? '').trim() && String(p.typeKey ?? '').startsWith('entity_') === entities)
      .map((p) => ({ sub, kind: 'person', id: String(p.fullName).trim(), label: String(p.fullName).trim(), subtitle: joinParts([String(p.categoryName ?? ''), String(p.roleTitle ?? '')]) }))
  }
  if (main === 'العقارات والأنشطة والمركبات') {
    const category = ASSET_CATEGORIES[sub]
    if (!category) return []
    const { data } = await supabase.from('project_assets').select('id, category, title, sub_type, location_or_type, status, units_json').eq('user_id', uid)
    const out: Target[] = []
    for (const a of (data ?? []) as { id: string; category: string; title: string; sub_type: string; location_or_type: string | null; status: string; units_json: string | null }[]) {
      if (a.category !== category || a.status === 'محذوف') continue
      out.push({ sub, kind: 'asset', id: a.id, label: a.title, subtitle: joinParts([a.sub_type, a.location_or_type ?? '', a.status]) })
      if (category !== 'real_estate' || !a.units_json) continue
      try {
        const units = JSON.parse(a.units_json)
        if (!Array.isArray(units)) continue
        units.forEach((u: Record<string, unknown>, i: number) => {
          if (!u || typeof u !== 'object') return
          const name = String(u.name ?? '').trim()
          const number = String(u.unitNumber ?? '').trim()
          const type = String(u.type ?? '').trim()
          const unitLabel = [name || type, number].filter(Boolean).join(' ')
          out.push({
            sub,
            kind: 'unit',
            id: `${a.id}#${number || name || String(i)}`,
            label: `${a.title} — ${unitLabel || `وحدة ${i + 1}`}`,
            subtitle: joinParts([`وحدة داخل ${a.title}`, type, String(u.status ?? '')]),
          })
        })
      } catch {
        // وحدات تالفة: تُترك.
      }
    }
    return out
  }
  return []
}

// ---------------- السجل والحالة ----------------

export type Delegation = {
  id: string
  user_id: string
  delegate_name: string
  delegate_ref: string | null
  scope: string
  permissions: string[]
  start_date: string | null
  end_date: string | null
  is_paused: boolean
  notes: string | null
}

export const isIncoming = (d: Delegation, uid: string) => !!d.user_id && d.user_id !== uid
export const isReceived = (d: Delegation, uid: string) => isIncoming(d, uid) || (d.delegate_ref ?? '').startsWith(RECEIVED_MARKER)

const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const parseDay = (v: string | null) => {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
/** _DelegationRecord.fromRecord: البداية اليوم والنهاية بعد سنة إن غابتا. */
export const startOf = (d: Delegation) => parseDay(d.start_date) ?? new Date()
export const endOf = (d: Delegation) => parseDay(d.end_date) ?? new Date(Date.now() + 365 * 86400000)
export const isEnded = (d: Delegation) => dayOnly(endOf(d)) < dayOnly(new Date())
export const isScheduled = (d: Delegation) => !d.is_paused && startOf(d) > new Date()
export const isActive = (d: Delegation) => !d.is_paused && !isEnded(d) && !isScheduled(d)
export const isExpiringSoon = (d: Delegation) => {
  if (!isActive(d)) return false
  const days = Math.floor((endOf(d).getTime() - Date.now()) / 86400000)
  return days >= 0 && days <= 30
}

/** _statusOf (للمالك) و incomingStatusOf (للمفوَّض). */
export function statusOf(d: Delegation, uid: string): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info' } {
  const incoming = isIncoming(d, uid)
  const answer = answerOf(d.permissions)
  if (incoming) {
    if (answer === 'withdrawn') return { label: 'ألغيتَه من عندك', tone: 'bad' }
    if (answer === 'rejected') return { label: 'رفضتَه', tone: 'bad' }
    if (answer !== 'accepted') return { label: 'بانتظار ردك', tone: 'warn' }
    if (isEnded(d)) return { label: 'منتهي', tone: 'muted' }
    if (d.is_paused) return { label: 'موقوف', tone: 'bad' }
    if (isScheduled(d)) return { label: 'مجدول', tone: 'info' }
    return { label: 'قبلتَه — ساري', tone: 'ok' }
  }
  if (answer === 'withdrawn') return { label: 'ألغاه المفوَّض', tone: 'bad' }
  if (answer === 'rejected') return { label: 'رفضه المفوَّض', tone: 'bad' }
  if (answer === 'pending' && !isEnded(d)) return { label: 'بانتظار القبول', tone: 'warn' }
  if (isEnded(d)) return { label: 'منتهي', tone: 'muted' }
  if (d.is_paused) return { label: 'موقوف', tone: 'bad' }
  if (isScheduled(d)) return { label: 'مجدول', tone: 'info' }
  if (isExpiringSoon(d)) return { label: 'ينتهي قريبًا', tone: 'warn' }
  return { label: 'نشط', tone: 'ok' }
}

export const mainScopeOf = (scope: string | null) => {
  if (!scope?.trim()) return SCOPES[0]
  const main = scope.split(SEP)[0].trim()
  const legacy: Record<string, string> = {
    'العقارات والأنشطة': 'العقارات والأنشطة والمركبات',
    'العقارات/الأنشطة التجارية/المعدات وأخرى': 'العقارات والأنشطة والمركبات',
    'الأشخاص والجهات': 'الأفراد والجهات',
    'إدارة الأشخاص والجهات': 'الأفراد والجهات',
    'المستندات والتقارير': 'التقارير والأرشيف',
    'قوالب المستندات والتقارير والأرشيف': 'التقارير والأرشيف',
  }
  const mapped = legacy[main] ?? main
  return SCOPES.includes(mapped) ? mapped : SCOPES[0]
}
export function subScopesOf(scope: string | null): string[] {
  if (!scope || !scope.includes(SEP)) return []
  const available = SUB_SCOPES[mainScopeOf(scope)] ?? []
  const legacy: Record<string, string> = { 'التنظيم والمتابعة': 'المتابعة والتخطيط', 'آليات ومعدات': 'المركبات ووسائل النقل', 'مستندات الأشخاص والجهات': 'مستندات الأفراد والجهات' }
  return (scope.split(SEP).pop() ?? '')
    .split('،')
    .map((p) => legacy[p.trim()] ?? p.trim())
    .filter((p) => available.includes(p))
}
export const composeScope = (main: string, subs: string[]) => (subs.filter((s) => s.trim()).length ? `${main}${SEP}${subs.filter((s) => s.trim()).join('، ')}` : main)

export const fmtDay = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ---------------- القراءة والكتابة ----------------

export function useDelegations() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['delegations', user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      // ما منحتُه وما وصلني بالرقم التعريفي (الصلاحيات في الخادم تحدد ما يُرى).
      const { data, error } = await supabase.from('delegations').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id ?? ''),
        user_id: String(r.user_id ?? ''),
        delegate_name: String(r.delegate_name ?? ''),
        delegate_ref: r.delegate_ref == null ? null : String(r.delegate_ref),
        scope: String(r.scope ?? SCOPES[0]),
        permissions: Array.isArray(r.permissions) ? (r.permissions as unknown[]).map(String) : [],
        start_date: r.start_date == null ? null : String(r.start_date),
        end_date: r.end_date == null ? null : String(r.end_date),
        is_paused: r.is_paused === true,
        notes: r.notes == null ? null : String(r.notes),
      })) as Delegation[]
    },
  })
}

export class DelegationError extends Error {}

export type DelegationDraft = {
  id?: string
  delegate_name: string
  delegate_ref: string | null
  scope: string
  permissions: string[]
  start: Date
  end: Date
  is_paused: boolean
  notes: string | null
}

export async function saveDelegation(d: DelegationDraft) {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) throw new DelegationError('انتهت الجلسة — ادخل من جديد')
  const row = {
    user_id: uid,
    delegate_name: d.delegate_name,
    delegate_ref: d.delegate_ref,
    scope: d.scope,
    permissions: d.permissions,
    start_date: isoDay(d.start),
    end_date: isoDay(d.end),
    is_paused: d.is_paused,
    notes: d.notes,
  }
  const res = d.id ? await supabase.from('delegations').update(row).eq('id', d.id).select('id') : await supabase.from('delegations').insert(row).select('id')
  if (res.error) throw res.error
}

export const draftOf = (d: Delegation): DelegationDraft => ({
  id: d.id,
  delegate_name: d.delegate_name,
  delegate_ref: d.delegate_ref,
  scope: d.scope,
  permissions: d.permissions,
  start: startOf(d),
  end: endOf(d),
  is_paused: d.is_paused,
  notes: d.notes,
})

/** إيقاف/تفعيل، تمديد شهر، إلغاء فوري — مع حدث في السجل. */
export async function ownerAction(d: Delegation, action: 'toggle' | 'extend' | 'revoke') {
  const draft = draftOf(d)
  const today = dayOnly(new Date())
  if (action === 'toggle') {
    draft.permissions = withLog(d.permissions, d.is_paused ? 'إعادة تفعيل التفويض' : 'إيقاف التفويض مؤقتًا')
    draft.is_paused = !d.is_paused
  } else if (action === 'extend') {
    const base = endOf(d) > today ? endOf(d) : today
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 30)
    draft.end = next
    draft.permissions = withLog(d.permissions, `تمديد التفويض حتى ${fmtDay(next)}`)
  } else {
    // ينتهي أمس (فيُعدّ منتهيًا من الآن)، ويبقى في «المنتهية» مع سجله.
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    draft.is_paused = false
    if (draft.start > yesterday) draft.start = yesterday
    draft.end = yesterday
    draft.permissions = withLog(d.permissions, 'إلغاء فوري للتفويض')
  }
  await saveDelegation(draft)
}

export async function deleteDelegation(id: string) {
  const { error } = await supabase.from('delegations').delete().eq('id', id)
  if (error) throw error
}

/** رد المفوَّض: accepted / rejected / withdrawn (setIncomingAnswer). */
export async function setAnswer(id: string, answer: 'accepted' | 'rejected' | 'withdrawn') {
  const { data, error } = await supabase.from('delegations').select('permissions').eq('id', id).single()
  if (error) throw error
  const current = Array.isArray((data as { permissions?: unknown[] }).permissions) ? ((data as { permissions: unknown[] }).permissions.map(String) as string[]) : []
  const permissions = [...current.filter((p) => !p.startsWith('@accept:')), `@accept:${answer}`]
  const { error: saveError } = await supabase.from('delegations').update({ permissions }).eq('id', id)
  if (saveError) throw saveError
}

export type DelegatedRow = { source: string; id: string; title: string; kind: string; status: string; due: string; amount: number }

export async function delegatedRecords(id: string): Promise<DelegatedRow[]> {
  const { data, error } = await supabase.rpc('fundly_delegated_records', { p_delegation: id })
  if (error) throw error
  if (!Array.isArray(data)) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    source: String(r.source ?? ''),
    id: String(r.id ?? ''),
    title: String(r.title ?? ''),
    kind: String(r.kind ?? ''),
    status: String(r.status ?? ''),
    due: r.due == null ? '' : String(r.due),
    amount: Number(r.amount) || 0,
  }))
}

export async function editDelegatedEntry(p: { delegationId: string; source: string; id: string; title: string | null; amount: number | null; due: string | null; status: string; note: string }) {
  const { error } = await supabase.rpc('fundly_delegate_edit_entry', {
    p_delegation: p.delegationId,
    p_source: p.source,
    p_id: p.id,
    p_title: p.title,
    p_amount: p.amount,
    p_due: p.due,
    p_status: p.status,
    p_note: p.note,
  })
  if (error) throw error
}

export async function trashDelegatedEntry(delegationId: string, source: string, id: string) {
  const { error } = await supabase.rpc('fundly_delegate_trash_entry', { p_delegation: delegationId, p_source: source, p_id: id })
  if (error) throw error
}

export const RECEIVED = RECEIVED_MARKER
