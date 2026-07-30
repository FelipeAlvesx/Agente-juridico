import { NavLink } from 'react-router-dom'
import {
  IconDashboard, IconUsers, IconSparkles,
  IconCalendar, IconBriefcase, IconSettings, IconChat, IconBarChart2,
} from './Icon'

type NavItem = {
  to: string
  label: string
  icon: React.ReactNode
  end?: boolean
}

const MENU_ITEMS: NavItem[] = [
  { to: '/',              label: 'Dashboard',    icon: <IconDashboard />, end: true },
  { to: '/pacientes',     label: 'Pacientes',    icon: <IconUsers /> },
  { to: '/servicos',      label: 'Serviços',     icon: <IconSparkles /> },
  { to: '/agendamentos',  label: 'Agendamentos', icon: <IconCalendar /> },
  { to: '/profissionais', label: 'Profissionais', icon: <IconBriefcase /> },
  { to: '/conversas',     label: 'Conversas',    icon: <IconChat /> },
  { to: '/metricas',      label: 'Métricas',     icon: <IconBarChart2 /> },
]

const SYSTEM_ITEMS: NavItem[] = [
  { to: '/configuracoes', label: 'Configurações', icon: <IconSettings /> },
]

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
          isActive
            ? 'bg-white/20 text-white font-medium shadow-sm'
            : 'text-white/65 hover:bg-white/10 hover:text-white'
        }`
      }
    >
      <span className="shrink-0 transition-transform duration-200 group-hover:scale-110">
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}

export function Sidebar() {
  return (
    <aside className="w-60 min-h-screen bg-primary flex flex-col shrink-0 shadow-xl">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-base leading-none">L</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Lumina</p>
            <p className="text-white/50 text-xs">Clínica Estética</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-white/30 text-[10px] uppercase tracking-widest px-3 mb-2">Menu</p>
        {MENU_ITEMS.map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}

        <div className="pt-4">
          <p className="text-white/30 text-[10px] uppercase tracking-widest px-3 mb-2">Sistema</p>
          {SYSTEM_ITEMS.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
        </div>
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/25 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-semibold">A</span>
          </div>
          <div className="min-w-0">
            <p className="text-white text-xs font-medium truncate">Administrador</p>
            <p className="text-white/40 text-[10px] truncate">lumina@clinica.com.br</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
