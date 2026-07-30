import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Sidebar } from './components/Sidebar'
import { Overview } from './pages/Overview'
import { Appointments } from './pages/Appointments'
import { Contacts } from './pages/Contacts'
import { Pipeline } from './pages/Pipeline'
import { Conversations } from './pages/Conversations'
import { Metrics } from './pages/Metrics'
import { FollowUp } from './pages/FollowUp'
import { Triagem } from './pages/Triagem'
import { Configuracoes } from './pages/Configuracoes'

export default function App() {
  const location = useLocation()

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="flex-1 px-8 py-7 overflow-x-hidden min-w-0">
        {/* mode="wait": a tela que sai termina antes da próxima entrar. */}
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={location.pathname}>
            <Route path="/"              element={<Overview />} />
            <Route path="/funil"         element={<Pipeline />} />
            <Route path="/follow-up"     element={<FollowUp />} />
            <Route path="/triagem"       element={<Triagem />} />
            <Route path="/agenda"        element={<Appointments />} />
            <Route path="/clientes"      element={<Contacts />} />
            <Route path="/conversas"     element={<Conversations />} />
            <Route path="/relatorios"    element={<Metrics />} />
            <Route path="/configuracoes" element={<Configuracoes />} />

            {/* Rotas da engine de estética — redirecionam para o nome jurídico. */}
            <Route path="/pacientes"     element={<Navigate to="/clientes" replace />} />
            <Route path="/pipeline"      element={<Navigate to="/funil" replace />} />
            <Route path="/agendamentos"  element={<Navigate to="/agenda" replace />} />
            <Route path="/metricas"      element={<Navigate to="/relatorios" replace />} />
            <Route path="/servicos"      element={<Navigate to="/configuracoes" replace />} />
            <Route path="/profissionais" element={<Navigate to="/configuracoes" replace />} />
            <Route path="/appointments"  element={<Navigate to="/agenda" replace />} />
            <Route path="/contacts"      element={<Navigate to="/clientes" replace />} />
            <Route path="/conversations" element={<Navigate to="/conversas" replace />} />
            <Route path="*"              element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
      </main>
    </div>
  )
}
