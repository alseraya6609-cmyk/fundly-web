import { mutateStore, StoreError, type Wrapped } from './storeWrite'
import { describeFilter, type ReportFilter } from './reports'

/*
  حفظ التقارير وملفات الأرشيف — مثل _ReportsArchiveHubPage في التطبيق:
  المفتاح reports_archive_records_v1 نصّ JSON {recent: [...], archived: [...]}
  وكل عنصر _GeneratedReport.toMap. يُعدَّل الشكل الخام فقط (العناصر القديمة
  وحقولها التي لا يعرفها الموقع تبقى كما هي).
*/

const KEY = 'reports_archive_records_v1'

type Raw = Record<string, unknown>
type Lists = { recent: Raw[]; archived: Raw[] }

/** DateTime.toIso8601String لوقت محلي (بلا Z) كما يكتبه Dart. */
export function dartIso(d: Date) {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function decode(current: Wrapped | null): Lists {
  if (!current) return { recent: [], archived: [] }
  if (current.t !== 's') throw new StoreError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
  let parsed: unknown
  try {
    parsed = JSON.parse(String(current.v ?? ''))
  } catch {
    throw new StoreError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
  }
  const pick = (k: string) => {
    const list = parsed && typeof parsed === 'object' ? (parsed as Raw)[k] : null
    return Array.isArray(list) ? (list.filter((r) => r && typeof r === 'object') as Raw[]) : []
  }
  return { recent: pick('recent'), archived: pick('archived') }
}

const encode = (lists: Lists): Wrapped => ({ t: 's', v: JSON.stringify({ recent: lists.recent, archived: lists.archived }) })

/** AppFilterValues.toMap — الحقول التي لا يستعملها الموقع بقيمها الافتراضية. */
function filterToMap(f: ReportFilter): Raw {
  const v = f.values
  return {
    module: f.module,
    values: {
      mainCategory: v.mainCategory,
      subCategory: v.subCategory,
      dateFrom: v.dateFrom ? dartIso(v.dateFrom) : null,
      dateTo: v.dateTo ? dartIso(v.dateTo) : null,
      status: v.status,
      amountFrom: v.amountFrom,
      amountTo: v.amountTo,
      amountShortcut: v.amountShortcut,
      documentName: '',
      documentState: null,
      personName: v.personName,
      personCategory: null,
      delegateName: '',
      placeName: v.placeName,
      datePeriod: v.datePeriod,
      currency: null,
      paymentMethod: v.paymentMethod,
      medicineState: null,
      debtDirection: null,
      maintenanceBy: null,
      dueState: null,
      chequeState: null,
    },
    query: f.query,
  }
}

/** عنوان التقرير الافتراضي كما في التطبيق: «تقرير شامل» / «أرشيف العقارات · فئة». */
export function defaultReportTitle(filter: ReportFilter, archive: boolean) {
  const kind = archive ? 'أرشيف' : 'تقرير'
  const v = filter.values
  const category = v.mainCategory !== 'الكل' && v.mainCategory !== filter.module ? ` · ${v.mainCategory}` : ''
  return `${kind} ${filter.module === 'الكل' ? 'شامل' : filter.module}${category}`
}

/** إنشاء تقرير (أو نتيجة بحث في الأرشيف) وحفظه أول القائمة. يعيد معرّفه. */
export async function createReport(
  filter: ReportFilter,
  options: { title: string; archive: boolean; reason: string; createdBy: string },
): Promise<string> {
  const now = new Date()
  // microsecondsSinceEpoch
  const id = String(now.getTime() * 1000)
  const item: Raw = {
    id,
    title: options.title.trim() || defaultReportTitle(filter, options.archive),
    type: filter.module,
    subject: describeFilter(filter)
      .slice(1)
      .map(([k, v]) => `${k}: ${v}`)
      .join('، '),
    mode: options.archive ? 'أرشيف' : 'تقرير',
    fromDate: filter.values.dateFrom ? dartIso(filter.values.dateFrom) : null,
    toDate: filter.values.dateTo ? dartIso(filter.values.dateTo) : null,
    dataFields: [],
    createdBy: options.createdBy,
    createdAt: dartIso(now),
    selection: null,
    filter: filterToMap(filter),
    archivedAt: options.archive ? dartIso(now) : null,
    archiveReason: options.archive ? options.reason.trim() : '',
  }
  await mutateStore(KEY, (current) => {
    const lists = decode(current)
    if (options.archive) lists.archived.unshift(item)
    else lists.recent.unshift(item)
    return encode(lists)
  })
  return id
}

const sameId = (id: string) => (r: Raw) => String(r['id'] ?? '') === id

/** _archiveReport: من التقارير إلى الأرشيف بتاريخ اليوم وسببه. */
export async function archiveReport(id: string, reason: string) {
  await mutateStore(KEY, (current) => {
    const lists = decode(current)
    const item = lists.recent.find(sameId(id))
    if (!item) throw new StoreError('لم يعد التقرير موجودًا — حدّث الصفحة')
    lists.recent = lists.recent.filter((r) => !sameId(id)(r))
    lists.archived.unshift({ ...item, archivedAt: dartIso(new Date()), archiveReason: reason.trim() })
    return encode(lists)
  })
}

/** _restoreReport: يعود كما هو (بتاريخ الأرشفة وسببه) أول التقارير. */
export async function restoreReport(id: string) {
  await mutateStore(KEY, (current) => {
    const lists = decode(current)
    const item = lists.archived.find(sameId(id))
    if (!item) throw new StoreError('لم يعد التقرير موجودًا — حدّث الصفحة')
    lists.archived = lists.archived.filter((r) => !sameId(id)(r))
    lists.recent.unshift(item)
    return encode(lists)
  })
}

/** _deleteReport: من القائمتين. */
export async function deleteReport(id: string) {
  await mutateStore(KEY, (current) => {
    const lists = decode(current)
    lists.recent = lists.recent.filter((r) => !sameId(id)(r))
    lists.archived = lists.archived.filter((r) => !sameId(id)(r))
    return encode(lists)
  })
}
