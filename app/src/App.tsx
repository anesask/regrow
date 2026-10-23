import { Box, Spinner } from '@chakra-ui/react'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import OverviewPage from '@/routes/OverviewPage'

const PlotsPage = lazy(() => import('@/routes/PlotsPage'))
const PlotPage = lazy(() => import('@/routes/PlotPage'))
const TransparencyPage = lazy(() => import('@/routes/TransparencyPage'))
const MethodologyPage = lazy(() => import('@/routes/MethodologyPage'))
const StewardPage = lazy(() => import('@/routes/StewardPage'))
const StewardsPage = lazy(() => import('@/routes/StewardsPage'))
const AdminPage = lazy(() => import('@/routes/AdminPage'))
const SupportersPage = lazy(() => import('@/routes/SupportersPage'))
const HowItWorksPage = lazy(() => import('@/routes/HowItWorksPage'))
const ImpactPage = lazy(() => import('@/routes/ImpactPage'))
const ResearchPage = lazy(() => import('@/routes/ResearchPage'))
const FunderPage = lazy(() => import('@/routes/FunderPage'))
const CertificatePage = lazy(() => import('@/routes/CertificatePage'))
const ImprintPage = lazy(() => import('@/routes/LegalPages').then((m) => ({ default: m.ImprintPage })))
const PrivacyPage = lazy(() => import('@/routes/LegalPages').then((m) => ({ default: m.PrivacyPage })))
const NotFoundPage = lazy(() => import('@/routes/NotFoundPage'))

const page = (el: ReactNode) => (
  <Suspense
    fallback={
      <Box py="20" textAlign="center">
        <Spinner color="brand.solid" />
      </Box>
    }
  >
    {el}
  </Suspense>
)

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/plots" element={page(<PlotsPage />)} />
          <Route path="/plot/:id" element={page(<PlotPage />)} />
          <Route path="/transparency" element={page(<TransparencyPage />)} />
          <Route path="/methodology" element={page(<MethodologyPage />)} />
          <Route path="/steward" element={page(<StewardPage />)} />
          <Route path="/stewards" element={page(<StewardsPage />)} />
          <Route path="/admin" element={page(<AdminPage />)} />
          <Route path="/supporters" element={page(<SupportersPage />)} />
          <Route path="/how-it-works" element={page(<HowItWorksPage />)} />
          <Route path="/impact" element={page(<ImpactPage />)} />
          <Route path="/research" element={page(<ResearchPage />)} />
          <Route path="/funder/:address" element={page(<FunderPage />)} />
          <Route path="/certificate/:id" element={page(<CertificatePage />)} />
          <Route path="/imprint" element={page(<ImprintPage />)} />
          <Route path="/privacy" element={page(<PrivacyPage />)} />
          {/* old paths */}
          <Route path="/map" element={<Navigate to="/plots" replace />} />
          <Route path="/ledger" element={<Navigate to="/transparency" replace />} />
          <Route path="*" element={page(<NotFoundPage />)} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
