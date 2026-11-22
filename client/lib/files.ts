import { supabase } from './supabase'
import { FILES_BUCKET, fileKey } from './data'

/*
  رفع ملف كما يحفظه التطبيق في مجلده ثم يرفعه (DocumentStore.copyIntoApp
  و FundlyFiles.syncUp):
  - الاسم «وقت بالملّي ثانية_اسم الملف» بعد استبدال الرموز غير المسموحة.
  - يُرفع إلى مخزن fundly-files بمفتاح base64Url للاسم.
  - يُحفظ الاسم في السجل، والتطبيق يجده بالاسم في مجلده بعد تنزيله
    (DocumentStore.localPathFor)، ويراه بقية أعضاء السجل المشترك لأن اسمه
    مذكور فيه (fundly_name_visible).
*/

const MAX_BYTES = 25 * 1024 * 1024

export class FileError extends Error {}

export async function uploadDeviceFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new FileError('حجم الملف أكبر من 25 ميغابايت')
  const safe = file.name.replace(/[\\/:*?"<>|]/g, '_')
  const name = `${Date.now()}_${safe}`
  const { error } = await supabase.storage.from(FILES_BUCKET).upload(fileKey(name), file, {
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error
  return name
}
