import { supabase } from './supabase'
import { AssetError } from './assetWrite'
import { changeReminders, isoOf, type Reminder } from './reminders'
import { endDateColumn, joinLogs, splitLogs, uid, withColumnFallback } from './vehicleWrite'
import { K, type Lease, type Row } from './lease'

/*
  النشاط التجاري من عقد إيجاره (projects_activities_screen.dart):
  - _activityMetaFromLease: بيانات الرخصة والعقد والتذكيرين بمفاتيح _ActKeys
    والتواريخ «يوم/شهر/سنة».
  - _activityItemFromLease ← _createAssetRemote: أصل «business» من الرخصة.
  - _registerActivityRemindersShared: تذكيرا انتهاء الرخصة ونهاية العقد.
  - _activityLicenseFromMeta: «بيانات الرخصة» لعقد جديد من بيانات النشاط.
*/

export const ACT_KEYS = {
  termMode: 'نمط مدة الإيجار',
  leaseNo: 'رقم عقد الإيجار',
  leaseStart: 'تاريخ بداية العقد',
  leaseEnd: 'تاريخ نهاية العقد',
  purpose: 'الغرض من الإيجار',
  tenantClass: 'تصنيف المستأجر',
  leaseReminder: 'تذكير نهاية العقد',
  leaseReminderDays: 'أيام تذكير نهاية العقد',
  legalForm: 'الشكل القانوني',
  licenseNo: 'رقم الرخصة التجارية',
  licenseIssue: 'تاريخ إصدار الرخصة',
  licenseEnd: 'تاريخ انتهاء الرخصة',
  licenseReminder: 'تذكير انتهاء الرخصة',
  licenseReminderDays: 'أيام تذكير الرخصة',
  licenseClass: 'فئة الرخصة',
  chamber: 'عضوية الغرفة',
  activities: 'الأنشطة التجارية',
  capital: 'رأس المال',
  location: 'موقع النشاط',
} as const

export const ACTIVITY_UNIT_KEY = 'activity'
const UNSET = 'غير محدد'

/** _isoToDmy */
function isoToDmy(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso.trim()
}

/** _activityMetaFromLease */
export function activityMetaFromLease(l: Lease): Row {
  const out: Row = {}
  const put = (key: string, value: string | undefined, date = false) => {
    const text = (value ?? '').trim()
    if (!text) return
    out[key] = date ? isoToDmy(text) : text
  }
  const lic = l.license
  const c = l.contract
  put(ACT_KEYS.legalForm, lic[K.legalForm])
  put(ACT_KEYS.licenseNo, lic[K.licenseNo])
  put(ACT_KEYS.licenseIssue, lic[K.licenseIssue], true)
  put(ACT_KEYS.licenseEnd, lic[K.licenseEnd], true)
  put(ACT_KEYS.licenseReminder, lic[K.licenseReminder])
  put(ACT_KEYS.licenseReminderDays, lic[K.licenseReminderDays])
  put(ACT_KEYS.licenseClass, lic[K.licenseClass])
  put(ACT_KEYS.chamber, lic[K.chamber])
  put(ACT_KEYS.activities, lic[K.activities])
  put(ACT_KEYS.capital, lic[K.capital])
  put(ACT_KEYS.location, lic[K.activityLocation])
  put(ACT_KEYS.termMode, c[K.termMode])
  put(ACT_KEYS.leaseNo, c[K.newNo])
  put(ACT_KEYS.leaseStart, c[K.startDate], true)
  put(ACT_KEYS.leaseEnd, c[K.endDate], true)
  put(ACT_KEYS.purpose, c[K.purpose])
  put(ACT_KEYS.tenantClass, c[K.tenantClass])
  put(ACT_KEYS.leaseReminder, lic[K.leaseReminder])
  put(ACT_KEYS.leaseReminderDays, lic[K.leaseReminderDays])
  return out
}

/** _dmyToIso */
function dmyToIso(dmy: string) {
  const iso = isoOf(dmy)
  return iso ? iso.slice(0, 10) : ''
}

/** _activityLicenseFromMeta */
export function activityLicenseFromMeta(meta: Row, title: string, type: string): Row {
  const out: Row = {}
  const put = (key: string, value: string | undefined, date = false) => {
    const text = (value ?? '').trim()
    if (!text || text === UNSET) return
    out[key] = date ? dmyToIso(text) || text : text
  }
  put(K.tradeName, title)
  put(K.activityClass, type)
  put(K.legalForm, meta[ACT_KEYS.legalForm])
  put(K.licenseNo, meta[ACT_KEYS.licenseNo])
  put(K.licenseIssue, meta[ACT_KEYS.licenseIssue], true)
  put(K.licenseEnd, meta[ACT_KEYS.licenseEnd], true)
  put(K.licenseReminder, meta[ACT_KEYS.licenseReminder])
  put(K.licenseReminderDays, meta[ACT_KEYS.licenseReminderDays])
  put(K.licenseClass, meta[ACT_KEYS.licenseClass])
  put(K.chamber, meta[ACT_KEYS.chamber])
  put(K.activities, meta[ACT_KEYS.activities])
  put(K.capital, meta[ACT_KEYS.capital])
  put(K.activityLocation, meta[ACT_KEYS.location])
  put(K.leaseReminder, meta[ACT_KEYS.leaseReminder])
  put(K.leaseReminderDays, meta[ACT_KEYS.leaseReminderDays])
  return out
}

/** _activityItemFromLease ← _createAssetRemote */
export async function createActivityAsset(l: Lease, currencySuffix: string): Promise<{ id: string; title: string }> {
  const user = await uid()
  const meta = activityMetaFromLease(l)
  const name = (l.license[K.tradeName] ?? '').trim()
  const type = (l.license[K.activityClass] ?? '').trim()
  const licenseNo = (meta[ACT_KEYS.licenseNo] ?? '').trim()
  const licenseEnd = (meta[ACT_KEYS.licenseEnd] ?? '').trim()
  const capital = (meta[ACT_KEYS.capital] ?? '').trim()
  const location = (meta[ACT_KEYS.location] ?? '').trim()
  const followup = [licenseNo && `رخصة تجارية رقم ${licenseNo}`, licenseEnd && `الرخصة تنتهي بتاريخ ${licenseEnd}`].filter(Boolean)
  const title = name || 'نشاط تجاري جديد'
  const row = {
    user_id: user,
    title,
    sub_type: type || 'أخرى',
    category: 'business',
    status: 'نشط',
    location_or_type: location || UNSET,
    amount_label: `${capital || '0'} ${currencySuffix}`,
    followup_note: followup.length ? followup.join(' • ') : 'تم الإنشاء وبانتظار استكمال البيانات',
    owner: UNSET,
    tenant: UNSET,
    rent_value: UNSET,
    end_date: licenseEnd ? endDateColumn(licenseEnd) : null,
    annual_yield: UNSET,
    occupancy_rate: 0,
    contract_progress: 0,
    payment_progress: 0,
    documents_progress: 0,
    needs_attention: false,
    icon_color: null,
    cover_url: null,
    description: '',
    annexes: {},
    map_link: '',
    quick_add_enabled: false,
    units_json: '[]',
    employees_json: '[]',
    serial_number: '',
    is_frozen: false,
    is_pinned: false,
    is_sublease: false,
    latitude: null,
    longitude: null,
    logs_json: joinLogs(meta, [`تم إنشاء النشاط التجاري: ${name}`]),
  }
  const created = await withColumnFallback<{ id: string }>(row, (body) => supabase.from('project_assets').insert(body).select('id').single())
  if (!created?.id) throw new AssetError('تعذّر إنشاء النشاط التجاري')
  return { id: created.id, title }
}

/** _actReminderDays */
const reminderDaysOf = (choice: string, custom: string) => ({ 'قبل أسبوعين': 14, 'قبل شهر': 30, 'قبل شهرين': 60 })[choice] ?? (choice === 'مخصص' ? parseInt(custom.trim(), 10) || 0 : 0)

/** _registerActivityRemindersShared: يضيف ما له تاريخ ومدة، ولا يحذف. */
export async function activityReminders(assetId: string, title: string, meta: Row) {
  const upserts: Reminder[] = []
  const one = (id: string, label: string, dateKey: string, choiceKey: string, daysKey: string) => {
    const date = isoOf(meta[dateKey] ?? '')
    const days = reminderDaysOf(meta[choiceKey] ?? '', meta[daysKey] ?? '')
    if (!date || days <= 0) return
    upserts.push({ id, title: `${label} — ${title}`, module: 'الأنشطة التجارية', expiryDate: date, remindBeforeDays: days })
  }
  one(`activity_license_${assetId}`, 'انتهاء الرخصة التجارية', ACT_KEYS.licenseEnd, ACT_KEYS.licenseReminder, ACT_KEYS.licenseReminderDays)
  one(`activity_lease_${assetId}`, 'نهاية عقد إيجار النشاط', ACT_KEYS.leaseEnd, ACT_KEYS.leaseReminder, ACT_KEYS.leaseReminderDays)
  await changeReminders(upserts).catch(() => {})
}

/** بعد حفظ عقد نشاط قائم: الرخصة وتواريخ العقد في بيانات النشاط أيضًا. */
export async function mergeActivityMeta(assetId: string, leaseMeta: Row) {
  if (!Object.keys(leaseMeta).length) return
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('project_assets').select('id, logs_json, updated_at').eq('id', assetId).maybeSingle()
    if (error) throw error
    const fresh = data as { id: string; logs_json: string | null; updated_at: string } | null
    if (!fresh) return
    const { meta, logs } = splitLogs(fresh.logs_json)
    const location = (leaseMeta[ACT_KEYS.location] ?? '').trim()
    const patch: Record<string, unknown> = { logs_json: joinLogs({ ...meta, ...leaseMeta }, logs) }
    if (location) patch.location_or_type = location
    const { data: saved, error: saveError } = await supabase.from('project_assets').update(patch).eq('id', assetId).eq('updated_at', fresh.updated_at).select('id')
    if (saveError) throw saveError
    if (saved && saved.length) return
  }
}
