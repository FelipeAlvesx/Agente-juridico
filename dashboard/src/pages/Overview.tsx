import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'
import {
  format, parseISO, subDays, addDays, isWithinInterval, startOfDay, endOfDay,
  isToday, isAfter, eachDayOfInterval,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, followUpBucket, needsAction, STALE_DAYS } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { StatCard } from '../components/StatCard'
import { RefreshBar } from '../components/RefreshBar'
import { Page, PageHeader, Reveal, Section, EmptyState, SkeletonCards } from '../components/Page'
import { ChartTooltip, MeterRow, axisProps } from '../components/Chart'
import { SERIES, FUNNEL_RAMP, shortArea, initials, shortPhone, hueFor } from '../lib/theme'
import { itemVariants, quick, revealItem, stagger } from '../lib/motion'
import {
  IconUsers, IconCalendar, IconTrendUp, IconClock, IconGavel,
  IconBellRing, IconArrowRight, IconScale,
} from '../components/Icon'

type Period = '7d' | '30d' | '90d' | 'year'

const PERIOD_LABELS: Record<Period, string> = {
  '7d':  '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  year:  '12 meses',
}

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90, year: 365 }

function interval(p: Period) {
  return { start: startOfDay(subDays(new Date(), PERIOD_DAYS[p] - 1)), end: endOfDay(new Date()) }
}

function safeIn(iso: string | null | undefined, range: { start: Date; end: Date }) {
  if (!iso) return false
  try { return isWithinInterval(parseISO(iso), range) } catch { return false }
}

/** Cartão da faixa "precisa de você": ação pendente, não métrica. */
function ActionCard({
  count, label, hint, icon, to, tone,
}: {
  count: number
  label: string
  hint: string
  icon: React.ReactNode
  to: string
  tone: 'brass' | 'critical' | 'calm'
}) {
  const navigate = useNavigate()
  const idle = count === 0
  const tones = {
    brass:    'bg-brass/10 text-brass ring-brass/20',
    critical: 'bg-red-50 text-red-700 ring-red-200',
    calm:     'bg-primary/8 text-primary ring-primary/15',
  }
  return (
    <motion.button
      variants={itemVariants}
      whileHover={{ y: -3, transition: quick }}
      whileTap={{ scale: 0.985 }}
      onClick={() => navigate(to)}
      className={`group card flex items-center gap-4 text-left w-full ${idle ? 'opacity-65' : ''}`}
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ring-1 ${idle ? 'bg-slate-50 text-slate-300 ring-slate-100' : tones[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-2xl leading-none font-semibold text-ink tabular-nums">{count}</p>
        <p className="text-[13px] font-medium text-ink mt-1 truncate">{label}</p>
        <p className="text-xs text-slate-400 truncate">{idle ? 'nada pendente' : hint}</p>
      </div>
      <span className="text-slate-300 group-hover:text-primary transition-colors shrink-0">
        <IconArrowRight className="w-4 h-4" />
      </span>
    </motion.button>
  )
}

export function Overview() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('30d')

  const { data: leads, refetch: refetchLeads, lastUpdated, loading } = useFetch(() => api.getLeads({ limit: 500 }))
  const { data: appointments, refetch: refetchApts } = useFetch(() => api.getAppointments())
  const { data: escalations, refetch: refetchEsc } = useFetch(() => api.getEscalations(100))
  const { data: config } = useFetch(() => api.getConfig(), 300_000)

  function refetch() { refetchLeads(); refetchApts(); refetchEsc() }

  const periodLeads = useMemo(
    () => { const r = interval(period); return (leads ?? []).filter((l) => safeIn(l.created_at, r)) },
    [leads, period],
  )
  const periodApts = useMemo(
    () => { const r = interval(period); return (appointments ?? []).filter((a) => safeIn(a.datetime, r)) },
    [appointments, period],
  )

  /* ── Pendências: o que trava o escritório hoje ── */
  const pendingApts = (appointments ?? []).filter(needsAction)
  const staleLeads = (leads ?? []).filter((l) => followUpBucket(l) !== null)
  const urgentEsc = (escalations ?? []).filter((e) => e.category === 'urgencia_prazo')

  /* ── Próximas consultas ── */
  const upcoming = useMemo(
    () =>
      (appointments ?? [])
        .filter((a) => {
          if (a.status === 'cancelled' || a.status === 'rejected') return false
          try { return isAfter(parseISO(a.datetime), startOfDay(new Date())) } catch { return false }
        })
        .sort((a, b) => a.datetime.localeCompare(b.datetime))
        .slice(0, 5),
    [appointments],
  )

  const todayCount = (appointments ?? []).filter((a) => {
    try { return isToday(parseISO(a.datetime)) && a.status !== 'cancelled' } catch { return false }
  }).length

  /* ── Série temporal: todo dia do intervalo existe, mesmo zerado ── */
  const activity = useMemo(() => {
    const buckets: Record<string, number> = {}
    for (const l of periodLeads) {
      if (!l.created_at) continue
      try {
        const key = format(parseISO(l.created_at), 'yyyy-MM-dd')
        buckets[key] = (buckets[key] ?? 0) + 1
      } catch { /* data inválida: ignora */ }
    }
    const days = eachDayOfInterval(interval(period))
    // Acima de ~60 pontos o eixo vira sopa: agrupa de 7 em 7.
    const step = days.length > 60 ? 7 : 1
    const out: { date: string; total: number }[] = []
    for (let i = 0; i < days.length; i += step) {
      let total = 0
      for (let k = 0; k < step && i + k < days.length; k++) {
        total += buckets[format(addDays(days[i], k), 'yyyy-MM-dd')] ?? 0
      }
      out.push({ date: format(days[i], step === 1 ? 'dd/MM' : 'dd MMM', { locale: ptBR }), total })
    }
    return out
  }, [periodLeads, period])

  /* ── Áreas mais procuradas — excedente vira "Outras", nunca 7ª cor ── */
  const areas = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of periodLeads) {
      if (l.area_juridica) counts[l.area_juridica] = (counts[l.area_juridica] ?? 0) + 1
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 5).map(([name, value]) => ({ name: shortArea(name), value }))
    const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0)
    return rest > 0 ? [...top, { name: 'Outras', value: rest }] : top
  }, [periodLeads])

  const qualified = periodLeads.filter((l) => l.qualified).length
  const confirmed = periodApts.filter((a) => a.status === 'confirmed').length
  const convRate = periodLeads.length > 0 ? Math.round((periodApts.length / periodLeads.length) * 100) : 0

  const funnelSteps = [
    { label: 'Chegaram',        value: periodLeads.length },
    { label: 'Qualificados',    value: qualified },
    { label: 'Agendaram',       value: periodApts.length },
    { label: 'Confirmadas',     value: confirmed },
    { label: 'Viraram cliente', value: periodLeads.filter((l) => l.status === 'cliente').length },
  ]

  return (
    <Page>
      <PageHeader
        title="Painel"
        subtitle={`${config?.name ?? 'Escritório'} · ${format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}`}
        actions={<RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />}
      />

      {/* Faixa de ação — vem antes de qualquer métrica */}
      <motion.div variants={stagger(0, 0.06)} className="grid gap-4 md:grid-cols-3 mb-7">
        <ActionCard
          count={pendingApts.length}
          label="Consultas a confirmar"
          hint="o cliente escolheu horário e aguarda o escritório"
          icon={<IconCalendar className="w-5 h-5" />}
          to="/agenda"
          tone="brass"
        />
        <ActionCard
          count={escalations?.length ?? 0}
          label="Casos para triagem"
          hint={urgentEsc.length > 0 ? `${urgentEsc.length} com menção a prazo` : 'pedidos que o agente passou adiante'}
          icon={<IconGavel className="w-5 h-5" />}
          to="/triagem"
          tone={urgentEsc.length > 0 ? 'critical' : 'calm'}
        />
        <ActionCard
          count={staleLeads.length}
          label="Leads sem retorno"
          hint={`parados há ${STALE_DAYS} dias ou mais`}
          icon={<IconBellRing className="w-5 h-5" />}
          to="/follow-up"
          tone="brass"
        />
      </motion.div>

      {/* Filtro de período — uma linha só, acima dos números */}
      <Reveal className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-slate-400 mr-1">Período</span>
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={period === p ? 'tab-btn-active' : 'tab-btn-inactive'}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </Reveal>

      {/* KPIs */}
      <motion.div variants={stagger(0, 0.06)} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {!leads ? (
          <SkeletonCards count={4} />
        ) : (
          <>
            <StatCard
              label="Contatos"
              subtitle="quem escreveu no período"
              value={periodLeads.length}
              icon={<IconUsers className="w-5 h-5" />}
            />
            <StatCard
              label="Triagem completa"
              subtitle={`${periodLeads.length > 0 ? Math.round((qualified / periodLeads.length) * 100) : 0}% dos contatos`}
              value={qualified}
              icon={<IconScale className="w-5 h-5" />}
            />
            <StatCard
              label="Consultas confirmadas"
              subtitle={`de ${periodApts.length} agendadas`}
              value={confirmed}
              icon={<IconCalendar className="w-5 h-5" />}
            />
            <StatCard
              label="Conversão"
              subtitle="contato → consulta agendada"
              value={`${convRate}%`}
              icon={<IconTrendUp className="w-5 h-5" />}
            />
          </>
        )}
      </motion.div>

      {/* Série + funil */}
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Section
          title="Contatos ao longo do tempo"
          subtitle="primeira mensagem de cada pessoa"
          className="lg:col-span-2"
        >
          {activity.length === 0 ? (
            <EmptyState title="Nenhum contato no período" hint="Assim que alguém escrever no WhatsApp, aparece aqui." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={activity} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axisProps} allowDecimals={false} width={34} />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: SERIES[0], strokeWidth: 1, strokeDasharray: '3 3', strokeOpacity: 0.4 }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Contatos"
                  stroke={SERIES[0]}
                  strokeWidth={2}
                  fill="url(#areaFill)"
                  dot={false}
                  activeDot={{ r: 4.5, fill: SERIES[0], stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="Funil do período" subtitle="onde as pessoas param">
          <div className="space-y-3.5 pt-1">
            {funnelSteps.map((s, i) => (
              <MeterRow
                key={s.label}
                label={s.label}
                value={s.value}
                total={funnelSteps[0].value}
                color={FUNNEL_RAMP[i]}
                delay={0.1 + i * 0.07}
              />
            ))}
          </div>
        </Section>
      </div>

      {/* Próximas consultas + áreas */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Section
          title="Próximas consultas"
          subtitle={todayCount > 0 ? `${todayCount} hoje` : 'nenhuma hoje'}
          actions={
            <button onClick={() => navigate('/agenda')} className="btn-ghost !px-2 !py-1 text-xs">
              Ver agenda <IconArrowRight className="w-3.5 h-3.5" />
            </button>
          }
        >
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<IconCalendar className="w-10 h-10" />}
              title="Sem consultas marcadas"
              hint="As consultas agendadas pelo agente no WhatsApp aparecem aqui."
            />
          ) : (
            <motion.ul variants={stagger(0.1, 0.05)} initial="initial" animate="animate" className="space-y-2">
              <AnimatePresence>
                {upcoming.map((a, i) => {
                  const d = parseISO(a.datetime)
                  return (
                    <motion.li
                      key={a.id}
                      {...revealItem(i)}
                      whileHover={{ x: 3, transition: quick }}
                      onClick={() => navigate('/agenda')}
                      className="flex items-center gap-3 p-3 rounded-xl border border-line hover:border-primary/25 hover:bg-surface-2 cursor-pointer transition-colors"
                    >
                      <div className="w-11 shrink-0 text-center">
                        <p className="font-display text-lg leading-none font-semibold text-ink">{format(d, 'dd')}</p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">
                          {format(d, 'MMM', { locale: ptBR })}
                        </p>
                      </div>
                      <div className="w-px self-stretch bg-line" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink truncate">{a.nome || shortPhone(a.phone)}</p>
                        <p className="text-xs text-slate-400 truncate">{shortArea(a.procedure) || 'Consulta'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium text-ink tabular-nums">{format(d, 'HH:mm')}</p>
                        <p className={`text-[11px] ${a.status === 'confirmed' ? 'text-emerald-700' : 'text-brass'}`}>
                          {a.status === 'confirmed' ? 'confirmada' : 'a confirmar'}
                        </p>
                      </div>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </motion.ul>
          )}
        </Section>

        <Section title="Áreas mais procuradas" subtitle="por contato no período">
          {areas.length === 0 ? (
            <EmptyState title="Ainda sem área registrada" hint="A área jurídica é preenchida na triagem do agente." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, areas.length * 38)}>
              <BarChart data={areas} layout="vertical" margin={{ left: 4, right: 24, top: 2, bottom: 2 }} barCategoryGap={6}>
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis dataKey="name" type="category" width={104} {...axisProps} tick={{ fontSize: 12, fill: '#334155' }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#14203308' }} />
                <Bar dataKey="value" name="Contatos" radius={[0, 4, 4, 0]} animationBegin={200} animationDuration={700}>
                  {/* Uma medida só: um hue. "Outras" fica neutro por ser agregado. */}
                  {areas.map((a) => (
                    <Cell key={a.name} fill={a.name === 'Outras' ? '#94A3B8' : SERIES[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* Últimos que chegaram — leitura rápida do topo do funil */}
      <div className="mt-4">
        <Section
          title="Chegaram por último"
          subtitle="ordem de primeira mensagem"
          actions={
            <button onClick={() => navigate('/funil')} className="btn-ghost !px-2 !py-1 text-xs">
              Ver funil <IconArrowRight className="w-3.5 h-3.5" />
            </button>
          }
        >
          {!leads ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 w-full" />)}</div>
          ) : leads.length === 0 ? (
            <EmptyState
              icon={<IconClock className="w-10 h-10" />}
              title="Nenhum contato registrado"
              hint="Todo mundo que escrever no WhatsApp entra aqui — inclusive quem não terminar a triagem."
            />
          ) : (
            <motion.div variants={stagger(0.1, 0.04)} initial="initial" animate="animate" className="grid sm:grid-cols-2 gap-2">
              {[...leads]
                .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
                .slice(0, 6)
                .map((l, i) => (
                  <motion.button
                    key={l.phone}
                    {...revealItem(i)}
                    whileHover={{ x: 3, transition: quick }}
                    onClick={() => navigate(`/conversas?phone=${encodeURIComponent(l.phone)}`)}
                    className="flex items-center gap-3 p-2.5 rounded-xl border border-line hover:border-primary/25 hover:bg-surface-2 transition-colors text-left"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
                      style={{ background: hueFor(l.phone) }}
                    >
                      {initials(l.nome, l.phone)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink truncate">{l.nome || shortPhone(l.phone)}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {shortArea(l.area_juridica) || 'área ainda não informada'}
                      </p>
                    </div>
                  </motion.button>
                ))}
            </motion.div>
          )}
        </Section>
      </div>
    </Page>
  )
}
