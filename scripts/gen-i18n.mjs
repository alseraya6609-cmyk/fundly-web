// يولّد قواميس اللغات الأربع للموقع من قواميس التطبيق نفسها، فتبقى الترجمة
// مطابقة للتطبيق حرفًا بحرف.
//
// الاستعمال (من مجلد fundly-web):
//   node scripts/gen-i18n.mjs C:\Users\alzai\fundly
//
// يقرأ lib/l10n/app_translations*.dart من مجلد التطبيق، ويجمع كل نص عربي
// مكتوب في ملفات client/، ثم يكتب client/i18n/{en,fr,ur,zh}.json بالنصوص
// المستعملة في الموقع فقط (القواميس كاملة أكبر من 2 ميغا).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = process.argv[2]
if (!appDir) {
  console.error('اكتب مسار مجلد التطبيق، مثال: node scripts/gen-i18n.mjs C:\\Users\\alzai\\fundly')
  process.exit(1)
}

const files = {
  en: 'app_translations.dart',
  fr: 'app_translations_fr.dart',
  ur: 'app_translations_ur.dart',
  zh: 'app_translations_zh.dart',
}

function unescapeDart(text) {
  return text.replace(/\\(.)/g, (_, ch) => {
    if (ch === 'n') return '\n'
    if (ch === 't') return '\t'
    return ch
  })
}

function readDartMap(file) {
  const source = fs.readFileSync(file, 'utf8')
  const map = new Map()
  const entry = /'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = entry.exec(source)) !== null) map.set(unescapeDart(m[1]), unescapeDart(m[2]))
  return map
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    // مجلد القواميس نفسه لا يُمسح (فيه نصوص أردية بالحروف العربية).
    if (fs.statSync(full).isDirectory()) {
      if (name !== 'i18n') walk(full, out)
    }
    else if (/\.(tsx?|ts)$/.test(name)) out.push(full)
  }
  return out
}

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const arabic = /[\u0600-\u06FF]/
const used = new Set()
// القوالب `...` لا تُترجم كاملة؛ ما يُترجم داخلها مكتوب بـ t('...') فيُلتقط هنا.
const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g
for (const file of walk(path.join(root, 'client'))) {
  const source = fs.readFileSync(file, 'utf8')
  let m
  while ((m = literal.exec(source)) !== null) {
    const raw = m[1] ?? m[2] ?? ''
    if (!arabic.test(raw)) continue
    used.add(raw.replace(/\\(.)/g, '$1'))
  }
}

const outDir = path.join(root, 'client', 'i18n')
fs.mkdirSync(outDir, { recursive: true })
for (const [lang, file] of Object.entries(files)) {
  const dict = readDartMap(path.join(appDir, 'lib', 'l10n', file))
  const out = {}
  const missing = []
  for (const key of [...used].sort()) {
    if (dict.has(key)) out[key] = dict.get(key)
    else missing.push(key)
  }
  fs.writeFileSync(path.join(outDir, `${lang}.json`), JSON.stringify(out, null, 0) + '\n')
  console.log(`${lang}: ${Object.keys(out).length} نصًا، و${missing.length} بلا ترجمة في التطبيق`)
  if (lang === 'en' && missing.length) {
    fs.writeFileSync(path.join(outDir, 'missing.txt'), missing.join('\n') + '\n')
  }
}
