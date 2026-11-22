/*
  الموقع الحالي من المتصفح — مقابل _fetchCurrentLocation / _sharedFetchLocation
  و«استخدام موقعي الحالي» في الأفراد (Geolocator في التطبيق).
  القيمة «خط العرض,خط الطول» بست خانات عشرية كما يحفظها التطبيق.
*/

export type GeoResult = { ok: true; value: string } | { ok: false; message: string }

export const GEO_OFF = 'خدمة الموقع مغلقة على الجهاز — فعّلها ثم أعد المحاولة'
export const GEO_DENIED = 'لم يُسمح بالوصول إلى الموقع'
export const GEO_FAILED = 'تعذر جلب الموقع'

export function currentLocation(): Promise<GeoResult> {
  return new Promise((resolve) => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined
    if (!geo) {
      resolve({ ok: false, message: GEO_OFF })
      return
    }
    try {
      geo.getCurrentPosition(
        (p) => resolve({ ok: true, value: `${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)}` }),
        (e) => resolve({ ok: false, message: e.code === 1 ? GEO_DENIED : e.code === 2 ? GEO_OFF : GEO_FAILED }),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      )
    } catch {
      resolve({ ok: false, message: GEO_FAILED })
    }
  })
}

/** «استخدام موقعي الحالي» في نموذج الفرد: رابط بحث خرائط جوجل بالإحداثيات. */
export const mapsSearchUrl = (query: string) =>
  query.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}` : 'https://www.google.com/maps'

export const coordsMapsUrl = (coords: string) => `https://www.google.com/maps/search/?api=1&query=${coords}`

/** pasteMapsLink: أول رابط في الحافظة، أو '' إن لم يوجد أو مُنعت القراءة. */
export async function clipboardLink(): Promise<string> {
  try {
    const text = (await navigator.clipboard.readText()).trim()
    return /https?:\/\/\S+/.exec(text)?.[0] ?? ''
  } catch {
    return ''
  }
}
