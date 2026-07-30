import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  FunnelChart, Funnel, LabelList,
  PieChart, Pie,
} from 'recharts'
import { parseISO, getHours, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { RefreshBar } from '../components/RefreshBar'

const PRIMARY   = '#7C3D6E'
const GOLD      = '#C5A87D'
const COLORS    = [PRIMARY, GOLD, '#9B5089', '#D4BB99', '#5E2D53', '#2D6E7C']

const ESC_CATEGORY: Record<string, { label: string; color: string; bg: string }> = {
  medica:            { label: 'Médica',          color: '#DC2626', bg: '#FEE2E2' },
  reclamacao:        { label: 'Reclamação',       color: '#EA580C', bg: '#FFEDD5' },
  pedido_humano:     { label: 'Pedido de humano', color: '#2563EB', bg: '#DBEAFE' },
  confusao_repetida: { label: 'Confusão repetida',color: '#D97706', bg: '#FEF3C7' },
  fora_escopo:       { label: 'Fora do escopo',   color: '#6B7280', bg: '#F3F4F6' },
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-xl px-3 py-2 text-xs">
      <p className="font-semibold text-gray-600 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color ?? PRIMARY }} className="font-medium">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  pending:              'Pendente',
  confirmed:            'Confirmado',
  rejected:             'Rejeitado',
  cancelled:            'Cancelado',
  reschedule_requested: 'Remarcação',
  cancel_requested:     'Cancelamento',
}

const HOUR_LABELS = ['9h','10h','11h','12h','13h','14h','15h','16h','17h','18h']

export function Metrics() {
  const { data: stats, refetch: refetchStats, lastUpdated, loading }
    = useFetch(() => api.getStats())
  const { data: leads, refetch: refetchLeads }
    = useFetch(() => api.getLeads({ limit: 500 }))
  const { data: appointments, refetch: refetchApts }
    = useFetch(() => api.getAppointments())
  const { data: escalations, refetch: refetchEsc }
    = useFetch(() => api.getEscalations(50))

  function refetch() { refetchStats(); refetchLeads(); refetchApts(); refetchEsc() }

  /* Funil com drop-off */
  const funnelData = useMemo(() => {
    if (!stats) return []
    const steps = [
      { name: 'Contatos',     value: stats.leads_total,            fill: PRIMARY },
      { name: 'Qualificados', value: stats.leads_qualified,        fill: '#9B5089' },
      { name: 'Agendamentos', value: stats.appointments_total,     fill: GOLD },
      { name: 'Confirmados',  value: stats.appointments_confirmed, fill: '#D4BB99' },
    ]
    const base = steps[0].value || 1
    return steps.map((s, i) => ({
      ...s,
      label: `${s.name} ${i > 0 ? `(${Math.round(s.value / base * 100)}%)` : ''}`.trim(),
    }))
  }, [stats])

  /* Drop-off entre etapas */
  const dropoffs = useMemo(() => {
    if (!stats) return []
    const steps = [
      stats.leads_total,
      stats.leads_qualified,
      stats.appointments_total,
      stats.appointments_confirmed,
    ]
    return steps.slice(1).map((v, i) => ({
      from: ['Contatos', 'Qualificados', 'Agendados'][i],
      to:   ['Qualificados', 'Agendados', 'Confirmados'][i],
      pct:  steps[i] > 0 ? Math.round(v / steps[i] * 100) : 0,
    }))
  }, [stats])

  /* Procedimentos */
  const procedureData = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads ?? []) {
      if (l.procedimento_interesse)
        counts[l.procedimento_interesse] = (counts[l.procedimento_interesse] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }))
  }, [leads])

  /* Status dos agendamentos */
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of appointments ?? []) counts[a.status] = (counts[a.status] ?? 0) + 1
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABEL[status] ?? status, value,
    }))
  }, [appointments])

  /* Horários de pico (por hora) */
  const peakHourData = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const l of leads ?? []) {
      if (!l.created_at) continue
      try { const h = getHours(parseISO(l.created_at)); counts[h] = (counts[h] ?? 0) + 1 } catch { /* */ }
    }
    return HOUR_LABELS.map((label, i) => ({ label, contatos: counts[9 + i] ?? 0 }))
  }, [leads])

  /* Indicação / fonte */
  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads ?? []) {
      if (l.indicacao) counts[l.indicacao] = (counts[l.indicacao] ?? 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
  }, [leads])

  /* Taxas */
  const convRate = stats && stats.leads_total > 0
    ? Math.round((stats.appointments_total / stats.leads_total) * 100) : 0
  const qualRate = stats && stats.leads_total > 0
    ? Math.round((stats.leads_qualified / stats.leads_total) * 100) : 0
  const escRate = stats && stats.leads_total > 0
    ? Math.round((stats.escalations_total / stats.leads_total) * 100) : 0

  const isEmpty = !stats || stats.leads_total === 0

  return (
    <div className="space-y-6 animate-fade-in pb-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Métricas</h1>
          <p className="text-sm text-gray-400 mt-0.5">Performance do agente Lara</p>
        </div>
        <RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Taxa de qualificação', value: `${qualRate}%`, sub: 'contatos → qualificados', color: PRIMARY },
          { label: 'Taxa de conversão',    value: `${convRate}%`, sub: 'contatos → agendamentos', color: GOLD },
          { label: 'Agendamentos',         value: stats?.appointments_total ?? 0,   sub: 'total gerados', color: PRIMARY },
          { label: 'Escalações',           value: `${escRate}%`, sub: `${stats?.escalations_total ?? 0} total`, color: '#D97706' },
        ].map(k => (
          <div key={k.label} className="card flex flex-col gap-1.5">
            <p className="text-xs text-gray-400 font-medium">{k.label}</p>
            <p className="text-3xl font-bold" style={{ color: k.color }}>{k.value}</p>
            <p className="text-xs text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Funil + procedimentos */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Funil de conversão</h2>
          <p className="text-xs text-gray-400 mb-4">Contatos → Qualificados → Agendados → Confirmados</p>
          {isEmpty ? (
            <div className="h-52 flex items-center justify-center text-sm text-gray-300">Sem dados ainda</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <FunnelChart>
                  <Tooltip content={<CustomTooltip />} />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive animationBegin={200} animationDuration={800}>
                    <LabelList position="right" fill="#374151" stroke="none" dataKey="label" style={{ fontSize: 11 }} />
                    <LabelList position="center" fill="#fff" stroke="none" dataKey="value" style={{ fontSize: 12, fontWeight: 600 }} />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
              {dropoffs.length > 0 && (
                <div className="flex justify-around mt-3 pt-3 border-t border-gray-50">
                  {dropoffs.map(d => (
                    <div key={d.from} className="text-center">
                      <p className="text-[10px] text-gray-400">{d.from} → {d.to}</p>
                      <p className="text-sm font-bold" style={{ color: d.pct >= 50 ? PRIMARY : '#D97706' }}>{d.pct}%</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Procedimentos mais solicitados</h2>
          <p className="text-xs text-gray-400 mb-4">Por interesse declarado no WhatsApp</p>
          {procedureData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-gray-300">Sem dados ainda</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={procedureData} layout="vertical" margin={{ left: 8, right: 20, top: 4, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Contatos" radius={[0, 6, 6, 0]} isAnimationActive animationBegin={200}>
                  {procedureData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Horários de pico + Fonte */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Horários de pico</h2>
          <p className="text-xs text-gray-400 mb-4">Contatos recebidos por hora do dia</p>
          {isEmpty ? (
            <div className="h-44 flex items-center justify-center text-sm text-gray-300">Sem dados ainda</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={peakHourData} margin={{ left: -16, right: 8, top: 4, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="contatos" name="Contatos" radius={[4, 4, 0, 0]} fill={PRIMARY} isAnimationActive animationBegin={300} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Canais de origem</h2>
          <p className="text-xs text-gray-400 mb-4">Como as clientes chegaram à Lumina</p>
          {sourceData.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-sm text-gray-300">Sem dados ainda</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={sourceData}
                    cx="50%" cy="50%"
                    outerRadius={68}
                    dataKey="value"
                    paddingAngle={2}
                    isAnimationActive
                    animationBegin={200}
                    animationDuration={800}
                    label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-3 mt-1">
                {sourceData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-xs text-gray-500">{d.name}</span>
                    <span className="text-xs font-semibold text-gray-700">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status dos agendamentos */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Status dos agendamentos</h2>
        {statusData.length === 0 ? (
          <div className="h-20 flex items-center justify-center text-sm text-gray-300">Sem agendamentos</div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {statusData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2 card py-2 px-4">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="text-sm text-gray-600">{d.name}</span>
                <span className="text-sm font-bold" style={{ color: COLORS[i % COLORS.length] }}>{d.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Painel de escalações */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Escalações recentes</h2>
            <p className="text-xs text-gray-400 mt-0.5">Atendimentos transferidos para a equipe</p>
          </div>
          {(escalations ?? []).length > 0 && (
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700">
              {escalations!.length} total
            </span>
          )}
        </div>

        {(escalations ?? []).length === 0 ? (
          <div className="h-16 flex items-center justify-center text-sm text-gray-300">Nenhuma escalação registrada</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left pb-2 text-gray-400 font-medium pr-4">Cliente</th>
                  <th className="text-left pb-2 text-gray-400 font-medium pr-4">Categoria</th>
                  <th className="text-left pb-2 text-gray-400 font-medium pr-4">Motivo</th>
                  <th className="text-right pb-2 text-gray-400 font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {escalations!.map((e) => {
                  const cat = ESC_CATEGORY[e.category] ?? ESC_CATEGORY.pedido_humano
                  let dateStr = ''
                  try { dateStr = format(parseISO(e.created_at), "dd/MM HH:mm", { locale: ptBR }) } catch { dateStr = e.created_at }
                  return (
                    <tr key={e.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="py-2.5 pr-4 font-medium text-gray-700">
                        {e.nome ?? e.phone.slice(-4).padStart(8, '·')}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ color: cat.color, background: cat.bg }}
                        >
                          {cat.label}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500 max-w-xs truncate">{e.reason || '—'}</td>
                      <td className="py-2.5 text-right text-gray-400 whitespace-nowrap">{dateStr}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
