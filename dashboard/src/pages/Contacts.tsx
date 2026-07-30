import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Lead, LeadStatus } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { StatusBadge } from '../components/StatusBadge'
import { RefreshBar } from '../components/RefreshBar'
import { Page, PageHeader, Reveal, EmptyState, SkeletonRows } from '../components/Page'
import { initials, hueFor, shortArea, shortPhone, URGENCIA } from '../lib/theme'
import { quick, springy } from '../lib/motion'
import { IconSearch, IconUsers, IconWhatsApp, IconChevronDown } from '../components/Icon'

const STATUS_FILTERS: { key: LeadStatus | 'todos'; label: string }[] = [
  { key: 'todos',             label: 'Todos' },
  { key: 'novo',              label: 'Novos' },
  { key: 'qualificado',       label: 'Qualificados' },
  { key: 'consulta_agendada', label: 'Com consulta' },
  { key: 'cliente',           label: 'Clientes' },
  { key: 'perdido',           label: 'Perdidos' },
]

type SortKey = 'recente' | 'antigo' | 'nome'

function LeadRow({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  const urg = lead.urgencia ? URGENCIA[lead.urgencia] : null

  return (
    <>
      <motion.tr
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={quick}
        onClick={() => setOpen((o) => !o)}
        className="border-b border-line/70 hover:bg-surface-2 transition-colors cursor-pointer group"
      >
        <td className="px-5 py-3">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ scale: 1.08 }}
              transition={quick}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
              style={{ background: hueFor(lead.phone) }}
            >
              {initials(lead.nome, lead.phone)}
            </motion.div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink truncate">{lead.nome || '(sem nome)'}</p>
              <p className="text-[11px] text-slate-400 tabular-nums">{shortPhone(lead.phone)}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          {lead.area_juridica
            ? <span className="text-[13px] text-slate-700">{shortArea(lead.area_juridica)}</span>
            : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-4 py-3">
          {urg
            ? <span className="badge text-[10px]" style={{ background: urg.bg, color: urg.color }}>{urg.label}</span>
            : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-4 py-3">
          {lead.origem
            ? <span className="text-[13px] text-slate-500">{lead.origem}</span>
            : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-4 py-3 text-[13px] text-slate-500 whitespace-nowrap">
          {lead.last_contact
            ? formatDistanceToNow(parseISO(lead.last_contact), { locale: ptBR, addSuffix: true })
            : '—'}
        </td>
        <td className="px-4 py-3"><StatusBadge status={lead.status} dot /></td>
        <td className="px-3 py-3 text-slate-300 group-hover:text-slate-500 transition-colors">
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={quick} className="inline-block">
            <IconChevronDown className="w-4 h-4" />
          </motion.span>
        </td>
      </motion.tr>

      {/* Detalhe expandido: o resumo do caso não cabe numa célula. */}
      <AnimatePresence initial={false}>
        {open && (
          <tr>
            <td colSpan={7} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={springy}
                className="overflow-hidden bg-surface-2 border-b border-line"
              >
                <div className="px-5 py-4 flex items-start gap-6 flex-wrap">
                  <div className="min-w-[240px] flex-1">
                    <p className="label">Resumo do caso</p>
                    <p className="text-[13px] text-slate-700 leading-relaxed">
                      {lead.resumo_caso || <span className="text-slate-300 italic">não informado — a triagem parou antes</span>}
                    </p>
                    {lead.status === 'perdido' && lead.motivo_perda_detalhe && (
                      <p className="text-xs text-slate-500 mt-2">
                        <span className="font-medium">Encerramento:</span> {lead.motivo_perda_detalhe}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <p className="label">Primeiro contato</p>
                    <p className="text-[13px] text-slate-700">
                      {lead.created_at ? format(parseISO(lead.created_at), "d 'de' MMM 'de' yyyy", { locale: ptBR }) : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-center">
                    <a
                      href={`https://wa.me/${shortPhone(lead.phone).replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="btn-secondary !py-1.5 text-xs"
                    >
                      <IconWhatsApp className="w-3.5 h-3.5" /> WhatsApp
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpen() }}
                      className="btn-primary !py-1.5 text-xs"
                    >
                      Ver conversa
                    </button>
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  )
}

export function Contacts() {
  const { data, refetch, lastUpdated, loading } = useFetch(() => api.getLeads({ limit: 500 }))
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<LeadStatus | 'todos'>('todos')
  const [sort, setSort] = useState<SortKey>('recente')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = (data ?? []).filter((l) => {
      if (status !== 'todos' && l.status !== status) return false
      if (!q) return true
      return (
        (l.nome ?? '').toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        (l.area_juridica ?? '').toLowerCase().includes(q) ||
        (l.resumo_caso ?? '').toLowerCase().includes(q)
      )
    })
    out = [...out].sort((a, b) => {
      if (sort === 'nome') return (a.nome ?? 'zzz').localeCompare(b.nome ?? 'zzz', 'pt-BR')
      const cmp = (a.last_contact ?? '').localeCompare(b.last_contact ?? '')
      return sort === 'recente' ? -cmp : cmp
    })
    return out
  }, [data, query, status, sort])

  return (
    <Page>
      <PageHeader
        title="Clientes"
        subtitle={
          data
            ? `${data.length} pessoa${data.length !== 1 ? 's' : ''} registrada${data.length !== 1 ? 's' : ''} — inclusive quem não concluiu o atendimento`
            : 'Carregando…'
        }
        actions={<RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />}
      />

      <Reveal className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none">
            <IconSearch className="w-4 h-4" />
          </span>
          <input
            type="search"
            placeholder="Buscar por nome, telefone, área ou caso…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input pl-9 w-[22rem] max-w-full"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={status === f.key ? 'tab-btn-active' : 'tab-btn-inactive'}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="input !w-auto !py-1.5 text-xs ml-auto"
        >
          <option value="recente">Contato mais recente</option>
          <option value="antigo">Contato mais antigo</option>
          <option value="nome">Nome (A–Z)</option>
        </select>
      </Reveal>

      {!data ? (
        <SkeletonRows rows={6} height="h-14" />
      ) : (
        <Reveal className="card-flush">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="th !px-5">Contato</th>
                  <th className="th">Área</th>
                  <th className="th">Urgência</th>
                  <th className="th">Origem</th>
                  <th className="th">Último contato</th>
                  <th className="th">Estágio</th>
                  <th className="th w-10" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filtered.map((lead) => (
                    <LeadRow
                      key={lead.phone}
                      lead={lead}
                      onOpen={() => navigate(`/conversas?phone=${encodeURIComponent(lead.phone)}`)}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <EmptyState
              icon={<IconUsers className="w-11 h-11" />}
              title={query || status !== 'todos' ? 'Nenhum contato com esse filtro' : 'Nenhum contato registrado'}
              hint={
                query || status !== 'todos'
                  ? 'Tente limpar a busca ou voltar para "Todos".'
                  : 'Quem escrever no WhatsApp aparece aqui automaticamente.'
              }
            />
          )}
        </Reveal>
      )}

      {data && filtered.length > 0 && (
        <p className="text-xs text-slate-400 mt-3">
          Mostrando {filtered.length} de {data.length} · clique na linha para ver o caso
        </p>
      )}
    </Page>
  )
}
