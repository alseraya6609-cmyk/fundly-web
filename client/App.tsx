import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { SessionProvider, useSession } from '@/lib/session'
import { AppShell } from '@/components/AppShell'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import { Personal, Shared } from '@/pages/Entries'
import People from '@/pages/People'
import Assets from '@/pages/Assets'
import Summary from '@/pages/Summary'
import Requests from '@/pages/Requests'
import More from '@/pages/More'
import NotFound from '@/pages/NotFound'
import { Maintenance, PolicyConsent, Splash, Suspended } from '@/pages/Gates'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
})

/** البوابات بالترتيب نفسه في التطبيق: الصيانة، الإيقاف، السياسة، ثم الدخول. */
function Guarded() {
  const { ready, user, config, account, policyAccepted } = useSession()
  const location = useLocation()
  if (!ready) return <Splash />
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SessionProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route element={<Guarded />}>
                <Route index element={<Home />} />
                <Route path="me" element={<Personal />} />
                <Route path="shared" element={<Shared />} />
                <Route path="people" element={<People />} />
                <Route path="assets" element={<Assets />} />
                <Route path="summary" element={<Summary />} />
                <Route path="requests" element={<Requests />} />
                <Route path="more" element={<More />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}
