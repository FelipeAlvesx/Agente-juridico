import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { format, parseISO, formatDistanceToNow, isToday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Escalation, EscalationCategory, Lead } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { RefreshBar } from '../components/RefreshBar'
import { Page, PageHeader, Reveal, EmptyState, SkeletonRows } from '../components/Page'
import { shortArea, shortPhone, initials, hueFor, URGENCIA } from '../lib/theme'
import { quick, revealItem, springy, stagger } from '../lib/motion'
import {
  IconGavel, IconChat, IconWhatsApp, IconCalendar, IconClock, IconScale,
} from '../components/Icon'

/**
 * Casos que o agente não podia resolver sozinho e passou para um humano.
 *
 * Ordenado por gravidade, não por data: menção a prazo vem antes de tudo, porque
 * prazo perdido não volta. O agente nunca opina sobre o mérito — esta tela existe
 * para um advogado assumir a conversa.
 */

/** Espelha ESCALATION_CATEGORIES em verticals/advocacia/tools.py. */
const CATEGORIES: Record<
  EscalationCategory,
  { label: string; hint: string; color: string; bg: string; border: string; rank: number }
> = {
  urgencia_prazo: {
    label: 'Menção a prazo',
    hint: 'a pessoa citou prazo, audiência ou intimação',
    color: '#B3261E', bg: 'bg-red-50', border: 'border-red-200', rank: 0,
  },
  processo_em_andamento: {
    label: 'Processo em andamento',
    hint: 'já tem ação em curso — precisa do advogado do caso',
    color: '#C2600F', bg: 'bg-orange-50', border: 'border-orange-200', rank: 1,
  },
  consulta_juridica: {
    label: 'Pediu orientação jurídica',
    hint: 'pergunta de mérito — ato privativo do advogado',
    color: '#B07C1E', bg: 'bg-brass/8', border: 'border-brass/25', rank: 2,
  },
  reclamacao: {
    label: 'Reclamação',
    hint: 'insatisfação com o atendimento ou com o escritório',
    color: '#6B58B8', bg: 'bg-violet-50', border: 'border-violet-200', rank: 3,
  },
  pedido_humano: {
    label: 'Pediu para falar com alguém',
    hint: 'quis atendimento humano explicitamente',
    color: '#2E5FA3', bg: 'bg-primary/8', border: 'border-primary/20', rank: 4,
  },
  confusao_repetida: {
    label: 'Conversa travada',
    hint: 'o agente não conseguiu entender depois de tentativas',
    color: '#64748B', bg: 'bg-slate-50', border: 'border-slate-200', rank: 5,
  },
}

const FALLBACK = {
  label: 'Outro', hint: 'categoria desconhecida', color: '#64748B',
  bg: 'bg-slate-50', border: 'border-slate-200', rank: 9,
}

const catOf = (c: EscalationCategory) => CATEGORIES[c] ?? FALLBACK

function waLink(phone: string) {
  return `https://wa.me/${shortPhone(phone).replace(/\D/g, '')}`
}

function EscalationCard({ esc, lead, index, onOpen }: {
  esc: Escalation
  lead?: Lead
  index: number
  onOpen: () => void
}) {
  const cat = catOf(esc.category)
  const urgent = esc.category === 'urgencia_prazo'
  const urg = lead?.urgencia ? URGENCIA[lead.urgencia] : null
  const when = esc.created_at ? parseISO(esc.created_at) : null

  return (
    <motion.div
      layout
      {...revealItem(index)}
      exit={{ opacity: 0, y: -8, transition: quick }}
      whileHover={{ y: -2, transition: quick }}
      className={`relative bg-surface rounded-xl border ${cat.border} shadow-card p-4 overflow-hidden`}
    >
      {/* Filete lateral com a cor da categoria — identidade não fica só no texto. */}
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: cat.color }} />
      {urgent && (
        <motion.span
          initial={{ opacity: 0.35 }}
          animate={{ opacity: [0.35, 0.75, 0.35] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-red-500"
        />
      )}

      <div className="flex items-start gap-3 pl-1.5">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
          style={{ background: hueFor(esc.phone) }}
        >
          {initials(esc.nome ?? lead?.nome, esc.phone)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onOpen} className="text-sm font-semibold text-ink hover:text-primary transition-colors truncate">
              {esc.nome || lead?.nome || shortPhone(esc.phone)}
            </button>
            <span className="badge text-[10px]" style={{ background: `${cat.color}14`, color: cat.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: cat.color }} />
              {cat.label}
            </span>
            {lead?.area_juridica && (
              <span className="badge bg-primary/8 text-primary text-[10px]">{shortArea(lead.area_juridica)}</span>
            )}
            {urg && (
              <span className="badge text-[10px]" style={{ background: urg.bg, color: urg.color }}>
                {urg.label}
              </span>
            )}
          </div>

          <p className="text-[13px] text-slate-700 mt-2 leading-relaxed">
            {esc.reason || <span className="text-slate-300 italic">sem motivo registrado</span>}
          </p>

          {lead?.resumo_caso && (
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed border-l-2 border-line pl-2.5">
              {lead.resumo_caso}
            </p>
          )}

          <div className="flex items-center gap-3 mt-2.5 text-[11px] text-slate-400 flex-wrap">
            <span className="flex items-center gap-1">
              <IconClock className="w-3 h-3" />
              {when
                ? isToday(when)
                  ? `hoje às ${format(when, 'HH:mm')}`
                  : formatDistanceToNow(when, { locale: ptBR, addSuffix: true })
                : 'sem data'}
            </span>
            <span className="tabular-nums">{shortPhone(esc.phone)}</span>
            {lead?.origem && <span>veio de {lead.origem}</span>}
          </div>
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <a
            href={waLink(esc.phone)}
            target="_blank"
            rel="noreferrer"
            title="Assumir a conversa no WhatsApp"
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
        </div>
      </div>
    </motion.div>
  )
}

export function Triagem() {
  const navigate = useNavigate()
  const { data: escalations, refetch, lastUpdated, loading, error } = useFetch(() => api.getEscalations(100))
  const { data: leads } = useFetch(() => api.getLeads({ limit: 500 }))
  const [filter, setFilter] = useState<EscalationCategory | 'todos'>('todos')

  const leadByPhone = useMemo(
    () => Object.fromEntries((leads ?? []).map((l) => [l.phone, l])) as Record<string, Lead>,
    [leads],
  )

  const counts = useMemo(() => {
    const c: Partial<Record<EscalationCategory, number>> = {}
    for (const e of escalations ?? []) c[e.category] = (c[e.category] ?? 0) + 1
    return c
  }, [escalations])

  /* Gravidade primeiro, recência dentro da gravidade. */
  const sorted = useMemo(
    () =>
      [...(escalations ?? [])]
        .filter((e) => filter === 'todos' || e.category === filter)
        .sort((a, b) => {
          const r = catOf(a.category).rank - catOf(b.category).rank
          return r !== 0 ? r : (b.created_at ?? '').localeCompare(a.created_at ?? '')
        }),
    [escalations, filter],
  )

  const urgentCount = counts.urgencia_prazo ?? 0
  const hoje = (escalations ?? []).filter((e) => {
    try { return e.created_at && isToday(parseISO(e.created_at)) } catch { return false }
  }).length

  /* Só mostra chips de categorias que existem — filtro vazio é ruído. */
  const chips = (Object.keys(CATEGORIES) as EscalationCategory[]).filter((k) => (counts[k] ?? 0) > 0)

  return (
    <Page>
      <PageHeader
        title="Triagem"
        subtitle={
          escalations
            ? `${escalations.length} caso${escalations.length !== 1 ? 's' : ''} aguardando um advogado${hoje > 0 ? ` · ${hoje} chegou${hoje !== 1 ? 'ram' : ''} hoje` : ''}`
            : 'Carregando…'
        }
        actions={<RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />}
      />

      {/* Aviso de prazo: o único alarme que a tela dá. */}
      <AnimatePresence>
        {urgentCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springy}
            className="mb-5"
          >
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <span className="w-9 h-9 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                <IconScale className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-red-900">
                  {urgentCount === 1
                    ? '1 pessoa mencionou prazo, audiência ou intimação'
                    : `${urgentCount} pessoas mencionaram prazo, audiência ou intimação`}
                </p>
                <p className="text-xs text-red-700/80">
                  O agente não avalia prazo — quem confere é o advogado. Estão no topo da lista.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {chips.length > 0 && (
        <Reveal className="flex items-center gap-2 mb-5 flex-wrap">
          <button
            onClick={() => setFilter('todos')}
            className={filter === 'todos' ? 'tab-btn-active' : 'tab-btn-inactive'}
          >
            Todos <span className="tabular-nums opacity-70">{escalations?.length ?? 0}</span>
          </button>
          {chips.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={filter === k ? 'tab-btn-active' : 'tab-btn-inactive'}
              title={CATEGORIES[k].hint}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORIES[k].color }} />
                {CATEGORIES[k].label} <span className="tabular-nums opacity-70">{counts[k]}</span>
              </span>
            </button>
          ))}
        </Reveal>
      )}

      {error && (
        <div className="card border-red-200 bg-red-50/50 text-sm text-red-700 mb-4">
          Falha ao carregar as escalações: {error}
        </div>
      )}

      {!escalations ? (
        <SkeletonRows rows={4} height="h-28" />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconGavel className="w-11 h-11" />}
            title={filter === 'todos' ? 'Nenhum caso na triagem' : 'Nada nesta categoria'}
            hint="Quando alguém pede orientação jurídica, cita prazo ou pede para falar com uma pessoa, o atendimento para aqui e espera um advogado."
          />
        </div>
      ) : (
        <motion.div variants={stagger(0, 0.05)} initial="initial" animate="animate" className="space-y-2.5">
          <AnimatePresence mode="popLayout">
            {sorted.map((esc, i) => (
              <EscalationCard
                key={esc.id}
                esc={esc}
                index={i}
                lead={leadByPhone[esc.phone]}
                onOpen={() => navigate(`/conversas?phone=${encodeURIComponent(esc.phone)}`)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Legenda: o que cada categoria significa na prática do escritório. */}
      {sorted.length > 0 && (
        <Reveal className="card mt-5">
          <h2 className="panel-title mb-3">O que o agente escala</h2>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
            {(Object.keys(CATEGORIES) as EscalationCategory[]).map((k) => (
              <div key={k} className="flex items-start gap-2.5">
                <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: CATEGORIES[k].color }} />
                <p className="text-xs text-slate-500">
                  <span className="font-medium text-ink">{CATEGORIES[k].label}</span> — {CATEGORIES[k].hint}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-line flex items-start gap-2">
            <IconCalendar className="w-3.5 h-3.5 shrink-0 mt-px" />
            O agente acolhe, tria e agenda. Opinião jurídica, chance de êxito, valor e prazo
            são do advogado — ele nunca responde nada disso no WhatsApp.
          </p>
        </Reveal>
      )}
    </Page>
  )
}
