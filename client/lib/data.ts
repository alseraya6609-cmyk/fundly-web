import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useSession } from './session'
import { CURRENCIES } from './catalog'

/*
  المرحلة الأولى: قراءة فقط. لا يكتب الموقع شيئًا في بيانات المستخدم، لأن
  التطبيق يدمج بياناته بطريقته (fundly_account.dart ← _sync) وأي كتابة بصيغة
  مختلفة قد تُفسدها. الكتابة الوحيدة هي الموافقة على السياسة (session.tsx)،
  وهي الدالة نفسها التي يستدعيها التطبيق.
*/

export type Entry = {
  id: string
  category: string
  entry_type: string
  title: string
  amount: number
  due_date: string | null
  status: string
  details: Record<string, unknown>
  attachment_url?: string | null
  created_at: string
  updated_at: string
}

export type Asset = {
  id: string
  title: string
  sub_type: string
  category: string
  status: string
  location_or_type: string | null
  amount_label: string | null
  followup_note: string | null
  owner: string | null
  tenant: string | null
  rent_value: string | null
  end_date: string | null
  needs_attention: boolean
  logs_json?: string | null
  created_at: string
  updated_at: string
}

export type AssetEntry = {
  id: string
  asset_id: string
  kind: string
  data: Record<string, unknown>
  attachment_url: string | null
  created_at: string
}

export type Person = {
  fullName: string
  nickName?: string
  roleTitle?: string
  badge?: string
  statusNote?: string
  typeKey?: string
  categoryName?: string
  additionalCategoryNames?: string[]
  dueToYou?: number | string
  dueOnYou?: number | string
  openTasks?: number | string
  documentsCount?: number | string
  lastUpdate?: string
  createdAt?: string
  details?: Record<string, string>
  isPinned?: boolean
}

export type InboxItem = {
  id: string
  sender_name: string
  sender_fnd: string
  source: string
  entry_type: string
  title: string
  action?: string
  note?: string
  created_at: string
}

const STALE = 60_000

/** ما في سلة المحذوفات لا يظهر في أي مكان ولا يدخل أي رقم (كما في التطبيق). */
export const TRASH = 'محذوف'
const live = <T extends { status?: string }>(list: T[]) => list.filter((row) => row.status !== TRASH)

async function rows<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

// ---------------- الجداول ----------------

export function usePersonal() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['personal', user?.id],
    enabled: !!user,
    staleTime: STALE,
    queryFn: () =>
      rows<Entry>(
        supabase
          .from('personal_entries')
          .select('id, category, entry_type, title, amount, due_date, status, details, attachment_url, created_at, updated_at')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false }),
      ).then(live),
  })
}

export function useShared() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['shared', user?.id],
    enabled: !!user,
    staleTime: STALE,
    queryFn: () =>
      rows<Entry>(
        supabase
          .from('shared_entries')
          .select('id, category, entry_type, title, amount, due_date, status, details, attachment_url, created_at, updated_at')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false }),
      ).then(live),
  })
}

export function useAssets() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['assets', user?.id],
    enabled: !!user,
    staleTime: STALE,
    queryFn: () =>
      rows<Asset>(
        // كل الأعمدة: logs_json فيه البيانات الرسمية للأصل (سطر ##meta##).
        supabase.from('project_assets').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }),
      ).then(live),
  })
}

/** سجلات الأصول كلها: العقود، الصيانة، الإيجار، المصروفات، الإيرادات، المستندات. */
export function useAssetEntries() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['asset-entries', user?.id],
    enabled: !!user,
    staleTime: STALE,
    queryFn: () =>
      rows<AssetEntry>(
        supabase
          .from('project_asset_entries')
          .select('id, asset_id, kind, data, attachment_url, created_at')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false }),
      ),
  })
}

/** البيانات الرسمية للأصل من سطر «##meta##» في logs_json (DocumentsHub._metaOf). */
export function assetMeta(asset: Asset): Record<string, string> {
  const raw = asset.logs_json
  if (!raw || !String(raw).trim()) return {}
  try {
    const list = JSON.parse(String(raw))
    if (!Array.isArray(list)) return {}
    for (const line of list) {
      const text = String(line)
      if (!text.startsWith('##meta##')) continue
      const map = JSON.parse(text.slice('##meta##'.length))
      if (map && typeof map === 'object') {
        return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, String(v ?? '').trim()]))
      }
    }
  } catch {
    // سطر تالف: بلا بيانات رسمية.
  }
  return {}
}

export type CommitmentExtras = {
  payments: { id: string; amount: number; payment_date: string; payment_method: string | null; reference_number: string | null; notes: string | null }[]
  appointments: { id: string; appointment_type: string; title: string; appointment_date: string; appointment_time: string | null; status: string; location: string | null }[]
  notes: { id: string; note_type: string; title: string; content: string; created_at: string }[]
  people: { id: string; person_name: string; role_or_relationship: string | null; phone_number: string | null }[]
}

/** إضافات الالتزام الشخصي (جداول commitment_*). */
export function useCommitmentExtras(entryId: string | undefined) {
  const { user } = useSession()
  return useQuery({
    queryKey: ['commitment-extras', entryId],
    enabled: !!user && !!entryId,
    staleTime: STALE,
    queryFn: async (): Promise<CommitmentExtras> => {
      const by = (table: string, columns: string, order: string) =>
        rows<any>(supabase.from(table).select(columns).eq('commitment_id', entryId!).order(order, { ascending: false })).catch(
          () => [],
        )
      const [payments, appointments, notes, people] = await Promise.all([
        by('commitment_payments', 'id, amount, payment_date, payment_method, reference_number, notes', 'payment_date'),
        by('commitment_appointments', 'id, appointment_type, title, appointment_date, appointment_time, status, location', 'appointment_date'),
        by('commitment_notes', 'id, note_type, title, content, created_at', 'created_at'),
        by('commitment_people', 'id, person_name, role_or_relationship, phone_number', 'created_at'),
      ])
      return { payments, appointments, notes, people }
    },
  })
}

// ---------------- الملفات ----------------

/** مخزن الملفات المزامَنة من الجوال (FundlyFiles.bucket). */
export const FILES_BUCKET = 'fundly-files'

/** اسم الملف من مسار الجوال (DocumentStore.fileName). */
export function fileNameOf(path: string): string {
  return String(path ?? '').split(/[\\/]/).pop()?.trim() ?? ''
}

/** مفتاح الملف في المخزن: base64Url لاسم الملف بلا «=» (FundlyFiles.keyFor). */
export function fileKey(name: string): string {
  const bytes = new TextEncoder().encode(name)
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** رابط مؤقت لفتح ملف — قراءة فقط، صالح عشر دقائق. */
export async function openFile(file: { bucket?: string; path?: string; localPath?: string }): Promise<string | null> {
  let bucket = file.bucket
  let path = file.path
  if (!path && file.localPath) {
    bucket = FILES_BUCKET
    path = fileKey(fileNameOf(file.localPath))
  }
  if (!bucket || !path) return null
  if (/^https?:\/\//.test(path)) return path
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 600)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export function useInbox() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['inbox', user?.id],
    enabled: !!user,
    staleTime: STALE,
    // مثل pendingInbox في التطبيق: الجديد فقط، آخر 30. الموقع لا يغيّر حالته.
    queryFn: () =>
      rows<InboxItem>(
        supabase
          .from('fundly_inbox')
          .select('*')
          .eq('recipient_id', user!.id)
          .eq('status', 'new')
          .order('created_at', { ascending: false })
          .limit(30),
      ),
  })
}

// ---------------- نسخة الجوال السحابية (fundly_user_store) ----------------

/** يفك القيمة كما يكتبها التطبيق: {"t": "s|b|i|d|l", "v": ...}. */
function decode(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 't' in parsed) return parsed.v
  } catch {
    // قيمة تالفة: تُتجاهل كما في التطبيق.
  }
  return undefined
}

export type Store = Record<string, unknown>

export function useStore() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['store', user?.id],
    enabled: !!user,
    staleTime: STALE,
    queryFn: async () => {
      const list = await rows<{ key: string; value: string }>(
        supabase.from('fundly_user_store').select('key, value').eq('user_id', user!.id),
      )
      const out: Store = {}
      for (const row of list) {
        const value = decode(row.value)
        if (value !== undefined) out[row.key] = value
      }
      return out
    },
  })
}

function jsonList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    // قائمة نصوص (setStringList): كل عنصر JSON مستقل.
    return value
      .map((item) => {
        if (typeof item !== 'string') return item
        try {
          return JSON.parse(item)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** الأفراد والجهات: نفس مفتاح التطبيق people_management_records_v1. */
export function usePeople() {
  const store = useStore()
  const people = jsonList(store.data?.['people_management_records_v1']).filter(
    (p): p is Person => !!p && typeof p === 'object' && String((p as Person).fullName ?? '').trim() !== '',
  )
  return { ...store, data: store.isSuccess ? people : undefined }
}

export type CalendarRecord = {
  id: string
  title: string
  type: string
  date: string
  time?: string
  priority?: string
  status?: string
  description?: string
  notes?: string
}

/** بنود «الكلندر الذكي» التي أضافها المستخدم (smart_calendar_records_v1). */
export function useCalendarRecords() {
  const store = useStore()
  const list = jsonList(store.data?.['smart_calendar_records_v1']).filter(
    (r): r is CalendarRecord => !!r && typeof r === 'object' && !!(r as CalendarRecord).date,
  )
  return { ...store, data: store.isSuccess ? list : undefined }
}

/** العملة الافتراضية للمستخدم (settings_currency)، كما يعرضها التطبيق. */
export function useCurrency(): string {
  const store = useStore()
  const saved = String(store.data?.['settings_currency'] ?? '')
  return CURRENCIES[saved] ?? ''
}

/** عملة سجل بعينه: ما حُفظ له، وإلا العملة الافتراضية (AppSettings.currencyOf). */
export function currencyOf(details: Record<string, unknown> | undefined, fallback: string): string {
  const own = String(details?.['currency'] ?? details?.['العملة'] ?? '').trim()
  return own || fallback
}

// ---------------- الطلبات ----------------

function noteMap(note?: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(note ?? '')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** نص الطلب كما يبنيه التطبيق (FundlyAccount._inboxText) — مبسّط للعرض. */
export function inboxText(item: InboxItem, t: (s: string) => string): string {
  const who = item.sender_name?.trim() || item.sender_fnd
  const title = item.title?.trim() ? ` «${item.title}»` : ''
  const action = item.action || 'invite'
  const note = noteMap(item.note)
  if (['announcement', 'admin_message'].includes(action)) return String(note.body ?? '').trim()
  if (action === 'support') return `«${item.title}»: ${String(note.body ?? '').trim()}`
  if (action === 'archived' || action === 'removed')
    return `${who} ${t(action === 'removed' ? 'حذف هذا الالتزام من عنده' : 'أرشف هذا الالتزام عنده')}${title}`
  if (action === 'accepted' || action === 'rejected')
    return `${who} ${t(action === 'accepted' ? 'قبِل' : 'رفضَ')} ${t(item.entry_type)}${title}`
  if (action === 'activity') {
    const name = String(note.name ?? '').trim()
    return `${who} ${t('أضاف مصروفًا')}${name ? ` «${name}»` : ''}`
  }
  if (item.source === 'delegations') return `${t('فوّضك')} ${who}`
  if (item.source === 'shared_entries') return `${t('دعاك')} ${who} ${t('للمشاركة في')}${title}`
  if (item.entry_type?.includes('عهدة')) return `${t('أسند إليك')} ${who} ${t('عهدة مالية')}${title}`
  return `${t('أرسل إليك')} ${who} ${t(item.entry_type)}${title}`
}
