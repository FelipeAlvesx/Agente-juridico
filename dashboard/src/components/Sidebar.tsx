import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFetch } from '../hooks/useFetch'
import { api, followUpBucket, needsAction } from '../lib/api'
import { quick, springy } from '../lib/motion'
import {
  IconDashboard, IconUsers, IconCalendar, IconSettings,
  IconChat, IconBarChart2, IconTrendUp, IconBellRing, IconGavel, IconScale,
} from './Icon'

type NavItem = {
  to: string
  label: string
  icon: React.ReactNode
  end?: boolean
  /** Chave do contador de pendências exibido à direita. */
  badge?: 'triagem' | 'agenda' | 'followup'
}

const MENU_ITEMS: NavItem[] = [
  { to: '/',             label: 'Painel',        icon: <IconDashboard />, end: true },
  { to: '/funil',        label: 'Funil',         icon: <IconTrendUp /> },
  { to: '/follow-up',    label: 'Follow-up',     icon: <IconBellRing />,  badge: 'followup' },
  { to: '/triagem',      label: 'Triagem',       icon: <IconGavel />,     badge: 'triagem' },
  { to: '/agenda',       label: 'Agenda',        icon: <IconCalendar />,  badge: 'agenda' },
  { to: '/clientes',     label: 'Clientes',      icon: <IconUsers /> },
  { to: '/conversas',    label: 'Conversas',     icon: <IconChat /> },
  { to: '/relatorios',   label: 'Relatórios',    icon: <IconBarChart2 /> },
]

const SYSTEM_ITEMS: NavItem[] = [
  { to: '/configuracoes', label: 'Configurações', icon: <IconSettings /> },
]

function NavItemLink({ item, count }: { item: NavItem; count?: number }) {
  const { pathname } = useLocation()
  const active = item.end ? pathname === item.to : pathname.startsWith(item.to)

  return (
    <NavLink to={item.to} end={item.end} className="block">
      <motion.div
        whileHover={{ x: 3, transition: quick }}
        whileTap={{ scale: 0.97 }}
        className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-200 ${
          active ? 'text-white font-medium' : 'text-white/55 hover:text-white'
        }`}
      >
        {/* Pílula ativa compartilhada: desliza entre os itens em vez de piscar. */}
        {active && (
          <motion.span
            layoutId="nav-active"
            transition={springy}
            className="absolute inset-0 rounded-xl bg-white/12 ring-1 ring-white/10"
          />
        )}
        {active && (
          <motion.span
            layoutId="nav-active-rule"
            transition={springy}
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-brass-light"
          />
        )}

        <span className="relative shrink-0 transition-transform duration-200 group-hover:scale-110">
          {item.icon}
        </span>
        <span className="relative truncate">{item.label}</span>

        {count !== undefined && count > 0 && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={springy}
            className="relative ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-brass text-white
                       text-[11px] font-semibold flex items-center justify-center tabular-nums"
          >
            {count > 99 ? '99+' : count}
          </motion.span>
        )}
      </motion.div>
    </NavLink>
  )
}

export function Sidebar() {
  const { data: config } = useFetch(() => api.getConfig(), 300_000)
  const { data: escalations } = useFetch(() => api.getEscalations(100))
  const { data: leads } = useFetch(() => api.getLeads({ limit: 500 }))
  const { data: appointments } = useFetch(() => api.getAppointments())

  const counts = {
    triagem:  escalations?.length ?? 0,
    agenda:   (appointments ?? []).filter(needsAction).length,
    followup: (leads ?? []).filter((l) => followUpBucket(l) !== null).length,
  }

  const firmName = config?.name ?? 'Juris'

  return (
    <aside className="w-[15rem] min-h-screen bg-ink flex flex-col shrink-0 relative overflow-hidden">
      {/* Brilho de latão no topo — profundidade sem peso visual. */}
      <div className="pointer-events-none absolute -top-24 -left-16 w-72 h-72 rounded-full bg-brass/10 blur-3xl" />

      {/* Marca */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
        className="relative px-5 py-5 border-b border-white/8"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brass/20 ring-1 ring-brass/30 flex items-center justify-center shrink-0">
            <IconScale className="w-[18px] h-[18px] text-brass-light" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-white font-semibold text-[15px] leading-tight">Juris</p>
            <p className="text-white/40 text-[11px] truncate" title={firmName}>{firmName}</p>
          </div>
        </div>
      </motion.div>

      {/* Navegação */}
      <nav className="relative flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-white/25 text-[10px] uppercase tracking-[0.16em] px-3 mb-2">Atendimento</p>
        {MENU_ITEMS.map((item) => (
          <NavItemLink key={item.to} item={item} count={item.badge ? counts[item.badge] : undefined} />
        ))}

        <div className="pt-5">
          <p className="text-white/25 text-[10px] uppercase tracking-[0.16em] px-3 mb-2">Sistema</p>
          {SYSTEM_ITEMS.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
        </div>
      </nav>

      {/* Rodapé: quem responde pelo atendimento automático */}
      <div className="relative px-4 py-4 border-t border-white/8">
        <div className="flex items-center gap-3">
          <span className="relative flex w-2 h-2 shrink-0">
            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
          </span>
          <div className="min-w-0">
            <p className="text-white text-xs font-medium truncate">
              {config?.agent_name ?? 'Assistente'} no WhatsApp
            </p>
            <p className="text-white/35 text-[10px] truncate">recebendo o primeiro contato</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
