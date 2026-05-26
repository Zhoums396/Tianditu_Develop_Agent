import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { RequireAuth } from './components/auth/RequireAuth'
import { WorkspacePage } from './pages/WorkspacePage'
import { HomePage } from './pages/HomePage'
import { ShareViewerPage } from './pages/ShareViewerPage'
import { PublicGalleryPage } from './pages/PublicGalleryPage'
import { RunDossiersPage } from './pages/RunDossiersPage'
import { TiandituTokenModal } from './components/auth/TiandituTokenModal'
import { ChatWidgetLoader } from './components/chat/ChatWidgetLoader'
import { appBasePath } from './utils/basePath'

export default function App() {
  return (
    <BrowserRouter basename={appBasePath || undefined}>
      <Routes>
        <Route path="/" element={<><HomePage /><ChatWidgetLoader /></>} />
        <Route path="/workspace" element={<RequireAuth><WorkspacePage /></RequireAuth>} />
        <Route path="/share/:slug" element={<ShareViewerPage />} />
        <Route path="/gallery" element={<><PublicGalleryPage /><ChatWidgetLoader /></>} />
        <Route path="/runs" element={<RequireAuth><RunDossiersPage /></RequireAuth>} />
      </Routes>
      <TiandituTokenModal />
    </BrowserRouter>
  )
}
