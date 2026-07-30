import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Lead, LeadStatus, MotivoPerda, MOTIVO_PERDA_LABELS } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { RefreshBar } from '../components/RefreshBar'
import { IconAlert, IconClock } from '../components/Icon'

const COLUMNS: { status: LeadStatus; label: string; hint: string; accent: string }[] = [
  { status: 'novo',              label: 'Novo',              hint: 'Chegou e ainda não qualificou', accent: 'bg-sky-400' },
  { status: 'qualificado',       label: 'Qualificado',       hint: 'Triagem completa',              accent: 'bg-purple-400' },
  { status: 'consulta_agendada', label: 'Consulta agendada', hint: 'Tem consulta ativa',            accent: 'bg-amber-400' },
  { status: 'cliente',           label: 'Cliente',           hint: 'Fechou com o escritório',       accent: 'bg-emerald-400' },
  { status: 'perdido',           label: 'Perdido',           hint: 'Não seguiu — com motivo',       accent: 'bg-gray-400' },
]

const MOTIVOS = Object.keys(MOTIVO_PERDA_LABELS) as MotivoPerda[]

/** Dias desde o último contato — o número que dispara follow-up. */
function staleDays(lead: Lead): number | null {
  if (!lead.last_contact) return null
  return Math.floor((Date.now() - parseISO(lead.last_contact).getTime()) / 86_400_000)
}

function LeadCard({ lead, onDragStart, onOpen }: {
  lead: Lead
  onDragStart: () => void
  onOpen: () => void
}) {
  const days = staleDays(lead)
  const stale = lead.status !== 'cliente' && lead.status !== 'perdido' && days !== null && days >= 3

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="bg-surface border border-gray-100 rounded-xl p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 truncate">{lead.nome || '(sem nome)'}</p>
        {stale && (
          <span title={`Sem contato há ${days} dias`} className="text-amber-500 shrink-0">
            <IconAlert className="w-4 h-4" />
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-0.5">{lead.phone.replace('@s.whatsapp.net', '')}</p>

      {lead.area_juridica && (
        <p className="text-xs text-gray-600 mt-2 truncate">{lead.area_juridica}</p>
      )}
      {lead.urgencia && (
        <p className="text-[11px] text-gray-400 truncate">urgência: {lead.urgencia}</p>
      )}
      {lead.status === 'perdido' && lead.motivo_perda && (
        <p className="text-[11px] text-gray-500 mt-2 bg-gray-50 rounded-lg px-2 py-1">
          {MOTIVO_PERDA_LABELS[lead.motivo_perda]}
          {lead.motivo_perda_detalhe && (
            <span className="block text-gray-400 mt-0.5">{lead.motivo_perda_detalhe}</span>
          )}
        </p>
      )}

      <div className="flex items-center gap-1 mt-2 text-[11px] text-gray-400">
        <IconClock className="w-3 h-3" />
        {lead.last_contact
          ? formatDistanceToNow(parseISO(lead.last_contact), { locale: ptBR, addSuffix: true })
          : 'sem contato registrado'}
      </div>
    </div>
  )
}

export function Pipeline() {
  const { data, refetch, lastUpdated, loading, error } = useFetch(() => api.getLeads({ limit: 500 }))
  const navigate = useNavigate()
  const [dragging, setDragging] = useState<Lead | null>(null)
  const [over, setOver] = useState<LeadStatus | null>(null)
  const [askMotivo, setAskMotivo] = useState<Lead | null>(null)
  const [saving, setSaving] = useState(false)

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map(c => [c.status, [] as Lead[]])) as Record<LeadStatus, Lead[]>
    for (const lead of data ?? []) map[lead.status]?.push(lead)
    return map
  }, [data])

  async function move(lead: Lead, status: LeadStatus, motivo?: MotivoPerda) {
    setSaving(true)
    try {
      await api.setLeadStatus(lead.phone, status, motivo)
      refetch()
    } finally {
      setSaving(false)
      setAskMotivo(null)
    }
  }

  function onDrop(status: LeadStatus) {
    const lead = dragging
    setDragging(null)
    setOver(null)
    if (!lead || lead.status === status) return
    if (status === 'perdido') setAskMotivo(lead)   // perdido exige motivo
    else move(lead, status)
  }

  return (
    <div className="space-y-5 animate-fade-in pb-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {data ? `${data.length} lead${data.length !== 1 ? 's' : ''} no funil` : 'Carregando...'}
            {' · '}arraste o card para mudar o status
          </p>
        </div>
        <RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />
      </div>

      {error && (
        <div className="card text-sm text-red-600">Falha ao carregar leads: {error}</div>
      )}

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(200px, 1fr))` }}>
        {COLUMNS.map(col => (
          <div
            key={col.status}
            onDragOver={e => { e.preventDefault(); setOver(col.status) }}
            onDragLeave={() => setOver(o => (o === col.status ? null : o))}
            onDrop={() => onDrop(col.status)}
            className={`rounded-2xl border p-3 min-h-[240px] transition-colors duration-150 ${
              over === col.status ? 'border-primary bg-primary/5' : 'border-gray-100 bg-surface-2'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${col.accent}`} />
              <p className="text-sm font-semibold text-gray-700">{col.label}</p>
              <span className="ml-auto text-xs font-semibold text-gray-400">
                {byStatus[col.status].length}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">{col.hint}</p>

            <div className="space-y-2">
              {byStatus[col.status].map(lead => (
                <LeadCard
                  key={lead.phone}
                  lead={lead}
                  onDragStart={() => setDragging(lead)}
                  onOpen={() => navigate(`/conversas?phone=${encodeURIComponent(lead.phone)}`)}
                />
              ))}
              {byStatus[col.status].length === 0 && (
                <p className="text-xs text-gray-300 text-center py-6">vazio</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {askMotivo && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="card max-w-sm w-full space-y-3 animate-scale-in">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Por que perdemos este lead?</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {askMotivo.nome || askMotivo.phone.replace('@s.whatsapp.net', '')}
              </p>
            </div>
            <div className="space-y-1.5">
              {MOTIVOS.map(m => (
                <button
                  key={m}
                  disabled={saving}
                  onClick={() => move(askMotivo, 'perdido', m)}
                  className="w-full text-left text-sm px-3 py-2 rounded-xl border border-gray-200 hover:bg-surface-2 hover:border-primary transition-colors duration-150 disabled:opacity-50"
                >
                  {MOTIVO_PERDA_LABELS[m]}
                </button>
              ))}
            </div>
            <button className="btn-ghost w-full" onClick={() => setAskMotivo(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
