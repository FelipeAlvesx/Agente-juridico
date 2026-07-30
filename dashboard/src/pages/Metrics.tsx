import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { parseISO, getHours, differenceInHours } from 'date-fns'
import { api, MOTIVO_PERDA_LABELS, MotivoPerda } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { RefreshBar } from '../components/RefreshBar'
import { StatCard } from '../components/StatCard'
import { Page, PageHeader, Section, EmptyState, SkeletonCards } from '../components/Page'
import { ChartTooltip, MeterRow, axisProps } from '../components/Chart'
import { SERIES, FUNNEL_RAMP, STATUS, shortArea } from '../lib/theme'
import { stagger } from '../lib/motion'
import { IconUsers, IconTrendUp, IconClock, IconScale, IconBarChart2, IconGavel } from '../components/Icon'

const ESC_LABEL: Record<string, string> = {
  urgencia_prazo:        'Menção a prazo',
  processo_em_andamento: 'Processo em andamento',
  consulta_juridica:     'Pediu orientação',
  reclamacao:            'Reclamação',
  pedido_humano:         'Pediu humano',
  confusao_repetida:     'Conversa travada',
}

const HOURS = Array.from({ length: 10 }, (_, i) => 9 + i)

/** Barra horizontal simples reutilizada nos rankings — evita 4 BarCharts iguais. */
function Ranking({
  rows, total, colorFor, empty,
}: {
  rows: { name: string; value: number }[]
  total: number
  colorFor: (name: string, i: number) => string
  empty: string
}) {
  if (rows.length === 0) return <EmptyState title={empty} />
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <MeterRow
          key={r.name}
          label={r.name}
          value={r.value}
          total={total}
          color={colorFor(r.name, i)}
          delay={0.08 + i * 0.05}
        />
      ))}
    </div>
  )
}

export function Metrics() {
  const { data: stats, refetch: refetchStats, lastUpdated, loading } = useFetch(() => api.getStats())
  const { data: leads, refetch: refetchLeads } = useFetch(() => api.getLeads({ limit: 500 }))
  const { data: appointments, refetch: refetchApts } = useFetch(() => api.getAppointments())
  const { data: escalations, refetch: refetchEsc } = useFetch(() => api.getEscalations(100))

  function refetch() { refetchStats(); refetchLeads(); refetchApts(); refetchEsc() }

  const total     = stats?.leads_total ?? 0
  const qualified = stats?.leads_qualified ?? 0
  const booked    = stats?.appointments_total ?? 0
  const confirmed = stats?.appointments_confirmed ?? 0
  const clients   = (leads ?? []).filter((l) => l.status === 'cliente').length
  const lost      = (leads ?? []).filter((l) => l.status === 'perdido').length

  const funnel = [
    { label: 'Chegaram no WhatsApp', value: total },
    { label: 'Triagem completa',     value: qualified },
    { label: 'Agendaram consulta',   value: booked },
    { label: 'Consulta confirmada',  value: confirmed },
    { label: 'Viraram cliente',      value: clients },
  ]

  /* Onde o funil sangra: queda percentual de uma etapa para a próxima. */
  const dropoffs = funnel.slice(1).map((step, i) => {
    const prev = funnel[i].value
    return {
      from: funnel[i].label,
      to: step.label,
      keptPct: prev > 0 ? Math.round((step.value / prev) * 100) : 0,
      lost: Math.max(prev - step.value, 0),
    }
  })

  /**
   * Tempo do primeiro "oi" até a consulta marcada. É o número que o escritório
   * usa para saber se a triagem automática está segurando gente na fila.
   */
  const avgHoursToBook = useMemo(() => {
    const byPhone = Object.fromEntries((leads ?? []).map((l) => [l.phone, l.created_at]))
    const spans: number[] = []
    for (const a of appointments ?? []) {
      const first = byPhone[a.phone]
      if (!first || !a.created_at) continue
      try {
        const h = differenceInHours(parseISO(a.created_at), parseISO(first))
        if (h >= 0 && h < 24 * 90) spans.push(h)
      } catch { /* data inválida: ignora */ }
    }
    if (spans.length === 0) return null
    return Math.round(spans.reduce((s, v) => s + v, 0) / spans.length)
  }, [leads, appointments])

  const areaRows = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads ?? []) if (l.area_juridica) counts[l.area_juridica] = (counts[l.area_juridica] ?? 0) + 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, value]) => ({ name: shortArea(name), value }))
  }, [leads])

  const sourceRows = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads ?? []) if (l.origem) counts[l.origem] = (counts[l.origem] ?? 0) + 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
  }, [leads])

  /** Por que perdemos — a métrica que o escritório age em cima. */
  const lossRows = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads ?? []) {
      if (l.status !== 'perdido' || !l.motivo_perda) continue
      counts[l.motivo_perda] = (counts[l.motivo_perda] ?? 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([k, value]) => ({ name: MOTIVO_PERDA_LABELS[k as MotivoPerda] ?? k, value }))
  }, [leads])

  const escRows = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of escalations ?? []) counts[e.category] = (counts[e.category] ?? 0) + 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([k, value]) => ({ name: ESC_LABEL[k] ?? k, value }))
  }, [escalations])

  /* Quando as pessoas escrevem — ajuda a dimensionar o plantão humano. */
  const hourRows = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const l of leads ?? []) {
      if (!l.created_at) continue
      try { const h = getHours(parseISO(l.created_at)); counts[h] = (counts[h] ?? 0) + 1 } catch { /* ignora */ }
    }
    return HOURS.map((h) => ({ label: `${h}h`, contatos: counts[h] ?? 0 }))
  }, [leads])

  const convRate   = total > 0 ? Math.round((booked / total) * 100) : 0
  const clientRate = total > 0 ? Math.round((clients / total) * 100) : 0
  const qualRate   = total > 0 ? Math.round((qualified / total) * 100) : 0

  return (
    <Page>
      <PageHeader
        title="Relatórios"
        subtitle="Conversão do primeiro contato até o cliente — sobre a base inteira"
        actions={<RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />}
      />

      <motion.div variants={stagger(0, 0.06)} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {!stats ? (
          <SkeletonCards count={4} />
        ) : (
          <>
            <StatCard label="Contatos" subtitle="base completa do CRM" value={total} icon={<IconUsers className="w-5 h-5" />} />
            <StatCard label="Triagem completa" subtitle={`${qualRate}% dos contatos`} value={qualified} icon={<IconScale className="w-5 h-5" />} />
            <StatCard label="Conversão" subtitle="contato → consulta agendada" value={`${convRate}%`} icon={<IconTrendUp className="w-5 h-5" />} />
            <StatCard
              label="Tempo até agendar"
              subtitle="média do 1º contato à consulta"
              value={avgHoursToBook === null ? '—' : avgHoursToBook < 48 ? `${avgHoursToBook}h` : `${Math.round(avgHoursToBook / 24)}d`}
              icon={<IconClock className="w-5 h-5" />}
            />
          </>
        )}
      </motion.div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="Funil completo" subtitle={`${clientRate}% dos contatos viraram cliente`}>
          <div className="space-y-3.5">
            {funnel.map((s, i) => (
              <MeterRow
                key={s.label}
                label={s.label}
                value={s.value}
                total={total}
                color={FUNNEL_RAMP[i]}
                delay={0.1 + i * 0.07}
              />
            ))}
          </div>
        </Section>

        <Section title="Onde as pessoas param" subtitle="retenção de uma etapa para a próxima">
          {total === 0 ? (
            <EmptyState title="Sem dados de funil ainda" />
          ) : (
            <div className="space-y-2.5">
              {dropoffs.map((d, i) => {
                const bad = d.keptPct < 50
                return (
                  <motion.div
                    key={d.to}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.07, duration: 0.3 }}
                    className="flex items-center gap-3 p-3 rounded-xl border border-line"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink truncate">{d.from} → {d.to}</p>
                      <p className="text-[11px] text-slate-400">
                        {d.lost === 1 ? '1 pessoa não seguiu' : `${d.lost} pessoas não seguiram`}
                      </p>
                    </div>
                    <span
                      className="badge tabular-nums shrink-0"
                      style={{
                        background: bad ? '#FDECEA' : '#E9F4EE',
                        color: bad ? STATUS.critical : STATUS.good,
                      }}
                    >
                      {d.keptPct}% seguiu
                    </span>
                  </motion.div>
                )
              })}
            </div>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="Áreas procuradas" subtitle="volume por área de atuação">
          {/* Ranking de uma medida só = um hue só. Cor aqui é magnitude, não identidade. */}
          <Ranking
            rows={areaRows}
            total={areaRows[0]?.value ?? 1}
            colorFor={() => SERIES[0]}
            empty="Nenhuma área registrada ainda"
          />
        </Section>

        <Section title="Por que perdemos" subtitle={`${lost} lead${lost !== 1 ? 's' : ''} encerrado${lost !== 1 ? 's' : ''} sem seguir`}>
          <Ranking
            rows={lossRows}
            total={lossRows[0]?.value ?? 1}
            colorFor={() => SERIES[3]}
            empty="Nenhum lead marcado como perdido"
          />
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="Como chegaram até o escritório" subtitle="origem declarada na triagem">
          <Ranking
            rows={sourceRows}
            total={sourceRows[0]?.value ?? 1}
            colorFor={() => SERIES[2]}
            empty="Origem ainda não registrada"
          />
        </Section>

        <Section
          title="O que foi para triagem humana"
          subtitle={`${escalations?.length ?? 0} escalação${(escalations?.length ?? 0) !== 1 ? 'ões' : ''} no total`}
        >
          {escRows.length === 0 ? (
            <EmptyState icon={<IconGavel className="w-10 h-10" />} title="Nenhuma escalação registrada" />
          ) : (
            <Ranking
              rows={escRows}
              total={escRows[0]?.value ?? 1}
              colorFor={(name) => (name === ESC_LABEL.urgencia_prazo ? STATUS.critical : SERIES[4])}
              empty="Nenhuma escalação"
            />
          )}
        </Section>
      </div>

      <Section title="Horário do primeiro contato" subtitle="quando as pessoas escrevem — dimensiona o plantão">
        {total === 0 ? (
          <EmptyState icon={<IconBarChart2 className="w-10 h-10" />} title="Sem contatos registrados" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourRows} margin={{ top: 6, right: 8, left: -20, bottom: 0 }} barCategoryGap={8}>
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} width={34} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#14203308' }} />
              <Bar dataKey="contatos" name="Contatos" radius={[4, 4, 0, 0]} animationBegin={150} animationDuration={700}>
                {hourRows.map((r) => (
                  <Cell key={r.label} fill={SERIES[0]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Section>
    </Page>
  )
}
