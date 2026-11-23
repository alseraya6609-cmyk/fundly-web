/*
  منبّه «المتابعة والتخطيط» في الموقع (AlarmTone و FundlyNotifications._alarmDetails):
  الرنات المدمجة نفسها في التطبيق (public/sounds)، وتُختار لهذا المتصفح.
  - «الصوت المعتاد»: إشعار المتصفح وحده بلا رنة.
  - «إنذار مستمر حتى أوقفه»: تتكرر الرنة حتى يُضغط «إيقاف» أو الإشعار
    (وتتوقف وحدها بعد 5 دقائق).
  المتصفح لا يشغّل صوتًا إلا والموقع مفتوح وبعد أن تفاعلت معه مرة.
*/

export type Tone = { id: string; label: string }

export const DEFAULT_TONE = 'default'
const INITIAL_TONE = 'bell'

export const TONES: Tone[] = [
  { id: 'bell', label: 'جرس' },
  { id: 'chime', label: 'رنين هادئ' },
  { id: 'digital', label: 'منبّه رقمي' },
  { id: 'pulse', label: 'نبض سريع' },
  { id: 'melody', label: 'لحن' },
  { id: DEFAULT_TONE, label: 'صوت الإشعار المعتاد' },
]

const TONE_KEY = 'fundly_alarm_tone'
const INSISTENT_KEY = 'fundly_alarm_insistent'
const MAX_RING_MS = 5 * 60_000
export const ALARM_EVENT = 'fundly-alarm'

export type AlarmSettings = { tone: string; insistent: boolean }

export function alarmSettings(): AlarmSettings {
  try {
    const tone = localStorage.getItem(TONE_KEY) ?? INITIAL_TONE
    return { tone: TONES.some((x) => x.id === tone) ? tone : INITIAL_TONE, insistent: localStorage.getItem(INSISTENT_KEY) === '1' }
  } catch {
    return { tone: INITIAL_TONE, insistent: false }
  }
}

export function saveAlarmSettings(next: AlarmSettings) {
  try {
    localStorage.setItem(TONE_KEY, next.tone)
    localStorage.setItem(INSISTENT_KEY, next.insistent ? '1' : '0')
  } catch {
    // التخزين غير متاح: يبقى الاختيار لهذه الجلسة فقط.
  }
}

export const toneUrl = (id: string) => `/sounds/fundly_tone_${id}.wav`

let audio: HTMLAudioElement | null = null
let stopTimer: number | undefined
let ringingTitle = ''

const announce = () => window.dispatchEvent(new Event(ALARM_EVENT))

/** ما يرنّ الآن (عنوان التنبيه)، أو ''. */
export const ringing = () => ringingTitle

export function stopAlarm() {
  if (stopTimer) window.clearTimeout(stopTimer)
  stopTimer = undefined
  if (audio) {
    audio.pause()
    audio.currentTime = 0
  }
  audio = null
  if (ringingTitle) {
    ringingTitle = ''
    announce()
  }
}

/** يشغّل الرنة المختارة؛ [title] يظهر في شريط «إيقاف المنبّه». */
export async function playAlarm(title: string, override?: Partial<AlarmSettings>): Promise<boolean> {
  const settings = { ...alarmSettings(), ...override }
  if (settings.tone === DEFAULT_TONE) return false
  stopAlarm()
  const el = new Audio(toneUrl(settings.tone))
  el.loop = settings.insistent
  el.onended = () => {
    if (audio === el) stopAlarm()
  }
  audio = el
  ringingTitle = title
  announce()
  try {
    await el.play()
    stopTimer = window.setTimeout(stopAlarm, settings.insistent ? MAX_RING_MS : 30_000)
    return true
  } catch {
    // المتصفح منع التشغيل (لم يتفاعل المستخدم مع الصفحة بعد).
    stopAlarm()
    return false
  }
}
