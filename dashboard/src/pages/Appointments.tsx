import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  format, parseISO, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isToday, addMonths, subMonths,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Appointment, Service, needsAction } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { StatusBadge } from '../components/StatusBadge'
import { RefreshBar } from '../components/RefreshBar'
import { Page, PageHeader, Reveal, EmptyState } from '../components/Page'
import { shortArea, shortPhone, initials, hueFor } from '../lib/theme'
import { modalBackdrop, modalPanel, quick, springy } from '../lib/motion'
import {
  IconChevronLeft, IconChevronRight, IconPlus, IconClose,
  IconClock, IconPhone, IconCalendar, IconCheck, IconUsers, IconWhatsApp,
} from '../components/Icon'

interface AptForm {
  nome: string
  phone: string
  procedure: string
  datetime_local: string
  duration: number
  notes: string
  status: 'confirmed' | 'pending'
}

const ACTION_LABEL: Record<string, string> = {
  pending:              'quer confirmação',
  reschedule_requested: 'pediu para remarcar',
  cancel_requested:     'pediu para cancelar',
}

function NewAppointmentModal({
  onSave, onClose,
}: {
  onSave: (form: AptForm) => Promise<void>
  onClose: () => void
}) {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)

  const [form, setForm] = useState<AptForm>({
    nome: '',
    phone: '',
    procedure: '',
    datetime_local: format(now, "yyyy-MM-dd'T'HH:mm"),
    duration: 60,
    notes: '',
    status: 'confirmed',
  })
  const [services, setServices] = useState<Service[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getServices().then(setServices).catch(() => {})
  }, [])

  function handleServiceChange(name: string) {
    const svc = services.find((s) => s.name === name)
    setForm((f) => ({ ...f, procedure: name, duration: svc?.duration ?? f.duration }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
      setSaving(false)
    }
  }

  return (
    <motion.div
      variants={modalBackdrop}
      initial="initial" animate="animate" exit="exit"
      onClick={onClose}
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4"
    >
      <motion.div
        variants={modalPanel}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-panel border border-line w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line sticky top-0 bg-surface">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Marcar consulta</h2>
            <p className="text-xs text-slate-400">registro manual, fora do WhatsApp</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-ink hover:bg-ink/5 rounded-lg transition-colors"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label">Nome do cliente</label>
            <input
              className="input"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              placeholder="Ex.: Maria Silva"
              required
            />
          </div>
          <div>
            <label className="label">Telefone (com DDI e DDD)</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="5511999999999"
              required
            />
          </div>

          <div>
            <label className="label">Tipo de consulta ou área</label>
            <input
              list="apt-procedures"
              className="input"
              value={form.procedure}
              onChange={(e) => handleServiceChange(e.target.value)}
              placeholder="Consulta inicial, Direito Trabalhista…"
              required
            />
            <datalist id="apt-procedures">
              {services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Data e hora</label>
              <input
                type="datetime-local"
                className="input"
                value={form.datetime_local}
                onChange={(e) => setForm((f) => ({ ...f, datetime_local: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label">Duração (min)</label>
              <input
                type="number"
                className="input"
                value={form.duration}
                min={15}
                step={15}
                onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))}
                required
              />
            </div>
          </div>

          <div>
            <label className="label">Observações internas</label>
            <input
              className="input"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Opcional — visível só no CRM"
            />
          </div>

          <div>
            <label className="label">Situação</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AptForm['status'] }))}
            >
              <option value="confirmed">Já confirmada</option>
              <option value="pending">Aguardando confirmação</option>
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Salvando…' : 'Marcar consulta'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

const STATUS_EVENT_CLASS: Record<Appointment['status'], string> = {
  pending:              'cal-event-pending',
  confirmed:            'cal-event-confirmed',
  cancelled:            'cal-event-cancelled',
  rejected:             'cal-event-rejected',
  reschedule_requested: 'cal-event-pending',
  cancel_requested:     'cal-event-pending',
}

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

function DetailField({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="text-slate-300 mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
        <p className="text-[13px] text-ink">{children}</p>
      </div>
    </div>
  )
}

export function Appointments() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data: appointments, refetch, lastUpdated, loading } = useFetch(() => api.getAppointments())

  async function handleCreate(form: AptForm) {
    const dt = new Date(form.datetime_local)
    const endDt = new Date(dt.getTime() + form.duration * 60 * 1000)
    await api.createAppointment({
      phone:      form.phone,
      nome:       form.nome,
      procedure:  form.procedure,
      slot_start: dt.toISOString(),
      slot_end:   endDt.toISOString(),
      notes:      form.notes,
      status:     form.status,
    })
    refetch()
  }

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [currentMonth])

  const aptsByDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {}
    for (const apt of appointments ?? []) {
      try {
        const key = format(parseISO(apt.datetime), 'yyyy-MM-dd')
        map[key] = [...(map[key] ?? []), apt]
      } catch { /* data inválida: ignora */ }
    }
    for (const list of Object.values(map)) list.sort((a, b) => a.datetime.localeCompare(b.datetime))
    return map
  }, [appointments])

  const pending = useMemo(
    () => (appointments ?? [])
      .filter(needsAction)
      .sort((a, b) => a.datetime.localeCompare(b.datetime)),
    [appointments],
  )

  async function act(id: number, action: 'confirm' | 'reject') {
    setBusy(id)
    try {
      if (action === 'confirm') await api.confirmAppointment(id)
      else await api.rejectAppointment(id)
      refetch()
      setSelected((prev) => (prev?.id === id ? { ...prev, status: action === 'confirm' ? 'confirmed' : 'rejected' } : prev))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page>
      <PageHeader
        title="Agenda"
        subtitle={
          appointments
            ? `${appointments.length} consulta${appointments.length !== 1 ? 's' : ''} registrada${appointments.length !== 1 ? 's' : ''}`
            : 'Carregando…'
        }
        actions={
          <>
            <RefreshBar refetch={refetch} lastUpdated={lastUpdated} loading={loading} />
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <IconPlus className="w-4 h-4" /> Marcar consulta
            </button>
          </>
        }
      />

      {/* Pendências primeiro: é o que trava a agenda. */}
      <AnimatePresence>
        {pending.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springy}
            className="mb-5 overflow-hidden"
          >
            <div className="card-flush">
              <div className="flex items-center gap-2.5 px-5 py-3 bg-brass/8 border-b border-line">
                <span className="w-2 h-2 rounded-full bg-brass shrink-0" />
                <p className="text-[13px] font-semibold text-ink">
                  {pending.length} consulta{pending.length !== 1 ? 's' : ''} esperando decisão do escritório
                </p>
              </div>
              <div className="p-3 space-y-2">
                {pending.map((a, i) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * 0.05, duration: 0.28 }}
                    className="flex items-center gap-3 p-3 rounded-xl border border-line hover:border-brass/35 transition-colors"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
                      style={{ background: hueFor(a.phone) }}
                    >
                      {initials(a.nome, a.phone)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink truncate">
                        {a.nome || shortPhone(a.phone)}
                        <span className="text-slate-400 font-normal"> · {ACTION_LABEL[a.status]}</span>
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {format(parseISO(a.new_slot_start ?? a.datetime), "d 'de' MMM 'às' HH:mm", { locale: ptBR })}
                        {a.procedure && ` · ${shortArea(a.procedure)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => act(a.id, 'confirm')}
                        disabled={busy === a.id}
                        className="btn-primary !py-1.5 !px-3 text-xs"
                      >
                        <IconCheck className="w-3.5 h-3.5" /> Confirmar
                      </button>
                      <button
                        onClick={() => setSelected(a)}
                        className="btn-ghost !py-1.5 !px-2.5 text-xs"
                      >
                        Ver
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navegação do mês */}
      <Reveal className="flex items-center gap-2 mb-4">
        <button onClick={() => setCurrentMonth((m) => subMonths(m, 1))} className="btn-ghost !py-1.5 !px-2">
          <IconChevronLeft className="w-4 h-4" />
        </button>
        <button onClick={() => setCurrentMonth(new Date())} className="btn-secondary !py-1.5 !px-3 text-xs">
          Hoje
        </button>
        <button onClick={() => setCurrentMonth((m) => addMonths(m, 1))} className="btn-ghost !py-1.5 !px-2">
          <IconChevronRight className="w-4 h-4" />
        </button>
        <AnimatePresence mode="wait">
          <motion.span
            key={format(currentMonth, 'yyyy-MM')}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={quick}
            className="font-display text-base font-semibold text-ink capitalize ml-1"
          >
            {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
          </motion.span>
        </AnimatePresence>
      </Reveal>

      <div className="flex gap-4 items-start">
        <Reveal className={`card-flush flex-1 min-w-0 ${selected ? 'rounded-r-none' : ''}`}>
          <div className="grid grid-cols-7 border-b border-line bg-surface-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2.5">
                {d}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={format(currentMonth, 'yyyy-MM')}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
              className="grid grid-cols-7"
            >
              {days.map((day, i) => {
                const key     = format(day, 'yyyy-MM-dd')
                const dayApts = aptsByDay[key] ?? []
                const outside = !isSameMonth(day, currentMonth)
                const today   = isToday(day)

                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.006, 0.2), duration: 0.2 }}
                    className={`cal-day ${outside ? 'cal-day-outside' : ''} ${today ? 'cal-day-today' : ''}`}
                  >
                    <div className="flex justify-end mb-1">
                      <span
                        className={`text-[11px] font-medium w-6 h-6 flex items-center justify-center rounded-full tabular-nums ${
                          today ? 'bg-ink text-white' : outside ? 'text-slate-300' : 'text-slate-600'
                        }`}
                      >
                        {format(day, 'd')}
                      </span>
                    </div>
                    {dayApts.slice(0, 3).map((apt) => (
                      <motion.div
                        key={apt.id}
                        whileHover={{ x: 2 }}
                        transition={quick}
                        onClick={() => setSelected(apt)}
                        className={`cal-event ${STATUS_EVENT_CLASS[apt.status]} ${
                          selected?.id === apt.id ? 'ring-2 ring-primary ring-offset-1' : ''
                        }`}
                      >
                        {format(parseISO(apt.datetime), 'HH:mm')} {apt.nome || shortPhone(apt.phone)}
                      </motion.div>
                    ))}
                    {dayApts.length > 3 && (
                      <p className="text-[10px] text-slate-400 px-1.5">+{dayApts.length - 3} mais</p>
                    )}
                  </motion.div>
                )
              })}
            </motion.div>
          </AnimatePresence>

          {appointments?.length === 0 && (
            <EmptyState
              icon={<IconCalendar className="w-11 h-11" />}
              title="Nenhuma consulta na agenda"
              hint="As consultas marcadas pelo agente no WhatsApp caem aqui para o escritório confirmar."
            />
          )}
        </Reveal>

        {/* Painel de detalhe */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, x: 24, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 288 }}
              exit={{ opacity: 0, x: 24, width: 0 }}
              transition={springy}
              className="card shrink-0 rounded-l-none border-l-0 flex flex-col gap-4 overflow-hidden"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-[15px] font-semibold text-ink">Consulta</h3>
                <button
                  onClick={() => setSelected(null)}
                  className="text-slate-400 hover:text-ink transition-colors"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              <StatusBadge status={selected.status} dot />

              <div className="space-y-3">
                <DetailField icon={<IconUsers className="w-4 h-4" />} label="Cliente">
                  {selected.nome || shortPhone(selected.phone)}
                </DetailField>
                <DetailField icon={<IconPhone className="w-4 h-4" />} label="Telefone">
                  <span className="tabular-nums">{shortPhone(selected.phone)}</span>
                </DetailField>
                <DetailField icon={<IconCalendar className="w-4 h-4" />} label="Data e horário">
                  {format(parseISO(selected.datetime), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </DetailField>
                <DetailField icon={<IconClock className="w-4 h-4" />} label="Tipo">
                  {selected.procedure || 'Consulta'}
                </DetailField>
              </div>

              {selected.notes && (
                <div className="bg-surface-2 border border-line rounded-xl px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Observações</p>
                  <p className="text-xs text-slate-600 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}

              {selected.status === 'reschedule_requested' && selected.new_slot_start && (
                <div className="bg-brass/8 border border-brass/25 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-brass font-semibold mb-1">Novo horário pedido</p>
                  <p className="text-[13px] text-ink font-medium">
                    {format(parseISO(selected.new_slot_start), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              )}

              <a
                href={`https://wa.me/${shortPhone(selected.phone).replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary w-full !py-2 text-xs"
              >
                <IconWhatsApp className="w-3.5 h-3.5" /> Falar no WhatsApp
              </a>

              {selected.status === 'pending' && (
                <div className="border-t border-line pt-3 space-y-2 mt-auto">
                  <button
                    onClick={() => act(selected.id, 'confirm')}
                    disabled={busy === selected.id}
                    className="btn-primary w-full !py-2 text-xs"
                  >
                    <IconCheck className="w-3.5 h-3.5" /> Confirmar consulta
                  </button>
                  <button
                    onClick={() => act(selected.id, 'reject')}
                    disabled={busy === selected.id}
                    className="btn-ghost w-full !py-2 text-xs !text-red-600 hover:!bg-red-50"
                  >
                    Recusar este horário
                  </button>
                </div>
              )}

              {selected.status === 'reschedule_requested' && (
                <div className="border-t border-line pt-3 space-y-2 mt-auto">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Remarcação pedida pelo cliente
                  </p>
                  <button
                    onClick={() => act(selected.id, 'confirm')}
                    disabled={busy === selected.id}
                    className="btn-primary w-full !py-2 text-xs"
                  >
                    <IconCheck className="w-3.5 h-3.5" /> Aceitar novo horário
                  </button>
                  <button
                    onClick={() => act(selected.id, 'reject')}
                    disabled={busy === selected.id}
                    className="btn-ghost w-full !py-2 text-xs !text-red-600 hover:!bg-red-50"
                  >
                    Recusar remarcação
                  </button>
                </div>
              )}

              {selected.status === 'cancel_requested' && (
                <div className="border-t border-line pt-3 space-y-2 mt-auto">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Cancelamento pedido pelo cliente
                  </p>
                  <button
                    onClick={() => act(selected.id, 'confirm')}
                    disabled={busy === selected.id}
                    className="w-full bg-red-600 hover:bg-red-700 text-white rounded-xl py-2 text-xs font-medium transition-colors"
                  >
                    Confirmar cancelamento
                  </button>
                  <button
                    onClick={() => act(selected.id, 'reject')}
                    disabled={busy === selected.id}
                    className="btn-ghost w-full !py-2 text-xs"
                  >
                    Manter a consulta
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showCreate && <NewAppointmentModal onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
    </Page>
  )
}
