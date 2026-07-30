import { Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { Overview } from './pages/Overview'
import { Appointments } from './pages/Appointments'
import { Contacts } from './pages/Contacts'
import { Conversations } from './pages/Conversations'
import { Metrics } from './pages/Metrics'
import { Servicos } from './pages/Servicos'
import { Profissionais } from './pages/Profissionais'
import { Configuracoes } from './pages/Configuracoes'

export default function App() {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="flex-1 px-8 py-7 overflow-auto min-w-0">
        <Routes>
          <Route path="/"               element={<Overview />} />
          <Route path="/pacientes"      element={<Contacts />} />
          <Route path="/servicos"       element={<Servicos />} />
          <Route path="/agendamentos"   element={<Appointments />} />
          <Route path="/profissionais"  element={<Profissionais />} />
          <Route path="/conversas"      element={<Conversations />} />
          <Route path="/metricas"       element={<Metrics />} />
          <Route path="/configuracoes"  element={<Configuracoes />} />
          {/* Legacy routes */}
          <Route path="/appointments"  element={<Appointments />} />
          <Route path="/contacts"      element={<Contacts />} />
          <Route path="/conversations" element={<Conversations />} />
        </Routes>
      </main>
    </div>
  )
}
