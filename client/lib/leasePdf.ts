import {
  CONTRACT_FIELDS,
  K,
  VEHICLE_CONTRACT_FIELDS,
  isVehicleLease,
  LESSOR_FIELDS,
  METER_GROUPS,
  PROPERTY_FIELDS,
  REP_FIELDS,
  TENANT_FIELDS,
  adminFeeTaxOf,
  includesAdminFees,
  meterCountOf,
  meterLines,
  migrateMeters,
  num,
  paymentTaxOf,
  taxRate,
  totals,
  type FieldSpec,
  type Lease,
  type Row,
} from './lease'
import { hijri } from './recordPrint'

export { isVehicleLease }

/*
  نموذج العقد الرسمي (buildLeasePdf في template_print.dart) على الويب:
  الترويسة (شعار المستخدم واسمه ومدينته وهاتفه وبريده، ورقم المستند
  والتاريخ والموافق ونمط المدة)، ثم الأقسام المرقّمة: بيانات العقد، المؤجر،
  المستأجر، الممثل، الرخصة (النشاط)، العين المؤجرة / المحل / المركبة،
  شروط التأجير والسائق (المركبة)، القيمة المالية والدفعات بمؤشراتها وجدولها،
  التأمين، الرسوم الإدارية، البنود (المركبة وحدها)، ثم التوقيعات والختم.
  يُطبع أو يُحفظ PDF من نافذة الطباعة في المتصفح.
*/

export const isInvestorLease = (l: Lease) => (l.contract[K.lessorCapacity] ?? '').trim() === 'مستثمر'

/** حقول عقد النشاط (activityContractFields). */
export const ACTIVITY_CONTRACT_FIELDS: FieldSpec[] = [
  { key: K.termMode, label: 'نمط مدة الإيجار' },
  { key: K.newNo, label: 'رقم عقد الإيجار' },
  { key: K.startDate, label: 'تاريخ بداية العقد', date: true },
  { key: K.endDate, label: 'تاريخ نهاية العقد', date: true },
  { key: K.purpose, label: 'الغرض من الإيجار' },
  { key: K.tenantClass, label: 'تصنيف المستأجر' },
]

/** _leaseInternal: مفاتيح لا تُطبع. */
const INTERNAL = new Set<string>([
  K.subject,
  K.paymentsNote,
  K.taxRate,
  K.rentTaxable,
  K.adminFeesTaxable,
  K.adminFeesTaxRate,
  K.contractScope,
  K.leaseReminderDays,
  K.licenseReminder,
  K.licenseReminderDays,
  K.rowId,
  'حالة الشيك',
  'سجل الشيك',
  K.paymentReminder,
  K.paymentReminderDays,
])

export type LeasePrintOptions = {
  t: (s: string) => string
  lang: string
  dir: 'rtl' | 'ltr'
  origin: string
  title: string
  activity?: boolean
  /** بيانات المركبة (meta) لشروط التأجير والسائق. */
  assetMeta?: Row
  currency: string
  org: { name: string; city: string; phone: string; email: string; logo: string | null }
  signature: [number, number][][]
  stamp: string
}

const esc = (input: string) =>
  String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const two = (n: number) => String(n).padStart(2, '0')
const dmy = (d: Date) => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`

/** _showDate: سنة-شهر-يوم ← يوم/شهر/سنة، وغيرها كما هي. */
export function showDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? '').trim())
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (raw ?? '').trim()
}
const parseDate = (raw: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? '').trim())
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}

/** printMoney: 12,345.50 */
export function printMoney(value: number): string {
  const [whole, frac] = Math.abs(value).toFixed(2).split('.')
  let out = ''
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += ','
    out += whole[i]
  }
  return `${value < 0 ? '-' : ''}${out}.${frac}`
}

const rateLabel = (rate: number) => (rate === Math.round(rate) ? String(rate) : rate.toFixed(1))

const AR_NUMS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
const arNum = (n: number, rtl: boolean) => (rtl ? String(n).replace(/\d/g, (d) => AR_NUMS[+d]) : String(n))

/** _pairsOf: حقول القسم بترتيبها ثم بقية المفاتيح غير الداخلية. */
function pairsOf(values: Row, specs: FieldSpec[]): [string, string][] {
  const out: [string, string][] = []
  const seen = new Set<string>()
  for (const spec of specs) {
    seen.add(spec.key)
    const value = (values[spec.key] ?? '').trim()
    if (!value) continue
    out.push([spec.label, spec.date ? showDate(value) : value])
  }
  for (const [key, raw] of Object.entries(values)) {
    if (seen.has(key) || INTERNAL.has(key)) continue
    if (key.startsWith('__') || !String(raw ?? '').trim()) continue
    out.push([key === K.mobile ? K.phone : key, showDate(String(raw))])
  }
  return out
}

/** _leasePropertyForPrint: كل عداد في سطر «رقم عداد الكهرباء 1: 123 — على المستأجر». */
function propertyForPrint(property: Row): Row {
  const out: Row = { ...property }
  delete out[K.areaUnit]
  migrateMeters(out)
  for (const [countKey, group] of Object.entries(METER_GROUPS)) {
    const n = meterCountOf(out, countKey)
    const numbers = meterLines(out[group[0]], n)
    const payers = meterLines(out[group[1]], n)
    delete out[group[0]]
    delete out[group[1]]
    for (let i = 0; i < n; i++) {
      const value = [numbers[i], payers[i] ? `على ${payers[i]}` : ''].filter(Boolean).join(' — ')
      if (value) out[`${group[2]} ${i + 1}`] = value
    }
  }
  return out
}

/** withAreaUnit: عنوان المساحة بوحدتها، و«وحدة المساحة» لا تُطبع. */
function propertySpecs(property: Row): FieldSpec[] {
  const unit = (property[K.areaUnit] ?? '').trim() || 'م²'
  return PROPERTY_FIELDS.filter((s) => s.key !== K.areaUnit).map((s) => (s.key === 'مساحة العين' && unit !== 'م²' ? { ...s, label: `مساحة العين (${unit})` } : s))
}

const ORDINALS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر']

function signatureSvg(strokes: [number, number][][]): string {
  if (!strokes.length) return ''
  const xs = strokes.flat().map((p) => p[0])
  const ys = strokes.flat().map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = Math.max(1, Math.max(...xs) - minX)
  const h = Math.max(1, Math.max(...ys) - minY)
  const path = strokes.map((s) => s.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x - minX).toFixed(1)} ${(y - minY).toFixed(1)}`).join(' ')).join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 ${(w + 12).toFixed(1)} ${(h + 12).toFixed(1)}"><path d="${path}" fill="none" stroke="#0F2420" stroke-width="${(Math.max(w, h) / 70).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

const imageMime = (b64: string) => (b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png')

export function buildLeaseHtml(data: Lease, o: LeasePrintOptions): string {
  const T = (s: string) => esc(o.t(s))
  const rtl = o.dir === 'rtl'
  const vehicle = isVehicleLease(data)
  const activity = !!o.activity && !vehicle
  const c = data.contract
  const cv = (key: string) => (c[key] ?? '').trim()
  const currency = esc(o.t(cv('العملة') || o.currency))
  let section = 0
  const body: string[] = []

  const sec = (title: string, content: string) => {
    if (!content) return
    section++
    body.push(`<section class="sec"><div class="sec-h"><span class="num">${arNum(section, rtl)}</span><b>${T(title)}</b><i></i></div>${content}</section>`)
  }
  const kv = (pairs: [string, string][]) => {
    const filled = pairs.filter((p) => p[1].trim())
    if (!filled.length) return ''
    const short = filled.filter((p) => p[1].trim().length <= 48)
    const long = filled.filter((p) => p[1].trim().length > 48)
    let html = ''
    if (short.length) {
      const cols = short.length < 3 ? (short.length === 1 ? 2 : short.length) : 3
      html += `<div class="kv" style="grid-template-columns:repeat(${cols},1fr)">${short.map(([k, v]) => `<div class="cell"><span>${T(k)}</span><b><bdi>${esc(v.trim())}</bdi></b></div>`).join('')}</div>`
    }
    for (const [k, v] of long) html += `<div class="kv-long"><span>${T(k)}</span><b>${esc(v.trim()).replace(/\n/g, '<br>')}</b></div>`
    return html
  }
  const table = (heads: string[], rows: string[][], numeric: Set<number>, foot?: string[]) => {
    if (!rows.length) return ''
    const cls = (i: number) => (heads[i] === '#' ? ' class="idx"' : numeric.has(i) ? ' class="n"' : '')
    return `<table class="tb"><thead><tr>${heads.map((h, i) => `<th${cls(i)}>${T(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((v, i) => `<td${cls(i)}><bdi>${esc(v)}</bdi></td>`).join('')}</tr>`)
      .join('')}</tbody>${foot ? `<tfoot><tr>${foot.map((v, i) => `<td${cls(i)}>${T(v)}</td>`).join('')}</tr></tfoot>` : ''}</table>`
  }

  sec('بيانات العقد', kv(pairsOf(c, vehicle ? VEHICLE_CONTRACT_FIELDS : activity ? ACTIVITY_CONTRACT_FIELDS : CONTRACT_FIELDS)))
  sec('الطرف الأول — المؤجر', kv(pairsOf(data.lessor, LESSOR_FIELDS)))
  sec('الطرف الثاني — المستأجر', kv(pairsOf(data.tenant, TENANT_FIELDS)))
  if (!vehicle) sec('ممثل المستأجر', kv(pairsOf(data.representative, REP_FIELDS)))
  if (activity) sec('بيانات الرخصة والنشاط', kv(pairsOf(data.license, [])))
  sec(vehicle ? 'بيانات المركبة' : activity ? 'بيانات المحل' : 'بيانات العين المؤجرة', kv(vehicle ? pairsOf(data.property, []) : pairsOf(propertyForPrint(data.property), propertySpecs(data.property))))

  if (vehicle) {
    const meta = o.assetMeta ?? {}
    const m = (key: string) => (meta[key] ?? '').trim()
    const when = (date: string, time: string) => [m(date), m(time)].filter(Boolean).join(' · ')
    sec(
      'شروط التأجير',
      kv([
        ['الموقع', m('موقع المشروع')],
        ['وقت البدء', when('بدء المشروع', 'ساعة بدء المشروع')],
        ['وقت الإغلاق', when('وقت الإغلاق', 'ساعة الإغلاق')],
        ['على من الصيانة', m('الصيانة على')],
        ['على من الوقود', m('الوقود على')],
        ['رقم التواصل', m('رقم التواصل')],
        ['ملاحظات', m('ملاحظات شروط التأجير')],
      ]),
    )
    sec(
      m('تصنيف المركبة') === 'مركبات بحرية' ? 'القبطان والرخصة البحرية' : 'السائق / المشغّل',
      kv([
        ['الاسم', m('اسم المشغل')],
        ['الجنسية', m('جنسية المشغل')],
        ['انتهاء الرخصة', m('انتهاء شهادة المشغل')],
        ['انتهاء شهادة السلامة', m('انتهاء شهادة السلامة')],
      ]),
    )
  }

  // ---------- القيمة المالية والدفعات ----------
  const tt = totals(data)
  if (data.payments.length) {
    const rows = data.payments.map((row, i) => {
      const amount = num(row[K.paymentAmount])
      const tax = paymentTaxOf(data, row)
      return [
        String(i + 1),
        row[K.paymentFee] ?? '',
        printMoney(amount),
        printMoney(tax),
        printMoney(amount + tax),
        showDate(row[K.paymentDue] ?? ''),
        row[K.collectMethod] ?? '',
        [row[K.paymentCheque] ?? '', row[K.paymentBank] ?? ''].filter((s) => s.trim()).join(' · '),
      ]
    })
    const kpi = (label: string, value: string, sub: string, strong = false) => `<div class="kpi${strong ? ' strong' : ''}"><span>${T(label)}</span><b>${value}</b><small>${sub}</small></div>`
    const gross = tt.paymentsTotal + tt.paymentsTax
    const note = cv(K.paymentsNote)
    sec(
      'القيمة المالية والدفعات',
      `<div class="kpis">${kpi('القيمة قبل الضريبة', printMoney(tt.paymentsTotal), currency)}${kpi('الضريبة', `${rateLabel(taxRate(data))}%`, `${printMoney(tt.paymentsTax)} ${currency}`)}${kpi('عدد الدفعات', String(data.payments.length), T('دفعة'))}${kpi('الإجمالي', printMoney(gross), currency, true)}</div>` +
        table(['#', 'اسم الدفعة', 'القيمة', 'الضريبة', 'الإجمالي', 'الاستحقاق', 'طريقة التحصيل', 'شيك / بنك'], rows, new Set([2, 3, 4]), [
          '',
          'الإجمالي',
          printMoney(tt.paymentsTotal),
          printMoney(tt.paymentsTax),
          printMoney(gross),
          '',
          '',
          '',
        ]) +
        (note ? `<div class="note">${T('ملاحظات الدفعات')}: ${esc(note)}</div>` : ''),
    )
  }
  if (data.deposits.length) {
    sec(
      'التأمين',
      table(
        ['مبلغ التأمين', 'طريقة التحصيل', 'تاريخ التحصيل', 'رقم الإيصال', 'شيك / بنك', 'ملاحظات'],
        data.deposits.map((row) => [
          printMoney(num(row[K.depositAmount])),
          row[K.collectMethod] ?? '',
          showDate(row['تاريخ تحصيل التأمين'] ?? ''),
          row['رقم الإيصال'] ?? '',
          [row[K.paymentCheque] ?? '', row[K.paymentBank] ?? ''].filter((s) => s.trim()).join(' · '),
          row['ملاحظات'] ?? '',
        ]),
        new Set([0]),
      ),
    )
  }
  if (data.adminFees.length && includesAdminFees(data)) {
    sec(
      'الرسوم الإدارية',
      table(
        ['نوع الرسم', 'القيمة', 'الضريبة', 'الاستحقاق', 'طريقة التحصيل', 'رقم الإيصال', 'يتحمّلها'],
        data.adminFees.map((row) => [
          row[K.adminFeeType] ?? '',
          printMoney(num(row[K.adminFeeAmount])),
          printMoney(adminFeeTaxOf(data, row)),
          showDate(row[K.adminFeeDue] ?? ''),
          row[K.collectMethod] ?? '',
          row['رقم الإيصال'] ?? '',
          row['على من'] ?? '',
        ]),
        new Set([1, 2]),
      ),
    )
  }

  // ---------- البنود (عقد المركبة وحده) ----------
  if (vehicle) {
    const start = showDate(cv(K.startDate))
    const end = showDate(cv(K.endDate))
    const clauses = [
      ...(start && end ? [`${o.t('مدة العقد من')} ${start} ${o.t('إلى')} ${end}${o.t('، ولا يُجدَّد إلا باتفاق مكتوب بين الطرفين.')}`] : []),
      o.t('يلتزم المستأجر بسداد الدفعات في مواعيد استحقاقها المبيّنة في جدول الدفعات.'),
      ...(data.deposits.length ? [o.t('يُردّ مبلغ التأمين عند انتهاء العقد بعد خصم أي مستحقات أو أضرار إن وُجدت.')] : []),
      o.t('يتحمّل المستأجر المخالفات والأضرار الناتجة عن سوء الاستخدام طوال مدة التأجير.'),
      o.t('إذا أخلّ أحد الطرفين بالتزاماته يحق للطرف الآخر المطالبة بحقوقه وفق الأنظمة المعمول بها.'),
    ]
    sec(
      'البنود',
      clauses
        .map((text, i) => `<p class="clause"><b>${T('البند')} ${i < ORDINALS.length ? T(ORDINALS[i]) : i + 1}: </b>${esc(text)}</p>`)
        .join(''),
    )
  }

  // ---------- التوقيعات ----------
  const signed = !!cv(K.signedAt)
  const svg = signed ? signatureSvg(o.signature) : ''
  const box = (label: string, name: string, mine: boolean) =>
    `<div class="sign"><div class="sign-main"><span class="lbl">${T(label)}</span><b>${esc(name)}</b><div class="sig">${mine && svg ? svg : ''}</div><i></i><small>${T('التوقيع')}</small></div><div class="stamp">${
      mine && signed && o.stamp ? `<img src="data:${imageMime(o.stamp)};base64,${o.stamp}" alt="">` : `<span class="ring">${T('الختم')}</span>`
    }</div></div>`
  body.push(
    `<div class="signs">${box('الطرف الأول — المؤجر', (data.lessor[K.name] ?? '').trim(), true)}${box(vehicle ? 'الطرف الثاني — المستأجر' : 'الطرف الثاني — المستأجر / ممثله', (data.tenant[K.name] ?? '').trim(), false)}</div>`,
    `<p class="signed-note">${T('حُرّر هذا العقد من نسختين، بيد كل طرف نسخة للعمل بموجبها.')}</p>`,
  )

  // ---------- الترويسة ----------
  const issued = parseDate(cv(K.startDate)) ?? new Date()
  const meta: [string, string][] = [
    ['رقم المستند', cv(K.newNo) || '—'],
    ['التاريخ', `${dmy(issued)} ${o.t('م')}`],
    ...(hijri(issued) ? ([['الموافق', `${hijri(issued)} ${o.t('هـ')}`]] as [string, string][]) : []),
    ...(cv(K.termMode) ? ([['نمط المدة', cv(K.termMode)]] as [string, string][]) : []),
  ]
  const orgLines = [[o.org.city, o.org.phone].filter((v) => v.trim()).join(' · '), o.org.email].filter((v) => v.trim())
  const subtitle = vehicle ? 'VEHICLE RENTAL AGREEMENT' : activity ? 'COMMERCIAL LEASE AGREEMENT' : 'LEASE AGREEMENT'
  const logo = o.org.logo ? `<img class="org-logo" src="data:${imageMime(o.org.logo)};base64,${o.org.logo}" alt="">` : ''
  const header =
    `<header class="lh">${logo}<div class="org"><b>${esc(o.org.name)}</b>${orgLines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` +
    `<div class="meta">${meta.map(([k, v], i) => `<div class="${i % 2 ? '' : 'alt'}"><span>${T(k)}</span><b><bdi>${esc(v)}</bdi></b></div>`).join('')}</div></header>` +
    `<div class="rule"></div><h1>${T(o.title)}</h1><p class="sub" dir="ltr">${subtitle}</p>`

  const font = (file: string, weight: number) => `@font-face{font-family:'LeaseCairo';font-weight:${weight};src:url(${o.origin}/fonts/${file}) format('woff2');}`
  return [
    `<!DOCTYPE html><html lang="${o.lang}" dir="${o.dir}"><head><meta charset="utf-8"><title>${esc(o.t(o.title))}</title><style>`,
    font('Cairo-Regular.woff2', 400),
    font('Cairo-SemiBold.woff2', 600),
    font('Cairo-Bold.woff2', 700),
    font('Cairo-ExtraBold.woff2', 800),
    LEASE_CSS,
    '</style></head><body>',
    o.org.logo ? `<div class="wm"><img src="data:${imageMime(o.org.logo)};base64,${o.org.logo}" alt=""></div>` : '',
    '<div class="topbar"><i></i></div>',
    header,
    ...body,
    `<footer class="foot">${T('صادر إلكترونيًا عبر تطبيق Fundly')} · ${dmy(new Date())} — ${T('أي كشط أو تعديل يدوي يُبطل هذا المستند')}</footer>`,
    '</body></html>',
  ].join('')
}

/* ألوان التطبيق: _deep 0A5A50، _gold C9A24A، _goldText 9A8040، _ink 16302B. */
const LEASE_CSS = `
@page{size:A4;margin:11mm 11mm 12mm;}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{background:#fff;}
body{font-family:'LeaseCairo','Cairo',sans-serif;color:#16302B;font-size:10.5px;line-height:1.55;
-webkit-print-color-adjust:exact;print-color-adjust:exact;position:relative;}
@media screen{html{background:#E9EEED;}body{max-width:210mm;margin:16px auto;padding:12mm 11mm;
box-shadow:0 4px 24px rgba(2,46,42,.12);border-radius:6px;min-height:297mm;}}
bdi{unicode-bidi:isolate;}
.topbar{position:fixed;top:0;left:0;right:0;height:5px;background:#0A5A50;}
.topbar i{position:absolute;top:0;left:0;width:140px;height:5px;background:#C9A24A;}
.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0;}
.wm img{width:260px;height:260px;object-fit:contain;opacity:.05;}
.lh{display:flex;align-items:flex-start;gap:10px;position:relative;z-index:1;}
.org-logo{width:52px;height:52px;object-fit:contain;}
.org{flex:1;display:flex;flex-direction:column;}
.org b{font-size:16px;font-weight:800;color:#0A5A50;}
.org span{font-size:10px;color:#5C6B68;}
.meta{width:220px;border:1px solid #D8E3E0;border-radius:6px;overflow:hidden;}
.meta div{display:flex;justify-content:space-between;gap:8px;padding:3px 8px;}
.meta div.alt{background:#F5F9F8;}
.meta span{font-size:9.5px;color:#5C6B68;}
.meta b{font-size:10px;font-weight:700;}
.rule{height:1.5px;background:#0A5A50;margin:9px 0 12px;}
h1{text-align:center;font-size:22px;font-weight:800;color:#022E2A;}
.sub{text-align:center;font-size:9px;letter-spacing:2px;color:#9A8040;margin-bottom:8px;}
.sec{margin-top:12px;position:relative;z-index:1;}
.sec-h{display:flex;align-items:center;gap:7px;margin-bottom:6px;break-after:avoid;}
.sec-h .num{width:18px;height:18px;border-radius:50%;background:#0A5A50;color:#fff;font-size:9px;font-weight:700;
display:inline-flex;align-items:center;justify-content:center;flex:none;}
.sec-h b{font-size:13px;font-weight:800;color:#0A5A50;white-space:nowrap;}
.sec-h i{flex:1;height:1px;background:#D8E3E0;}
.kv{display:grid;border:1px solid #D8E3E0;border-radius:6px;overflow:hidden;}
.kv .cell{display:flex;gap:6px;padding:5px 8px;border-top:1px solid #EEF3F2;}
.kv .cell span{font-size:9.5px;color:#5C6B68;white-space:nowrap;}
.kv .cell b{flex:1;font-size:10.5px;font-weight:700;text-align:end;}
.kv-long{display:flex;gap:9px;margin-top:5px;padding:6px 8px;border:1px solid #D8E3E0;border-radius:6px;}
.kv-long span{font-size:9.5px;color:#5C6B68;white-space:nowrap;}
.kv-long b{flex:1;font-size:10.5px;font-weight:700;}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:4px 0 6px;}
.kpi{border:1px solid #D8E3E0;border-radius:8px;padding:7px 9px;}
.kpi span{display:block;font-size:9px;color:#5C6B68;}
.kpi b{display:block;font-size:15px;font-weight:800;color:#022E2A;}
.kpi small{font-size:8.5px;color:#8C9A97;}
.kpi.strong{background:#0A5A50;border-color:#0A5A50;}
.kpi.strong span,.kpi.strong b,.kpi.strong small{color:#fff;}
.tb{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #D8E3E0;border-radius:6px;overflow:hidden;}
.tb thead{display:table-header-group;}
.tb tr{break-inside:avoid;}
.tb th{background:#0A5A50;color:#fff;font-size:9.5px;font-weight:700;padding:6px 7px;text-align:start;}
.tb td{font-size:10px;padding:5px 7px;border-top:1px solid #EEF3F2;}
.tb tbody tr:nth-child(even) td{background:#F7FAF9;}
.tb tfoot td{background:#E9F4F1;font-weight:800;color:#022E2A;}
.tb .n{text-align:end;white-space:nowrap;font-variant-numeric:tabular-nums;}
.tb .idx{width:24px;text-align:center;color:#8C9A97;}
.note{margin-top:6px;padding:5px 8px;background:#F4F8F7;border-inline-start:3px solid #C9A24A;font-size:10px;color:#5C6B68;}
.clause{padding:4px 0;border-bottom:1px solid #EEF3F2;font-size:11px;}
.clause b{color:#0A5A50;}
.signs{display:flex;gap:10px;margin-top:16px;break-inside:avoid;}
.sign{flex:1;display:flex;gap:8px;height:118px;padding:9px;border:1px solid #D8E3E0;border-radius:8px;}
.sign-main{flex:1;display:flex;flex-direction:column;}
.sign .lbl{font-size:9.5px;font-weight:700;color:#9A8040;}
.sign b{font-size:12px;font-weight:700;}
.sign .sig{flex:1;display:flex;align-items:flex-end;}
.sign .sig svg{height:38px;width:auto;max-width:100%;}
.sign i{display:block;height:1px;background:#AFC0BC;}
.sign small{font-size:9px;color:#8C9A97;}
.stamp{width:78px;display:flex;align-items:center;justify-content:center;}
.stamp img{max-width:78px;max-height:78px;object-fit:contain;}
.stamp .ring{width:70px;height:70px;border-radius:50%;border:1px solid #B9CBC7;display:flex;align-items:center;justify-content:center;font-size:9px;color:#8C9A97;}
.signed-note{text-align:center;font-size:10.5px;color:#5C6B68;margin-top:10px;}
.foot{margin-top:18px;padding-top:6px;border-top:1px solid #D8E3E0;font-size:8.5px;color:#8C9A97;}
`
