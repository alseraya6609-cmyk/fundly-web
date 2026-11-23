import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { SessionProvider, useSession } from '@/lib/session'
import { AppShell } from '@/components/AppShell'
import { DocNameHost } from '@/components/DocName'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import { Personal, Shared } from '@/pages/Entries'
import People from '@/pages/People'
import Assets from '@/pages/Assets'
import Summary from '@/pages/Summary'
import Requests from '@/pages/Requests'
import More from '@/pages/More'
import Documents from '@/pages/Documents'
import Calendar from '@/pages/Calendar'
import Archive from '@/pages/Archive'
import Trash from '@/pages/Trash'
import Reports from '@/pages/Reports'
import Salary from '@/pages/Salary'
import Delegations from '@/pages/Delegations'
import Support from '@/pages/Support'
import NotFound from '@/pages/NotFound'
import Landing from '@/pages/Landing'
import { Maintenance, PolicyConsent, Splash, Suspended } from '@/pages/Gates'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
})

/** البوابات بالترتيب نفسه في التطبيق: الصيانة، الإيقاف، السياسة، ثم الدخول. */
function Guarded() {
  const { ready, user, config, account, policyAccepted } = useSession()
  const location = useLocation()
  if (!ready) return <Splash />
  // الزائر على fundlyglobal.com يرى الصفحة التعريفية أولًا، وفيها الدخول وإنشاء الحساب.
  if (!user && location.pathname === '/') return <Landing />
  if (config?.maintenance) return <Maintenance />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (account?.suspended) return <Suspended />
  if (!policyAccepted) return <PolicyConsent />
  return <AppShell />
}

function LoginRoute() {
  const { ready } = useSession()
  if (!ready) return <Splash />
  return <Login />
}

/** الصفحة التعريفية لأي أحد، ولو كان مسجّلًا (رابط الشعار وزر «عن فوندلي»). */
function WelcomeRoute() {
  const { ready } = useSession()
  if (!ready) return <Splash />
  return <Landing />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SessionProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route path="/welcome" element={<WelcomeRoute />} />
              <Route element={<Guarded />}>
                <Route index element={<Home />} />
                <Route path="me" element={<Personal />} />
                <Route path="shared" element={<Shared />} />
                <Route path="people" element={<People />} />
                <Route path="assets" element={<Assets />} />
                <Route path="summary" element={<Summary />} />
                <Route path="documents" element={<Documents />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="archive" element={<Archive />} />
                <Route path="trash" element={<Trash />} />
                <Route path="reports" element={<Reports />} />
                <Route path="requests" element={<Requests />} />
                <Route path="salary" element={<Salary />} />
                <Route path="delegations" element={<Delegations />} />
                <Route path="support" element={<Support />} />
                <Route path="more" element={<More />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <DocNameHost />
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}
