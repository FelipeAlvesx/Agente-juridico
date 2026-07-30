import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { parseISO, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  api, Lead, MotivoPerda, MOTIVO_PERDA_LABELS,
  followUpBucket, FollowUpBucket, STALE_DAYS,
} from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { RefreshBar } from '../components/RefreshBar'
import { Page, PageHeader, Reveal, EmptyState, SkeletonRows } from '../components/Page'
import { URGENCIA, shortArea, shortPhone, initials, hueFor } from '../lib/theme'
import { modalBackdrop, modalPanel, quick, revealItem, stagger } from '../lib/motion'
import {
  IconBellRing, IconChat, IconWhatsApp, IconCheck, IconClock, IconAlert, IconArrowRight,
} from '../components/Icon'

/**
 * Fila de retomada. É a tela que existe para cumprir a promessa do produto:
 * ninguém que escreveu some. Ordena por quanto tempo o lead está parado,
 * com a urgência declarada na triagem como desempate.
 */

const BUCKETS: { key: FollowUpBucket; label: string; hint: string; color: string; bg: string }[] = [
  { key: 'quente',       label: 'Esfriando',        hint: '3 a 7 dias sem contato',  color: '#B07C1E', bg: 'bg-brass/8' },
  { key: 'esfriando',    label: 'Frio',             hint: '8 a 20 dias',             color: '#C2600F', bg: 'bg-orange-50' },
  { key: 'frio',         label: 'Parado',           hint: 'mais de 20 dias',         color: '#64748B', bg: 'bg-slate-50' },
  { key: 'sem_resposta', label: 'Deu para trás',    hint: 'marcados como perdidos por silêncio — vale uma última tentativa', color: '#94A3B8', bg: 'bg-slate-50' },
]

const URG_WEIGHT: Record<string, number> = { alta: 3, media: 2, baixa: 1 }

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  try { return Math.floor((Date.now() - parseISO(iso).getTime()) / 86_400_000) } catch { return null }
}

/**
 * Abre o WhatsApp com a conversa do lead. Sem texto pré-montado: qualquer
 * mensagem sugerida daqui seria captação, e captação é vedada (Prov. 205/2021).
 */
function waLink(phone: string) {
  return `https://wa.me/${shortPhone(phone).replace(/\D/g, '')}`
}

function FollowUpRow({
  lead, index, onOpen, onMarkLost, onMarkClient, busy,
}: {
  lead: Lead
  index: number
  onOpen: () => void
  onMarkLost: () => void
  onMarkClient: () => void
  busy: boolean
}) {
  const d = daysSince(lead.last_contact)
  const urg = lead.urgencia ? URGENCIA[lead.urgencia] : null

  return (
    <motion.div
      layout
      {...revealItem(index)}
      exit={{ opacity: 0, x: -20, transition: quick }}
      whileHover={{ x: 2, transition: quick }}
      className="group flex items-start gap-3.5 p-3.5 rounded-xl border border-line bg-surface hover:border-primary/25 hover:shadow-card transition-[border-color,box-shadow] duration-200"
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5"
        style={{ background: hueFor(lead.phone) }}
      >
        {initials(lead.nome, lead.phone)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onOpen} className="text-sm font-semibold text-ink hover:text-primary transition-colors truncate">
            {lead.nome || shortPhone(lead.phone)}
          </button>
          {urg && (
            <span className="badge text-[10px]" style={{ background: urg.bg, color: urg.color }}>
              {urg.label}
            </span>
          )}
          {lead.area_juridica && (
            <span className="badge bg-primary/8 text-primary text-[10px]">{shortArea(lead.area_juridica)}</span>
          )}
          {!lead.qualified && (
            <span className="badge bg-slate-100 text-slate-500 text-[10px]">triagem incompleta</span>
          )}
        </div>

        {lead.resumo_caso ? (
          <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{lead.resumo_caso}</p>
        ) : (
          <p className="text-xs text-slate-300 mt-1 italic">sem resumo do caso — parou antes de contar</p>
        )}

        <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400 flex-wrap">
          <span className="flex items-center gap-1">
            <IconClock className="w-3 h-3" />
            {d !== null ? `${d} dia${d !== 1 ? 's' : ''} sem contato` : 'sem contato registrado'}
          </span>
          {lead.last_contact && (
            <span>último em {format(parseISO(lead.last_contact), "d 'de' MMM", { locale: ptBR })}</span>
          )}
          {lead.origem && <span>veio de {lead.origem}</span>}
          {lead.status === 'perdido' && lead.motivo_perda && (
            <span className="text-slate-400">· {MOTIVO_PERDA_LABELS[lead.motivo_perda]}</span>
          )}
        </div>
      </div>

      {/* Ações aparecem no hover, mas ficam sempre acessíveis por teclado. */}
      <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <a
          href={waLink(lead.phone)}
          target="_blank"
          rel="noreferrer"
          title="Abrir conversa no WhatsApp"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-emerald-700 hover:bg-emerald-50 transition-colors"
        >
          <IconWhatsApp className="w-4 h-4" />
        </a>
        <button
          onClick={onOpen}
          title="Ver histórico no CRM"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-ink/5 hover:text-ink transition-colors"
        >
          <IconChat className="w-4 h-4" />
        </button>
        <button
          onClick={onMarkClient}
          disabled={busy}
          title="Virou cliente"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-40"
        >
          <IconCheck className="w-4 h-4" />
        </button>
        {lead.status !== 'perdido' && (
          <button
            onClick={onMarkLost}
            disabled={busy}
            title="Encerrar como perdido"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40"
          >
            <IconAlert className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  )
}

export function FollowUp() {
  const navigate = useNavigate()
  const { data, refetch, lastUpdated, loading, error } = useFetch(() => api.getLeads({ limit: 500 }))
  const [active, setActive] = useState<FollowUpBucket | 'todos'>('todos')
  const [askMotivo, setAskMotivo] = useState<Lead | null>(null)
  const [busy, setBusy] = useState(false)

  const queue = useMemo(() => {
    const out: Record<FollowUpBucket, Lead[]> = { quente: [], esfriando: [], frio: [], sem_resposta: [] }
    for (const lead of data ?? []) {
      const b = followUpBucket(lead)
      if (b) out[b].push(lead)
    }
    // Mais parado primeiro; urgência declarada desempata.
    for (const list of Object.values(out)) {
      list.sort((a, b) => {
        const ua = URG_WEIGHT[a.urgencia ?? ''] ?? 0
        const ub = URG_WEIGHT[b.urgencia ?? ''] ?? 0
        if (ua !== ub) return ub - ua
        return (daysSince(b.last_contact) ?? 0) - (daysSince(a.last_contact) ?? 0)
      })
    }
    return out
  }, [data])

  const total = Object.values(queue).reduce((s, l) => s + l.length, 0)
  const urgentes = Object.values(queue).flat().filter((l) => l.urgencia === 'alta').length
  const visible = BUCKETS.filter((b) => active === 'todos' || b.key === active)

  async function setStatus(lead: Lead, status: 'cliente' | 'perdido', motivo?: MotivoPerda) {
    setBusy(true)
    try {
      await api.setLeadStatus(lead.phone, status, motivo)
      refetch()
    } finally {
      setBusy(false)
      setAskMotivo(null)
    }
  }

  return (
    <Page>
      <PageHeader
        title="Follow-up"
        subtitle={
          data
            ? `${total} lead${total !== 1 ? 's' : ''} esperando retorno${urgentes > 0 ? ` · ${urgentes} marcado${urgentes !== 1 ? 's' : ''} como urgente na triagem` : ''}`
            : 'Carregando…'
        }
        actions={<RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />}
      />

      <Reveal className="flex items-center gap-2 mb-5 flex-wrap">
        <button
          onClick={() => setActive('todos')}
          className={active === 'todos' ? 'tab-btn-active' : 'tab-btn-inactive'}
        >
          Todos <span className="tabular-nums opacity-70">{total}</span>
        </button>
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            onClick={() => setActive(b.key)}
            className={active === b.key ? 'tab-btn-active' : 'tab-btn-inactive'}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: b.color }} />
              {b.label} <span className="tabular-nums opacity-70">{queue[b.key].length}</span>
            </span>
          </button>
        ))}
      </Reveal>

      {error && (
        <div className="card border-red-200 bg-red-50/50 text-sm text-red-700 mb-4">
          Falha ao carregar a fila: {error}
        </div>
      )}

      {!data ? (
        <SkeletonRows rows={5} height="h-20" />
      ) : total === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconBellRing className="w-11 h-11" />}
            title="Ninguém esperando retorno"
            hint={`Leads sem contato há ${STALE_DAYS} dias ou mais aparecem aqui automaticamente, priorizados pela urgência da triagem.`}
          />
        </div>
      ) : (
        <motion.div variants={stagger(0, 0.05)} initial="initial" animate="animate" className="space-y-5">
          {visible.map((b) => {
            const list = queue[b.key]
            if (list.length === 0) return null
            return (
              <Reveal key={b.key} className="card-flush">
                <div className={`flex items-center gap-2.5 px-5 py-3.5 border-b border-line ${b.bg}`}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{b.label}</p>
                    <p className="text-[11px] text-slate-500">{b.hint}</p>
                  </div>
                  <span className="ml-auto text-sm font-semibold text-ink tabular-nums">{list.length}</span>
                </div>
                <motion.div variants={stagger(0.05, 0.04)} className="p-3 space-y-2">
                  <AnimatePresence mode="popLayout">
                    {list.map((lead, i) => (
                      <FollowUpRow
                        key={lead.phone}
                        lead={lead}
                        index={i}
                        busy={busy}
                        onOpen={() => navigate(`/conversas?phone=${encodeURIComponent(lead.phone)}`)}
                        onMarkClient={() => setStatus(lead, 'cliente')}
                        onMarkLost={() => setAskMotivo(lead)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </Reveal>
            )
          })}
        </motion.div>
      )}

      <AnimatePresence>
        {askMotivo && (
          <motion.div
            variants={modalBackdrop}
            initial="initial" animate="animate" exit="exit"
            onClick={() => !busy && setAskMotivo(null)}
            className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50"
          >
            <motion.div
              variants={modalPanel}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-2xl shadow-panel border border-line p-5 max-w-sm w-full space-y-4"
            >
              <div>
                <h2 className="font-display text-base font-semibold text-ink">Encerrar sem seguir</h2>
                <p className="text-xs text-slate-400 mt-1">
                  {askMotivo.nome || shortPhone(askMotivo.phone)} · o motivo fica no registro, o lead não some
                </p>
              </div>
              <div className="space-y-1.5">
                {(Object.keys(MOTIVO_PERDA_LABELS) as MotivoPerda[]).map((m, i) => (
                  <motion.button
                    key={m}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 * i, duration: 0.2 }}
                    disabled={busy}
                    onClick={() => setStatus(askMotivo, 'perdido', m)}
                    className="group w-full flex items-center text-left text-sm px-3 py-2.5 rounded-xl border border-line
                               hover:bg-surface-2 hover:border-primary/30 transition-colors disabled:opacity-50"
                  >
                    {MOTIVO_PERDA_LABELS[m]}
                    <IconArrowRight className="w-3.5 h-3.5 ml-auto text-slate-300 group-hover:text-primary transition-colors" />
                  </motion.button>
                ))}
              </div>
              <button className="btn-ghost w-full" disabled={busy} onClick={() => setAskMotivo(null)}>
                Cancelar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  )
}
