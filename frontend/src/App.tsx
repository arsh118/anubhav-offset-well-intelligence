import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Dashboard } from './pages/Dashboard'
import { ActiveWellPage } from './pages/ActiveWell'
import { OffsetWellsPage } from './pages/OffsetWells'
import { KnowledgePage } from './pages/Knowledge'
import { AlertsPage } from './pages/Alerts'
import { DocumentsPage } from './pages/Documents'

function NotFound() {
  return <div className="not-found"><span>404</span><h1>Page not found</h1><p>This operations view is not available.</p><a href="/">Return to dashboard</a></div>
}

export default function App() {
  return <Routes><Route element={<AppShell />}>
    <Route path="/" element={<Dashboard />} />
    <Route path="/active-well" element={<ActiveWellPage />} />
    <Route path="/offsets" element={<OffsetWellsPage />} />
    <Route path="/knowledge" element={<KnowledgePage />} />
    <Route path="/alerts" element={<AlertsPage />} />
    <Route path="/documents" element={<DocumentsPage />} />
    <Route path="/home" element={<Navigate to="/" replace />} />
    <Route path="*" element={<NotFound />} />
  </Route></Routes>
}
