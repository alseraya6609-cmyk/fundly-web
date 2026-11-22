import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { Empty } from '@/components/ui'

export default function NotFound() {
  const { t } = useI18n()
  return (
    <div className="pt-10">
      <Empty icon={SearchX} text="الصفحة غير موجودة" />
      <div className="mt-4 text-center">
        <Link to="/" className="text-[14px] font-bold text-brand underline">
          {t('الرئيسية')}
        </Link>
      </div>
    </div>
  )
}
