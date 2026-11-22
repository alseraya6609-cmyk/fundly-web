import { REPORT_CSS } from './reports'

/*
  buildRecordPdf (template_print.dart) على الويب: مستند A4 بأقسام —
  أزواج «عنوان: قيمة» وجداول — بترويسة Fundly (الشعار والاسم ورقم المستند
  والتاريخ والموافق) أو بدونها (askPdfLetterhead). الجدول الذي يزيد على
  6 أعمدة يُطبع سطرًا سطرًا كأزواج كما في التطبيق.
  الحفظ PDF من نافذة الطباعة في المتصفح.
*/

export type PrintSection = { title: string; pairs?: [string, string][]; heads?: string[]; rows?: string[][] }

export type RecordDoc = { title: string; subtitle: string; letterhead: boolean; sections: PrintSection[]; meta?: [string, string][] }

export type RecordOptions = { t: (s: string) => string; lang: string; dir: 'rtl' | 'ltr'; origin: string }

const esc = (input: string) =>
  String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** pdfSafeText: التشكيل يُحذف من النصوص قبل الطباعة. */
export const pdfSafeText = (value: string) => String(value ?? '').replace(/[ً-ْٰ]/g, '').trim()

const two = (n: number) => String(n).padStart(2, '0')
export const dmy = (d: Date) => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`

/** printHijri: التاريخ الهجري (أم القرى) بأرقام لاتينية. */
export function hijri(d: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    const year = get('year').replace(/\D/g, '')
    return year ? `${get('day')}/${get('month')}/${year}` : ''
  } catch {
    return ''
  }
}

const RECORD_CSS = `
.kv{width:100%;border-collapse:separate;border-spacing:0;margin-bottom:4px;}
.kv td{padding:6px 8px;border-bottom:1px solid #EEF3F2;font-size:10.5px;background:none !important;}
.kv td.k{width:34%;color:#5C6B68;font-weight:700;}
.kv td.v{color:#1d2b29;font-weight:700;}
.meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:10px;color:#5C6B68;margin:8px 4px 0;}
.meta b{color:#0A5A50;}
.plain-title{padding:4px 4px 10px;border-bottom:2px solid #E9F4F1;margin-bottom:12px;}
.row-gap{height:6px;}
`

export function buildRecordHtml(doc: RecordDoc, o: RecordOptions): string {
  const T = (s: string) => esc(o.t(s))
  const font = (file: string, weight: number) =>
    `@font-face{font-family:'ReportCairo';font-weight:${weight};src:url(${o.origin}/fonts/${file}) format('woff2');}`
  const now = new Date()
  const h: string[] = [
    `<!DOCTYPE html><html lang="${o.lang}" dir="${o.dir}"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>`,
    font('Cairo-Regular.woff2', 400),
    font('Cairo-SemiBold.woff2', 600),
    font('Cairo-Bold.woff2', 700),
    font('Cairo-ExtraBold.woff2', 800),
    REPORT_CSS,
    RECORD_CSS,
    '</style></head><body>',
  ]
  const meta: [string, string][] = [
    ['التاريخ', `${dmy(now)} ${o.t('م')}`],
    ...(hijri(now) ? ([['الموافق', `${hijri(now)} ${o.t('هـ')}`]] as [string, string][]) : []),
    ...(doc.meta ?? []).filter((m) => m[1].trim()),
  ]
  if (doc.letterhead) {
    h.push(
      '<header class="head"><div class="brand">',
      `<img class="logo" src="${o.origin}/img/logo.png" alt="">`,
      `<div class="brand-text"><div class="app">Fundly</div><div class="app-sub">${T('إدارة الالتزامات والأصول')}</div></div></div><div class="doc-id">`,
      `<span class="kind">${esc(doc.subtitle)}</span>`,
      ...meta.map(([k, v]) => `<div class="ref">${T(k)}: <b>${esc(v)}</b></div>`),
      '</div></header>',
      `<div class="title-block"><h1>${esc(doc.title)}</h1></div>`,
    )
  } else {
    h.push(`<div class="plain-title"><h1>${esc(doc.title)}</h1></div>`)
  }

  const kv = (pairs: [string, string][]) =>
    pairs.length ? `<table class="kv"><tbody>${pairs.map(([k, v]) => `<tr><td class="k">${T(k)}</td><td class="v"><bdi>${esc(v || '—')}</bdi></td></tr>`).join('')}</tbody></table>` : ''

  for (const s of doc.sections) {
    const parts: string[] = [kv(s.pairs ?? [])]
    const heads = s.heads ?? []
    const rows = s.rows ?? []
    if (rows.length && heads.length) {
      if (heads.length > 6) {
        for (const row of rows) parts.push('<div class="row-gap"></div>', kv(heads.slice(0, row.length).map((head, i) => [head, row[i]] as [string, string])))
      } else {
        parts.push(
          `<table class="details"><thead><tr>${heads.map((x) => `<th>${T(x)}</th>`).join('')}</tr></thead><tbody>`,
          rows.map((r) => `<tr>${r.map((c) => `<td><bdi>${esc(c)}</bdi></td>`).join('')}</tr>`).join(''),
          '</tbody></table>',
        )
      }
    }
    if (parts.join('').trim()) h.push(`<section class="block"><div class="sec-title">${T(s.title)}</div>${parts.join('')}</section>`)
  }

  if (doc.letterhead) h.push(`<footer class="foot"><span>${T('صدر من تطبيق')} Fundly</span><span>${dmy(now)}</span></footer>`)
  h.push('</body></html>')
  return h.join('')
}
