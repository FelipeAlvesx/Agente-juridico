import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts'
import { format, parseISO, subDays, isWithinInterval, startOfDay, endOfDay, isToday } from 'date-fns'
import { api } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { StatCard } from '../components/StatCard'
import { RefreshBar } from '../components/RefreshBar'
import { IconUsers, IconCalendar, IconTrendUp, IconClock } from '../components/Icon'

type Period = 'today' | 'yesterday' | '7d' | '30d' | 'prev' | 'year'

const PERIOD_LABELS: Record<Period, string> = {
  today:     'Hoje',
  yesterday: 'Ontem',
  '7d':      'Últimos 7 dias',
  '30d':     'Este mês',
  prev:      'Mês passado',
  year:      'Este ano',
}

const COLORS = ['#7C3D6E', '#C5A87D', '#9B5089', '#D4BB99', '#5E2D53', '#2D6E7C']

function getPeriodInterval(p: Period): { start: Date; end: Date } {
  const now = new Date()
  switch (p) {
    case 'today':     return { start: startOfDay(now), end: endOfDay(now) }
    case 'yesterday': return { start: startOfDay(subDays(now, 1)), end: endOfDay(subDays(now, 1)) }
    case '7d':        return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) }
    case '30d':       return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) }
    case 'prev':      return { start: startOfDay(subDays(now, 59)), end: endOfDay(subDays(now, 30)) }
    case 'year':      return { start: startOfDay(subDays(now, 364)), end: endOfDay(now) }
  }
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-xl px-3 py-2 text-xs">
      <p className="font-semibold text-gray-600 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-medium">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

export function Overview() {
  const [period, setPeriod] = useState<Period>('30d')
  const { data: leads, refetch: refetchLeads, lastUpdated, loading }
    = useFetch(() => api.getLeads({ limit: 500 }))
  const { data: appointments, refetch: refetchApts }
    = useFetch(() => api.getAppointments())
  const { data: stats }
    = useFetch(() => api.getStats())

  function refetch() { refetchLeads(); refetchApts() }

  const interval = getPeriodInterval(period)

  const filteredLeads = useMemo(
    () => leads?.filter(l => {
      try { return !!l.created_at && isWithinInterval(parseISO(l.created_at), interval) } catch { return false }
    }) ?? [],
    [leads, interval]
  )

  const filteredApts = useMemo(
    () => appointments?.filter(a => {
      try { return isWithinInterval(parseISO(a.datetime), interval) } catch { return false }
    }) ?? [],
    [appointments, interval]
  )

  const todayApts = useMemo(
    () => appointments?.filter(a => {
      try { return isToday(parseISO(a.datetime)) } catch { return false }
    }).length ?? 0,
    [appointments]
  )

  const convRate = filteredLeads.length > 0
    ? Math.round((filteredApts.length / filteredLeads.length) * 100) : 0

  /* Activity line chart — contacts per day */
  const activityData = useMemo(() => {
    const days: Record<string, number> = {}
    for (const l of leads ?? []) {
      try {
        if (!l.created_at) continue
        const key = format(parseISO(l.created_at), 'dd/MM')
        days[key] = (days[key] ?? 0) + 1
      } catch { /* skip */ }
    }
    return Object.entries(days).slice(-30).map(([date, total]) => ({ date, total }))
  }, [leads])

  /* Top procedures */
  const procedureData = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of filteredLeads) {
      if (l.procedimento_interesse)
        counts[l.procedimento_interesse] = (counts[l.procedimento_interesse] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }))
  }, [filteredLeads])

  /* Apt status pie */
  const statusPieData = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of filteredApts) counts[a.status] = (counts[a.status] ?? 0) + 1
    const labelMap: Record<string, string> = {
      pending: 'Pendentes', confirmed: 'Confirmados',
      rejected: 'Rejeitados', cancelled: 'Cancelados',
      reschedule_requested: 'Remarcação', cancel_requested: 'Cancelamento',
    }
    return Object.entries(counts).map(([status, value]) => ({ name: labelMap[status] ?? status, value }))
  }, [filteredApts])

  return (
    <div className="space-y-6 animate-fade-in pb-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Visão geral do negócio</p>
        </div>
        <RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />
      </div>

      {/* Period tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={period === p ? 'tab-btn-active' : 'tab-btn-inactive'}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <StatCard
          label="Clientes no período"
          subtitle="Contatos registrados"
          value={filteredLeads.length}
          icon={<IconUsers className="w-5 h-5" />}
          delay={0}
        />
        <StatCard
          label="Taxa de conversão"
          subtitle="contatos → agendamentos"
          value={`${convRate}%`}
          icon={<IconTrendUp className="w-5 h-5" />}
          delay={80}
        />
        <StatCard
          label="Confirmados"
          subtitle={`de ${filteredApts.length} agendamentos`}
          value={filteredApts.filter(a => a.status === 'confirmed').length}
          icon={<IconCalendar className="w-5 h-5" />}
          delay={160}
        />
        <StatCard
          label="Pendentes"
          subtitle={`${todayApts} agendamento${todayApts !== 1 ? 's' : ''} hoje`}
          value={stats?.appointments_pending ?? filteredApts.filter(a => a.status === 'pending').length}
          icon={<IconClock className="w-5 h-5" />}
          delay={240}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Contatos ao longo do tempo</h2>
          <p className="text-xs text-gray-400 mb-4">Novos contatos por dia</p>
          {activityData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-gray-300">Sem dados ainda</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={activityData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#7C3D6E" stopOpacity={0.25}/>
                    <stop offset="100%" stopColor="#7C3D6E" stopOpacity={0.03}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false}/>
                <Tooltip content={<CustomTooltip />}/>
                <Area type="monotone" dataKey="total" name="Contatos" stroke="#7C3D6E" strokeWidth={2} fill="url(#grad)" dot={false} activeDot={{ r: 4, fill: '#7C3D6E', strokeWidth: 0 }}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card animate-fade-in-up" style={{ animationDelay: '160ms' }}>
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Funil rápido</h2>
          <p className="text-xs text-gray-400 mb-4">Conversão do período</p>
          {!stats ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-300">Sem dados</div>
          ) : (
            <div className="space-y-3 pt-2">
              {[
                { label: 'Contatos',     value: filteredLeads.length, color: '#7C3D6E' },
                { label: 'Qualificados', value: filteredLeads.filter(l => l.qualified).length, color: '#9B5089' },
                { label: 'Agendados',    value: filteredApts.length, color: '#C5A87D' },
                { label: 'Confirmados',  value: filteredApts.filter(a => a.status === 'confirmed').length, color: '#D4BB99' },
              ].map((step, _i, arr) => {
                const pct = arr[0].value > 0 ? Math.round(step.value / arr[0].value * 100) : 0
                const barW = pct > 0 ? Math.max(pct, 8) : 0
                return (
                  <div key={step.label}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-gray-600">{step.label}</span>
                      <span className="text-xs font-semibold text-gray-800">
                        {step.value} <span className="text-gray-400 font-normal">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${barW}%`, background: step.color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Procedimentos mais solicitados</h2>
          {procedureData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-300">Sem dados ainda</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={procedureData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false}/>
                <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false}/>
                <Tooltip content={<CustomTooltip />}/>
                <Bar dataKey="value" name="Contatos" radius={[0, 6, 6, 0]} isAnimationActive animationBegin={300} animationDuration={800}>
                  {procedureData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card animate-fade-in-up" style={{ animationDelay: '260ms' }}>
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Status dos agendamentos</h2>
          {statusPieData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-300">Sem agendamentos</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%" cy="50%"
                    outerRadius={78}
                    dataKey="value"
                    paddingAngle={2}
                    isAnimationActive
                    animationBegin={300}
                    animationDuration={800}
                    label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {statusPieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />}/>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-3 mt-1">
                {statusPieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }}/>
                    <span className="text-xs text-gray-500">{d.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
