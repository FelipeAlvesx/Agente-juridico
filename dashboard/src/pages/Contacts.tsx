import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Lead } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { StatusBadge } from '../components/StatusBadge'
import { IconSearch, IconPlus } from '../components/Icon'

function initials(name: string | null, fallback: string) {
  if (!name) return fallback.slice(0, 2).toUpperCase()
  const parts = name.trim().split(' ')
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

const AVATAR_COLORS = [
  '#7C3D6E','#2D6E7C','#2D7C3D','#7C6E2D','#3D2D7C','#7C2D2D',
]

function avatarColor(id: number) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length]
}

export function Contacts() {
  const { data } = useFetch(() => api.getLeads({ limit: 500 }))
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.toLowerCase()
    if (!q) return data
    return data.filter(l =>
      (l.nome ?? '').toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      (l.procedimento_interesse ?? '').toLowerCase().includes(q)
    )
  }, [data, query])

  return (
    <div className="space-y-5 animate-fade-in pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pacientes</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {data ? `${data.length} cliente${data.length !== 1 ? 's' : ''} cadastrado${data.length !== 1 ? 's' : ''}` : 'Carregando...'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <IconSearch className="w-4 h-4" />
            </span>
            <input
              type="text"
              placeholder="Buscar paciente..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="input pl-9 w-60"
            />
          </div>
          <button className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <IconPlus className="w-4 h-4" />
            Novo Paciente
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-5 py-3.5">Paciente</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3.5">Telefone</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3.5">Procedimento</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3.5">Indicação</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3.5">Primeiro contato</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-sm text-gray-400">
                    {query ? 'Nenhum paciente encontrado.' : 'Nenhum paciente cadastrado ainda.'}
                  </td>
                </tr>
              )}
              {filtered.map((lead: Lead) => (
                <tr
                  key={lead.phone}
                  onClick={() => navigate(`/conversas?phone=${encodeURIComponent(lead.phone)}`)}
                  className="border-b border-gray-50 hover:bg-surface-2 transition-colors duration-150 cursor-pointer group"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 transition-transform duration-200 group-hover:scale-110"
                        style={{ background: avatarColor(parseInt(lead.phone.replace(/\D/g, '').slice(-6), 10) || 0) }}
                      >
                        {initials(lead.nome, lead.phone)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{lead.nome ?? '(sem nome)'}</p>
                        <p className="text-xs text-gray-400">{lead.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-gray-500">{lead.phone}</td>
                  <td className="px-4 py-3.5">
                    {lead.procedimento_interesse ? (
                      <span className="text-sm text-gray-700">{lead.procedimento_interesse}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {lead.indicacao ? (
                      <span className="text-sm text-gray-500">{lead.indicacao}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-sm text-gray-500">
                    {lead.created_at ? format(parseISO(lead.created_at), "d MMM yyyy", { locale: ptBR }) : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={lead.qualified ? 'returning' : 'new'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
