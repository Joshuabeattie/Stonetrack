// Every page and who may see it.
import { Navigate, Route, Routes } from 'react-router'
import type { Role } from '../../shared/catalog'
import { RequireRole, homeFor, useAuth } from './auth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'

const STAFF: Role[] = ['admin', 'manager']

function Home() {
  const { status, user } = useAuth()
  if (status === 'loading') return <div className="page-loading" aria-busy="true" />
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      {/* Public: the client's tracking link. No sign-in. */}


      {/* Office pages share the navigation layout */}
      <Route element={<RequireRole roles={STAFF}><Layout /></RequireRole>}>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
