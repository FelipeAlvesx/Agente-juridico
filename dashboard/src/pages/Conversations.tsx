import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Message } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { RefreshBar } from '../components/RefreshBar'
import { IconSearch, IconAlert } from '../components/Icon'

function initials(nome: string, phone: string) {
  if (nome) {
    const parts = nome.trim().split(' ')
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
  }
  return phone.slice(-4)
}

const AVATAR_COLORS = ['#7C3D6E', '#2D6E7C', '#2D7C3D', '#7C6E2D', '#3D2D7C']
function avatarColor(phone: string) {
  let h = 0
  for (const c of phone) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function relativeTime(iso: string | null) {
  if (!iso) return ''
  try {
    const d = parseISO(iso)
    if (isToday(d)) return format(d, 'HH:mm')
    if (isYesterday(d)) return 'ontem'
    return format(d, 'dd/MM', { locale: ptBR })
  } catch { return '' }
}

function ChatBubble({ msg }: { msg: Message }) {
  const isLara = msg.role === 'assistant'
  return (
    <div className={`flex ${isLara ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[72%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isLara
            ? 'bg-primary text-white rounded-tr-sm'
            : 'bg-gray-100 text-gray-800 rounded-tl-sm'
        }`}
      >
        <p className="whitespace-pre-wrap">{msg.content}</p>
        <p className={`text-[10px] mt-1 ${isLara ? 'text-white/60 text-right' : 'text-gray-400'}`}>
          {msg.timestamp ? format(parseISO(msg.timestamp), 'HH:mm · d MMM', { locale: ptBR }) : ''}
        </p>
      </div>
    </div>
  )
}

function EmptyChat() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-300">
      <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2"
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
      </svg>
      <p className="text-sm">Selecione uma conversa para visualizar</p>
    </div>
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

  const escalatedCount = (conversations ?? []).filter(c => c.escalated).length

  const filtered = (conversations ?? []).filter(c => {
    const q = query.toLowerCase()
    const matchesQuery = !q || c.nome.toLowerCase().includes(q) || c.phone.includes(q)
    const matchesFilter = !filterEscalated || c.escalated
    return matchesQuery && matchesFilter
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

  const selected = conversations?.find(c => c.phone === selectedPhone)

  return (
    <div className="animate-fade-in pb-8 h-[calc(100vh-6rem)]">
      <div className="flex h-full gap-0 card p-0 overflow-hidden">

        {/* Sidebar — conversation list */}
        <div className="w-72 shrink-0 border-r border-gray-100 flex flex-col">
          {/* Search + filter */}
          <div className="p-3 border-b border-gray-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 px-1">Conversas</span>
              <RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <IconSearch className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                placeholder="Buscar..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="input pl-8 py-2 text-sm"
              />
            </div>
            {escalatedCount > 0 && (
              <button
                onClick={() => setFilterEscalated(f => !f)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterEscalated
                    ? 'bg-amber-100 text-amber-700 border border-amber-200'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                <IconAlert className="w-3.5 h-3.5" />
                {escalatedCount} escalada{escalatedCount !== 1 ? 's' : ''}
                {filterEscalated && <span className="ml-auto">✕</span>}
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-300">
                  {query || filterEscalated ? 'Nenhum resultado' : 'Sem conversas ainda'}
                </p>
              </div>
            )}
            {filtered.map(conv => (
              <button
                key={conv.phone}
                onClick={() => selectConversation(conv.phone)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-surface-2 transition-colors flex items-start gap-3 ${
                  selectedPhone === conv.phone ? 'bg-purple-50 border-l-2 border-l-primary' : ''
                }`}
              >
                <div className="relative shrink-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold mt-0.5"
                    style={{ background: avatarColor(conv.phone) }}
                  >
                    {initials(conv.nome, conv.phone)}
                  </div>
                  {conv.escalated && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 rounded-full border-2 border-white flex items-center justify-center">
                      <span className="text-white text-[7px] font-bold leading-none">!</span>
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold text-gray-900 truncate">
                      {conv.nome || conv.phone}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0 ml-1">
                      {relativeTime(conv.last_ts)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {conv.escalated && (
                      <span className="text-[10px] bg-amber-100 text-amber-600 px-1 rounded font-medium shrink-0">
                        escalada
                      </span>
                    )}
                    <p className={`text-xs truncate ${
                      conv.last_role === 'assistant' ? 'text-primary/80' : 'text-gray-500'
                    }`}>
                      {conv.last_role === 'assistant' && <span className="font-medium">Lara: </span>}
                      {conv.last_message}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {conversations && (
            <div className="p-3 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 text-center">
                {conversations.length} conversa{conversations.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>

        {/* Chat panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          {selected ? (
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                style={{ background: avatarColor(selected.phone) }}
              >
                {initials(selected.nome, selected.phone)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  {selected.nome || selected.phone}
                  {selected.escalated && (
                    <span className="text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">
                      escalada para humano
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400">{selected.phone}</p>
              </div>
            </div>
          ) : (
            <div className="px-5 py-3.5 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">Conversas</p>
              <p className="text-xs text-gray-400">Histórico de mensagens com a Lara</p>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!selectedPhone && <EmptyChat />}

            {loadingChat && (
              <div className="space-y-3 py-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : ''}`}>
                    <div
                      className="skeleton h-10 rounded-2xl"
                      style={{ width: `${40 + (i * 13) % 30}%`, animationDelay: `${i * 0.1}s` }}
                    />
                  </div>
                ))}
              </div>
            )}

            {!loadingChat && messages?.length === 0 && selectedPhone && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 py-20 text-gray-300">
                <p className="text-sm">Nenhuma mensagem encontrada para este contato.</p>
              </div>
            )}

            {!loadingChat && messages && messages.length > 0 && (
              <>
                {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
                <div ref={chatEndRef} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
