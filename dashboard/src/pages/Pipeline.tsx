import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Lead, LeadStatus, MotivoPerda, MOTIVO_PERDA_LABELS } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { RefreshBar } from '../components/RefreshBar'
import { Page, PageHeader, EmptyState, SkeletonRows } from '../components/Page'
import { FUNNEL_RAMP, URGENCIA, shortArea, shortPhone } from '../lib/theme'
import { modalBackdrop, modalPanel, quick, springy } from '../lib/motion'
import { IconAlert, IconClock, IconArrowRight } from '../components/Icon'

const COLUMNS: { status: LeadStatus; label: string; hint: string; accent: string }[] = [
  { status: 'novo',              label: 'Novo',              hint: 'Chegou, triagem incompleta', accent: FUNNEL_RAMP[0] },
  { status: 'qualificado',       label: 'Qualificado',       hint: 'Área e caso registrados',    accent: FUNNEL_RAMP[1] },
  { status: 'consulta_agendada', label: 'Consulta agendada', hint: 'Tem consulta ativa',         accent: FUNNEL_RAMP[2] },
  { status: 'cliente',           label: 'Cliente',           hint: 'Fechou com o escritório',    accent: FUNNEL_RAMP[3] },
  { status: 'perdido',           label: 'Perdido',           hint: 'Não seguiu — com motivo',    accent: '#94A3B8' },
]

const MOTIVOS = Object.keys(MOTIVO_PERDA_LABELS) as MotivoPerda[]

/** Dias desde o último contato — o número que dispara follow-up. */
function staleDays(lead: Lead): number | null {
  if (!lead.last_contact) return null
  return Math.floor((Date.now() - parseISO(lead.last_contact).getTime()) / 86_400_000)
}

function LeadCard({ lead, onDragStart, onDragEnd, onOpen }: {
  lead: Lead
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
}) {
  const days = staleDays(lead)
  const open = lead.status !== 'cliente' && lead.status !== 'perdido'
  const stale = open && days !== null && days >= 3
  const urg = lead.urgencia ? URGENCIA[lead.urgencia] : null

  return (
    <motion.div
      layout
      layoutId={`lead-${lead.phone}`}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: quick }}
      transition={springy}
      whileHover={{ y: -2, transition: quick }}
      whileTap={{ scale: 0.98 }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="bg-surface border border-line rounded-xl p-3 shadow-card cursor-grab active:cursor-grabbing hover:border-primary/25 hover:shadow-lift transition-[border-color,box-shadow] duration-200"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink truncate">{lead.nome || '(sem nome)'}</p>
        {stale && (
          <span title={`Sem contato há ${days} dias`} className="text-brass shrink-0 mt-0.5">
            <IconAlert className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">{shortPhone(lead.phone)}</p>

      {lead.area_juridica && (
        <p className="text-xs text-slate-600 mt-2 truncate">{shortArea(lead.area_juridica)}</p>
      )}
      {lead.resumo_caso && (
        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2 leading-snug">{lead.resumo_caso}</p>
      )}

      {urg && (
        <span
          className="badge mt-2 text-[10px]"
          style={{ background: urg.bg, color: urg.color }}
        >
          {urg.label}
        </span>
      )}

      {lead.status === 'perdido' && lead.motivo_perda && (
        <p className="text-[11px] text-slate-500 mt-2 bg-surface-2 border border-line rounded-lg px-2 py-1.5">
          {MOTIVO_PERDA_LABELS[lead.motivo_perda]}
          {lead.motivo_perda_detalhe && (
            <span className="block text-slate-400 mt-0.5">{lead.motivo_perda_detalhe}</span>
          )}
        </p>
      )}

      <div className="flex items-center gap-1 mt-2.5 text-[11px] text-slate-400">
        <IconClock className="w-3 h-3" />
        {lead.last_contact
          ? formatDistanceToNow(parseISO(lead.last_contact), { locale: ptBR, addSuffix: true })
          : 'sem contato registrado'}
      </div>
    </motion.div>
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
    const map = Object.fromEntries(COLUMNS.map((c) => [c.status, [] as Lead[]])) as Record<LeadStatus, Lead[]>
    for (const lead of data ?? []) map[lead.status]?.push(lead)
    for (const list of Object.values(map)) {
      list.sort((a, b) => (b.last_contact ?? '').localeCompare(a.last_contact ?? ''))
    }
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
    <Page>
      <PageHeader
        title="Funil"
        subtitle={
          data
            ? `${data.length} lead${data.length !== 1 ? 's' : ''} · arraste o card para mudar o estágio`
            : 'Carregando…'
        }
        actions={<RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />}
      />

      {error && (
        <div className="card border-red-200 bg-red-50/50 text-sm text-red-700 mb-4">
          Falha ao carregar leads: {error}
        </div>
      )}

      {!data ? (
        <SkeletonRows rows={5} height="h-32" />
      ) : (
        <LayoutGroup>
          <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(190px, 1fr))` }}>
            {COLUMNS.map((col, ci) => (
              <motion.div
                key={col.status}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, delay: ci * 0.06, ease: [0.22, 0.61, 0.36, 1] }}
                onDragOver={(e) => { e.preventDefault(); setOver(col.status) }}
                onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
                onDrop={() => onDrop(col.status)}
                className={`rounded-2xl border p-3 min-h-[260px] transition-colors duration-200 ${
                  over === col.status
                    ? 'border-primary-light bg-primary/5 ring-2 ring-primary-light/20'
                    : 'border-line bg-surface-2'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col.accent }} />
                  <p className="text-[13px] font-semibold text-ink">{col.label}</p>
                  <motion.span
                    key={byStatus[col.status].length}
                    initial={{ scale: 1.35, opacity: 0.5 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={springy}
                    className="ml-auto text-xs font-semibold text-slate-400 tabular-nums"
                  >
                    {byStatus[col.status].length}
                  </motion.span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">{col.hint}</p>

                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {byStatus[col.status].map((lead) => (
                      <LeadCard
                        key={lead.phone}
                        lead={lead}
                        onDragStart={() => setDragging(lead)}
                        onDragEnd={() => { setDragging(null); setOver(null) }}
                        onOpen={() => navigate(`/conversas?phone=${encodeURIComponent(lead.phone)}`)}
                      />
                    ))}
                  </AnimatePresence>
                  {byStatus[col.status].length === 0 && (
                    <p className="text-[11px] text-slate-300 text-center py-8">
                      {over === col.status ? 'solte aqui' : 'vazio'}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </LayoutGroup>
      )}

      {/* Perdido exige motivo — é ele que alimenta o follow-up depois. */}
      <AnimatePresence>
        {askMotivo && (
          <motion.div
            variants={modalBackdrop}
            initial="initial" animate="animate" exit="exit"
            className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50"
            onClick={() => !saving && setAskMotivo(null)}
          >
            <motion.div
              variants={modalPanel}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-2xl shadow-panel border border-line p-5 max-w-sm w-full space-y-4"
            >
              <div>
                <h2 className="font-display text-base font-semibold text-ink">Por que perdemos este lead?</h2>
                <p className="text-xs text-slate-400 mt-1">
                  {askMotivo.nome || shortPhone(askMotivo.phone)} · o motivo fica no registro para o follow-up
                </p>
              </div>
              <div className="space-y-1.5">
                {MOTIVOS.map((m, i) => (
                  <motion.button
                    key={m}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 * i, duration: 0.2 }}
                    disabled={saving}
                    onClick={() => move(askMotivo, 'perdido', m)}
                    className="group w-full flex items-center text-left text-sm px-3 py-2.5 rounded-xl border border-line
                               hover:bg-surface-2 hover:border-primary/30 transition-colors disabled:opacity-50"
                  >
                    {MOTIVO_PERDA_LABELS[m]}
                    <IconArrowRight className="w-3.5 h-3.5 ml-auto text-slate-300 group-hover:text-primary transition-colors" />
                  </motion.button>
                ))}
              </div>
              <button className="btn-ghost w-full" disabled={saving} onClick={() => setAskMotivo(null)}>
                Cancelar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {(data?.length ?? 0) === 0 && (
        <EmptyState
          title="Funil vazio"
          hint="Todo contato do WhatsApp entra aqui automaticamente — inclusive quem parar no meio da triagem."
        />
      )}
    </Page>
  )
}
