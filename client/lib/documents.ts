import { useMemo } from 'react'
import {
  assetMeta,
  fileNameOf,
  useAssetEntries,
  useAssets,
  usePeople,
  usePersonal,
  useShared,
  type Asset,
  type Entry,
  type Person,
} from './data'
import { useStore } from './data'

/*
  مركز المستندات — نقل مباشر لـ DocumentsHub في التطبيق
  (lib/screens/documents_hub_screen.dart): نفس المصادر ونفس التقسيمات
  ونفس قاعدة «تحتاج متابعة» (منتهية أو تنتهي خلال 30 يومًا).
*/

export type AppDocument = {
  key: string
  module: string
  section: string
  group: string
  title: string
  owner: string
  number: string
  expiry: Date | null
  localPath: string
  bucket: string
  path: string
}

export const DOC_MODULES = [
  'الالتزامات الشخصية',
  'الالتزامات المشتركة',
  'الأفراد والجهات',
  'العقارات',
  'الأنشطة التجارية',
  'المركبات ووسائل النقل',
] as const

const PERSONAL_BUCKET = 'personal-entry-attachments'
const SHARED_BUCKET = 'shared-entry-attachments'
const IDENTITY_DOCS = ['الهوية', 'جواز السفر', 'الضمان الصحي']

export const PERSONAL_TYPES: Record<string, string[]> = {
  'وثائق شخصية': ['هوية', 'جواز سفر', 'اقامة وتأشيرة', 'رخصة قيادة', 'ملكية سيارة', 'تأمين سيارة', 'تأمين صحي'],
  الضمانات: ['ضمانات'],
  'الوثائق العامة': ['مستند دراسي', 'مستند سفر', 'مستند بنكي', 'تقرير طبي', 'تصاريح', 'فواتير', 'ايصالات'],
}

function personalSection(type: string): string {
  for (const [section, types] of Object.entries(PERSONAL_TYPES)) if (types.includes(type.trim())) return section
  return 'الوثائق العامة'
}

function sharedSection(entryType: string): string {
  const t = entryType.trim()
  if (t === 'مشاركات مشتركة' || t === 'اللقاءات') return 'مشاركات مشتركة'
  if (t === 'الرحلة / السفر') return 'رحلة وسفر'
  if (t === 'جمعية مالية') return 'تحديد أدوار'
  return t || 'أخرى'
}

function assetModule(category: string): string {
  if (category === 'real_estate' || category === 'project') return 'العقارات'
  if (category === 'business' || category === 'activity') return 'الأنشطة التجارية'
  return 'المركبات ووسائل النقل'
}

function assetSection(asset: Asset): string {
  if (asset.category === 'equipment') {
    return assetMeta(asset)['تصنيف المركبة'] === 'مركبات بحرية' ? 'مركبات بحرية' : 'مركبات برية'
  }
  return asset.sub_type?.trim() || 'أخرى'
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()

/** قائمة JSON محفوظة كنص أو كقائمة (DocumentsHub._jsonRows). */
function jsonRows(v: unknown): Record<string, string>[] {
  let list: unknown = v
  if (typeof v === 'string') {
    if (!v.trim()) return []
    try {
      list = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((r) => r && typeof r === 'object')
    .map((r) =>
      Object.fromEntries(
        Object.entries(r as object).map(([k, val]) => [k, val && typeof val === 'object' ? JSON.stringify(val) : str(val)]),
      ),
    )
}

function jsonExtra(v: unknown): Record<string, string> {
  if (v && typeof v === 'object') return v as Record<string, string>
  try {
    const parsed = JSON.parse(String(v ?? ''))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** التاريخ بصيغ التطبيق: يوم/شهر/سنة أو سنة-شهر-يوم (_parseDate). */
export function parseDate(raw: unknown): Date | null {
  const text = str(raw)
  if (!text) return null
  const parts = text.split(/[/\-.]/)
  if (parts.length === 3) {
    const [a, b, c] = parts.map((p) => parseInt(p, 10))
    if (!Number.isNaN(a) && !Number.isNaN(b) && !Number.isNaN(c)) {
      if (a > 999) return new Date(a, b - 1, c)
      if (c > 999) return new Date(c, b - 1, a)
    }
  }
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

export function daysLeft(date: Date | null): number | null {
  if (!date) return null
  const today = new Date()
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const b = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((b - a) / 86_400_000)
}

export const isExpired = (doc: AppDocument) => (daysLeft(doc.expiry) ?? 1) < 0
export const isExpiringSoon = (doc: AppDocument) => {
  const d = daysLeft(doc.expiry)
  return d !== null && d >= 0 && d <= 30
}
export const needsFollowup = (doc: AppDocument) => isExpired(doc) || isExpiringSoon(doc)
export const hasFile = (doc: AppDocument) => !!(doc.localPath || doc.path)

let seq = 0
function doc(partial: Omit<AppDocument, 'key' | 'owner' | 'number' | 'expiry' | 'localPath' | 'bucket' | 'path'> & Partial<AppDocument>): AppDocument {
  return { key: `d${seq++}`, owner: '', number: '', expiry: null, localPath: '', bucket: '', path: '', ...partial }
}

function personalDocs(rows: Entry[]): AppDocument[] {
  const out: AppDocument[] = []
  for (const row of rows) {
    const d = row.details ?? {}
    const file = str(row.attachment_url)
    const type = row.entry_type || 'أخرى'
    for (const extra of jsonRows(d['مرفقات إضافية'])) {
      if (!extra.path) continue
      out.push(
        doc({
          module: 'الالتزامات الشخصية',
          group: `مرفقات: ${type}`,
          section: 'الوثائق العامة',
          title: extra.name || row.title,
          owner: row.title,
          expiry: parseDate(extra.expiry),
          bucket: PERSONAL_BUCKET,
          path: extra.path,
        }),
      )
    }
    for (const [key, group] of [
      ['سجل صرفيات العهدة', 'فواتير صرف العهدة'],
      ['سجل دفعات الالتزام', 'فواتير الدفعات والسداد'],
    ]) {
      for (const payment of jsonRows(d[key])) {
        const path = payment['مرفق الفاتورة']
        if (!path) continue
        const purpose = payment['الغرض'] || payment['البيان'] || ''
        out.push(
          doc({
            module: 'الالتزامات الشخصية',
            group,
            section: 'الوثائق العامة',
            title: [purpose, payment['المبلغ'], payment['التاريخ']].filter(Boolean).join(' • '),
            owner: row.title,
            bucket: PERSONAL_BUCKET,
            path,
          }),
        )
      }
    }
    if (row.entry_type === 'مستند') {
      const docType = str(d['نوع المستند'])
      out.push(
        doc({
          module: 'الالتزامات الشخصية',
          group: docType || 'مستندات أخرى',
          section: personalSection(docType),
          title: row.title,
          owner: str(d['الجهة المصدرة']),
          number: str(d['رقم المستند']),
          expiry: parseDate(d['تاريخ الانتهاء'] ?? row.due_date),
          bucket: PERSONAL_BUCKET,
          path: file,
        }),
      )
    } else if (file) {
      const name = str(d['اسم المرفق الإضافي'])
      out.push(
        doc({
          module: 'الالتزامات الشخصية',
          group: `مرفقات: ${type}`,
          section: 'الوثائق العامة',
          title: name || row.title,
          owner: row.title,
          expiry: parseDate(d['تاريخ انتهاء المرفق']),
          bucket: PERSONAL_BUCKET,
          path: file,
        }),
      )
    }
  }
  return out
}

/** «مشاهدة المستندات: المسؤول فقط» — الموقع يعرض ما أنشأه صاحب الحساب فقط، فلا يُخفى شيء عنه. */
function sharedDocs(rows: Entry[]): AppDocument[] {
  const out: AppDocument[] = []
  for (const row of rows) {
    const d = row.details ?? {}
    const section = sharedSection(row.entry_type)
    const add = (group: string, title: string, path: string, expiry = '') =>
      out.push(
        doc({
          module: 'الالتزامات المشتركة',
          section,
          group,
          title: title.trim() || row.title,
          owner: row.title,
          expiry: parseDate(expiry),
          localPath: path,
        }),
      )
    for (const e of jsonRows(d['سجل المصروفات المشتركة'])) {
      if (e.receipt) add('فواتير المصروفات', [e.description, e.payer, e.date].filter(Boolean).join(' • '), e.receipt)
    }
    for (const [key, group] of [
      ['سجل التسويات', 'إيصالات التسوية'],
      ['سجل المساهمات', 'إيصالات المساهمات'],
    ]) {
      for (const r of jsonRows(d[key])) {
        if (r.receipt) add(group, [r.from || r.member, r.date].filter(Boolean).join(' • '), r.receipt)
      }
    }
    for (const item of jsonRows(d['مستندات'])) {
      const extra = jsonExtra(item.extra)
      const path = str(extra['المرفق'])
      const date = item.date ?? ''
      if (!path && !date) continue
      add(item.kind || 'مستندات', item.title ?? '', path, date)
    }
    const file = str(row.attachment_url)
    if (file) {
      out.push(
        doc({
          module: 'الالتزامات المشتركة',
          section,
          group: str(d['نوع المستند المرفق']) || row.entry_type || 'أخرى',
          title: str(d['اسم المستند المرفق']) || row.title,
          owner: row.title,
          expiry: parseDate(d['تاريخ انتهاء المستند'] ?? row.due_date),
          bucket: SHARED_BUCKET,
          path: file,
        }),
      )
    }
  }
  return out
}

function peopleDocs(people: Person[]): AppDocument[] {
  const out: AppDocument[] = []
  people.forEach((person) => {
    const section = String(person.typeKey ?? '').startsWith('entity_') ? 'الجهات' : 'الأفراد'
    const name = str(person.fullName)
    const details = Object.fromEntries(Object.entries(person.details ?? {}).map(([k, v]) => [k, str(v)]))
    const names = new Set<string>()
    for (const key of Object.keys(details)) {
      if (key.startsWith('مرفق ') && key !== 'مرفقات أخرى') names.add(key.slice('مرفق '.length))
      else if (key.startsWith('انتهاء ')) names.add(key.slice('انتهاء '.length))
    }
    for (const d of IDENTITY_DOCS) if (details[`رقم ${d}`]) names.add(d)
    for (const d of names) {
      const number = details[`رقم ${d}`] ?? ''
      const expiry = details[`انتهاء ${d}`] ?? ''
      const file = details[`مرفق ${d}`] ?? ''
      if (!number && !expiry && !file) continue
      out.push(doc({ module: 'الأفراد والجهات', section, group: d, title: d, owner: name, number, expiry: parseDate(expiry), localPath: file }))
    }
    for (const path of (details['مرفقات أخرى'] ?? '').split('|')) {
      if (!path.trim()) continue
      out.push(doc({ module: 'الأفراد والجهات', section, group: 'مرفقات أخرى', title: fileNameOf(path), owner: name, localPath: path.trim() }))
    }
  })
  return out
}

function assetDocs(assets: Asset[], entries: { asset_id: string; kind: string; data: Record<string, unknown> }[]): AppDocument[] {
  const out: AppDocument[] = []
  const byId = new Map(assets.map((a) => [a.id, a]))
  for (const entry of entries) {
    if (entry.kind !== 'document') continue
    const asset = byId.get(entry.asset_id)
    if (!asset) continue
    const data = entry.data ?? {}
    const type = str(data['نوع المستند'])
    const name = str(data['اسم المستند'])
    out.push(
      doc({
        module: assetModule(asset.category),
        section: assetSection(asset),
        group: type || 'مستند',
        title: name || type || 'مستند',
        owner: asset.title,
        number: str(data['رقم المستند']),
        expiry: parseDate(data['تاريخ الانتهاء']),
        localPath: str(data['الملف المرفق']),
      }),
    )
  }
  const certificates: [string, string][] = [
    ['شهادة مشغل المعدة', 'انتهاء شهادة المشغل'],
    ['التأمين', 'تاريخ انتهاء التأمين'],
    ['الملكية', 'تاريخ انتهاء الملكية'],
  ]
  for (const asset of assets) {
    if (asset.category !== 'equipment') continue
    const meta = assetMeta(asset)
    for (const [label, expiryKey] of certificates) {
      const value = meta[label] ?? ''
      const expiry = meta[expiryKey] ?? ''
      if (!value && !expiry) continue
      const isFile = value.includes('/') || value.includes('\\')
      out.push(
        doc({
          module: 'المركبات ووسائل النقل',
          section: assetSection(asset),
          group: label,
          title: label,
          owner: asset.title,
          number: label === 'الملكية' ? meta['رقم اللوحة'] ?? meta['رقم التسجيل البحري'] ?? '' : '',
          expiry: parseDate(expiry),
          localPath: isFile ? value : '',
        }),
      )
    }
    for (const line of (meta['مستندات أخرى'] ?? '').split('\n')) {
      if (!line.trim()) continue
      out.push(
        doc({
          module: 'المركبات ووسائل النقل',
          section: assetSection(asset),
          group: 'مستندات أخرى',
          title: fileNameOf(line),
          owner: asset.title,
          localPath: line.trim(),
        }),
      )
    }
  }
  return out
}

/** مستندات «عام» (general_documents_v1): ملفات وصور وملاحظات أضافها المستخدم. */
export type GeneralDoc = {
  id: string
  type: string
  name: string
  path: string
  parentId?: string | null
  createdAt?: string
  expiry?: string
  data?: string
}

export function useDocuments() {
  const personal = usePersonal()
  const shared = useShared()
  const people = usePeople()
  const assets = useAssets()
  const entries = useAssetEntries()
  const store = useStore()

  const loading = personal.isLoading || shared.isLoading || people.isLoading || assets.isLoading || entries.isLoading
  const docs = useMemo(() => {
    seq = 0
    return [
      ...personalDocs(personal.data ?? []),
      ...sharedDocs(shared.data ?? []),
      ...peopleDocs(people.data ?? []),
      ...assetDocs(assets.data ?? [], entries.data ?? []),
    ]
  }, [personal.data, shared.data, people.data, assets.data, entries.data])

  const general = useMemo<GeneralDoc[]>(() => {
    const raw = store.data?.['general_documents_v1']
    let list: unknown = raw
    if (typeof raw === 'string') {
      try {
        list = JSON.parse(raw)
      } catch {
        list = []
      }
    }
    return Array.isArray(list) ? (list.filter((x) => x && typeof x === 'object') as GeneralDoc[]) : []
  }, [store.data])

  return { loading, docs, general, error: personal.error || shared.error || assets.error }
}
