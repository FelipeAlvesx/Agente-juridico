import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Message, Lead } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { RefreshBar } from '../components/RefreshBar'
import { EmptyState } from '../components/Page'
import { initials, hueFor, shortPhone, shortArea, URGENCIA } from '../lib/theme'
import { pageVariants, quick, springy } from '../lib/motion'
import { IconSearch, IconAlert, IconChat, IconWhatsApp } from '../components/Icon'

function relativeTime(iso: string | null) {
  if (!iso) return ''
  try {
    const d = parseISO(iso)
    if (isToday(d)) return format(d, 'HH:mm')
    if (isYesterday(d)) return 'ontem'
    return format(d, 'dd/MM', { locale: ptBR })
  } catch { return '' }
}

/** Cabeçalho de dia entre os balões — a conversa pode durar semanas. */
function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-line" />
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      <div className="flex-1 h-px bg-line" />
    </div>
  )
}

function ChatBubble({ msg, index, agentName }: { msg: Message; index: number; agentName: string }) {
  const isAgent = msg.role === 'assistant'
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...springy, delay: Math.min(index * 0.025, 0.4) }}
      className={`flex ${isAgent ? 'justify-end' : 'justify-start'} mb-1.5`}
    >
      <div
        className={`max-w-[68%] px-4 py-2.5 text-[13px] leading-relaxed shadow-card ${
          isAgent
            ? 'bg-primary text-white rounded-2xl rounded-br-md'
            : 'bg-surface-2 text-ink border border-line rounded-2xl rounded-bl-md'
        }`}
      >
        {isAgent && (
          <p className="text-[10px] font-semibold text-white/60 mb-1 uppercase tracking-wide">{agentName}</p>
        )}
        <p className="whitespace-pre-wrap">{msg.content}</p>
        <p className={`text-[10px] mt-1.5 ${isAgent ? 'text-white/50 text-right' : 'text-slate-400'}`}>
          {msg.timestamp ? format(parseISO(msg.timestamp), 'HH:mm', { locale: ptBR }) : ''}
        </p>
      </div>
    </motion.div>
  )
}

/** Ficha do lead ao lado do chat — o advogado precisa do caso, não só do texto. */
function CaseCard({ lead }: { lead: Lead }) {
  const urg = lead.urgencia ? URGENCIA[lead.urgencia] : null
  const rows = [
    ['Área', shortArea(lead.area_juridica)],
    ['Origem', lead.origem ?? ''],
  ].filter(([, v]) => v)

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={quick}
      className="mx-5 mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3"
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Triagem</span>
        {urg && (
          <span className="badge text-[10px]" style={{ background: urg.bg, color: urg.color }}>
            {urg.label}
          </span>
        )}
        {!lead.qualified && (
          <span className="badge bg-slate-100 text-slate-500 text-[10px]">incompleta</span>
        )}
      </div>
      {lead.resumo_caso ? (
        <p className="text-[13px] text-slate-700 leading-relaxed">{lead.resumo_caso}</p>
      ) : (
        <p className="text-[13px] text-slate-300 italic">resumo do caso ainda não registrado</p>
      )}
      {rows.length > 0 && (
        <div className="flex gap-5 mt-2.5 pt-2.5 border-t border-line">
          {rows.map(([k, v]) => (
            <div key={k}>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">{k}</p>
              <p className="text-xs text-ink">{v}</p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

export function Conversations() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedPhone, setSelectedPhone] = useState<string>(searchParams.get('phone') ?? '')
  const [query, setQuery] = useState('')
  const [filterEscalated, setFilterEscalated] = useState(false)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [loadingChat, setLoadingChat] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const { data: conversations, refetch, lastUpdated, loading } = useFetch(() => api.getConversations())
  const { data: leads } = useFetch(() => api.getLeads({ limit: 500 }))
  const { data: config } = useFetch(() => api.getConfig(), 300_000)

  const agentName = config?.agent_name ?? 'Agente'
  const escalatedCount = (conversations ?? []).filter((c) => c.escalated).length

  const filtered = (conversations ?? []).filter((c) => {
    const q = query.toLowerCase()
    const matchesQuery = !q || c.nome.toLowerCase().includes(q) || c.phone.includes(q)
    return matchesQuery && (!filterEscalated || c.escalated)
  })

  useEffect(() => {
    if (!selectedPhone) return
    setLoadingChat(true)
    api.getConversation(selectedPhone)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoadingChat(false))
  }, [selectedPhone])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function selectConversation(phone: string) {
    setSelectedPhone(phone)
    setSearchParams({ phone })
  }

  const selected = conversations?.find((c) => c.phone === selectedPhone)
  const selectedLead = leads?.find((l) => l.phone === selectedPhone)

  /* Agrupa por dia para intercalar os divisores. */
  const grouped = useMemo(() => {
    const out: { day: string; items: { msg: Message; i: number }[] }[] = []
    ;(messages ?? []).forEach((msg, i) => {
      let day = 'Sem data'
      try {
        const d = parseISO(msg.timestamp)
        day = isToday(d) ? 'Hoje' : isYesterday(d) ? 'Ontem' : format(d, "d 'de' MMMM", { locale: ptBR })
      } catch { /* mantém o fallback */ }
      const last = out[out.length - 1]
      if (last?.day === day) last.items.push({ msg, i })
      else out.push({ day, items: [{ msg, i }] })
    })
    return out
  }, [messages])

  return (
    <motion.div
      variants={pageVariants}
      initial="initial" animate="animate" exit="exit"
      className="h-[calc(100vh-3.5rem)] flex flex-col"
    >
      <div className="flex flex-1 min-h-0 card-flush">

        {/* Lista de conversas */}
        <div className="w-[19rem] shrink-0 border-r border-line flex flex-col bg-surface-2">
          <div className="p-3 border-b border-line space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="font-display text-[13px] font-semibold text-ink">Conversas</span>
              <RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none">
                <IconSearch className="w-3.5 h-3.5" />
              </span>
              <input
                type="search"
                placeholder="Buscar contato…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input pl-8 !py-2 text-[13px]"
              />
            </div>
            {escalatedCount > 0 && (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setFilterEscalated((f) => !f)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterEscalated
                    ? 'bg-brass/15 text-brass ring-1 ring-brass/25'
                    : 'bg-surface text-slate-500 border border-line hover:border-brass/30'
                }`}
              >
                <IconAlert className="w-3.5 h-3.5" />
                {escalatedCount} na triagem
                {filterEscalated && <span className="ml-auto">✕</span>}
              </motion.button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="py-12 text-center text-sm text-slate-300">
                {query || filterEscalated ? 'Nenhum resultado' : 'Sem conversas ainda'}
              </p>
            )}
            <AnimatePresence initial={false}>
              {filtered.map((conv, i) => {
                const active = selectedPhone === conv.phone
                return (
                  <motion.button
                    key={conv.phone}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.25), duration: 0.24 }}
                    onClick={() => selectConversation(conv.phone)}
                    className={`relative w-full text-left px-4 py-3 border-b border-line/60 transition-colors flex items-start gap-3 ${
                      active ? 'bg-surface' : 'hover:bg-surface'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="conv-active"
                        transition={springy}
                        className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary"
                      />
                    )}
                    <div className="relative shrink-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                        style={{ background: hueFor(conv.phone) }}
                      >
                        {initials(conv.nome, conv.phone)}
                      </div>
                      {conv.escalated && (
                        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-brass rounded-full border-2 border-surface-2 flex items-center justify-center">
                          <span className="text-white text-[7px] font-bold leading-none">!</span>
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-[13px] font-semibold text-ink truncate">
                          {conv.nome || shortPhone(conv.phone)}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                          {relativeTime(conv.last_ts)}
                        </span>
                      </div>
                      <p className={`text-xs truncate ${conv.last_role === 'assistant' ? 'text-slate-400' : 'text-slate-600'}`}>
                        {conv.last_role === 'assistant' && (
                          <span className="font-medium text-primary/70">{agentName}: </span>
                        )}
                        {conv.last_message}
                      </p>
                    </div>
                  </motion.button>
                )
              })}
            </AnimatePresence>
          </div>

          {conversations && (
            <div className="p-2.5 border-t border-line">
              <p className="text-[10px] text-slate-400 text-center">
                {conversations.length} conversa{conversations.length !== 1 ? 's' : ''} · atualiza a cada 30s
              </p>
            </div>
          )}
        </div>

        {/* Painel do chat */}
        <div className="flex-1 flex flex-col min-w-0 bg-surface">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.phone}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={quick}
                className="px-5 py-3.5 border-b border-line flex items-center gap-3"
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                  style={{ background: hueFor(selected.phone) }}
                >
                  {initials(selected.nome, selected.phone)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink flex items-center gap-2">
                    <span className="truncate">{selected.nome || shortPhone(selected.phone)}</span>
                    {selected.escalated && (
                      <span className="badge bg-brass/12 text-brass text-[10px] shrink-0">
                        aguardando advogado
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 tabular-nums">{shortPhone(selected.phone)}</p>
                </div>
                <a
                  href={`https://wa.me/${shortPhone(selected.phone).replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary !py-1.5 text-xs shrink-0"
                >
                  <IconWhatsApp className="w-3.5 h-3.5" /> Assumir
                </a>
              </motion.div>
            ) : (
              <div key="none" className="px-5 py-3.5 border-b border-line">
                <p className="font-display text-sm font-semibold text-ink">Histórico</p>
                {/* Sem artigo antes do nome: agent_name é configurável e não sabemos o gênero. */}
                <p className="text-xs text-slate-400">Todo o atendimento feito no WhatsApp</p>
              </div>
            )}
          </AnimatePresence>

          {selectedLead && <CaseCard lead={selectedLead} />}

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!selectedPhone && (
              <EmptyState
                icon={<IconChat className="w-12 h-12" />}
                title="Selecione uma conversa"
                hint="O histórico completo fica guardado mesmo depois que a sessão do agente expira."
                className="h-full"
              />
            )}

            {loadingChat && (
              <div className="space-y-3 py-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : ''}`}>
                    <div
                      className="skeleton h-11 rounded-2xl"
                      style={{ width: `${38 + (i * 13) % 30}%`, animationDelay: `${i * 0.09}s` }}
                    />
                  </div>
                ))}
              </div>
            )}

            {!loadingChat && messages?.length === 0 && selectedPhone && (
              <EmptyState title="Nenhuma mensagem" hint="Este contato existe no CRM, mas não tem histórico gravado." />
            )}

            {!loadingChat && grouped.length > 0 && (
              <>
                {grouped.map((g) => (
                  <div key={g.day}>
                    <DayDivider label={g.day} />
                    {g.items.map(({ msg, i }) => (
                      <ChatBubble key={i} msg={msg} index={i} agentName={agentName} />
                    ))}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
