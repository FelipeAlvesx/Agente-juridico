import { useState, useMemo, useEffect } from 'react'
import {
  format, parseISO, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isToday, addMonths, subMonths,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Appointment, Service } from '../lib/api'
import { useFetch } from '../hooks/useFetch'
import { StatusBadge } from '../components/StatusBadge'
import { IconChevronLeft, IconChevronRight, IconPlus, IconClose, IconClock, IconPhone } from '../components/Icon'

type View = 'month' | 'week' | 'day'

interface AptForm {
  nome: string
  phone: string
  procedure: string
  datetime_local: string
  duration: number
  notes: string
  status: 'confirmed' | 'pending'
}

function NewAppointmentModal({
  onSave,
  onClose,
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Novo Agendamento</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Nome do paciente</label>
              <input
                className="input"
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Maria Silva"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Telefone</label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="5511999999999"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Procedimento</label>
            <input
              list="apt-procedures"
              className="input"
              value={form.procedure}
              onChange={(e) => handleServiceChange(e.target.value)}
              placeholder="Selecione ou digite o procedimento"
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
              <label className="block text-xs text-gray-500 mb-1">Data e hora</label>
              <input
                type="datetime-local"
                className="input"
                value={form.datetime_local}
                onChange={(e) => setForm((f) => ({ ...f, datetime_local: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duração (min)</label>
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
            <label className="block text-xs text-gray-500 mb-1">Observações</label>
            <input
              className="input"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Opcional"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AptForm['status'] }))}
            >
              <option value="confirmed">Confirmado</option>
              <option value="pending">Pendente</option>
            </select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Salvando…' : 'Criar agendamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const STATUS_EVENT_CLASS: Record<Appointment['status'], string> = {
  pending:               'cal-event-pending',
  confirmed:             'cal-event-confirmed',
  cancelled:             'cal-event-cancelled',
  rejected:              'cal-event-rejected',
  reschedule_requested:  'cal-event-pending',
  cancel_requested:      'cal-event-pending',
}

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

export function Appointments() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [view, setView] = useState<View>('month')
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data: appointments, refetch } = useFetch(() => api.getAppointments())

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

  /* Build calendar grid */
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [currentMonth])

  /* Map appointments by day */
  const aptsByDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {}
    for (const apt of appointments ?? []) {
      try {
        const key = format(parseISO(apt.datetime), 'yyyy-MM-dd')
        map[key] = [...(map[key] ?? []), apt]
      } catch { /* skip */ }
    }
    return map
  }, [appointments])

  async function act(id: number, action: 'confirm' | 'reject') {
    setBusy(id)
    try {
      if (action === 'confirm') await api.confirmAppointment(id)
      else await api.rejectAppointment(id)
      refetch()
      setSelected(prev => prev?.id === id ? { ...prev, status: action === 'confirm' ? 'confirmed' : 'rejected' } : prev)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in pb-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Agendamentos</h1>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5">
          <IconPlus className="w-4 h-4" />
          Novo Agendamento
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Month nav */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentMonth(m => subMonths(m, 1))}
            className="btn-ghost py-1.5 px-2"
          >
            <IconChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentMonth(new Date())}
            className="btn-secondary py-1.5 px-3 text-xs"
          >
            Hoje
          </button>
          <button
            onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            className="btn-ghost py-1.5 px-2"
          >
            <IconChevronRight className="w-4 h-4" />
          </button>
          <span className="text-base font-semibold text-gray-800 capitalize ml-1">
            {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
          </span>
        </div>

        {/* View tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {(['day','week','month'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        {/* Calendar */}
        <div className={`card p-0 overflow-hidden flex-1 transition-all duration-300 ${selected ? 'rounded-r-none' : ''}`}>
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider py-3">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key     = format(day, 'yyyy-MM-dd')
              const dayApts = aptsByDay[key] ?? []
              const outside = !isSameMonth(day, currentMonth)
              const today   = isToday(day)

              return (
                <div
                  key={key}
                  className={`cal-day ${outside ? 'cal-day-outside' : ''} ${today ? 'cal-day-today' : ''}`}
                >
                  <div className="flex justify-end mb-1">
                    <span
                      className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                        today
                          ? 'bg-primary text-white'
                          : outside
                          ? 'text-gray-300'
                          : 'text-gray-600'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                  </div>
                  {dayApts.slice(0, 3).map(apt => (
                    <div
                      key={apt.id}
                      onClick={() => setSelected(apt)}
                      className={`cal-event ${STATUS_EVENT_CLASS[apt.status]} ${
                        selected?.id === apt.id ? 'ring-2 ring-primary ring-offset-1' : ''
                      }`}
                    >
                      {format(parseISO(apt.datetime), 'HH:mm')} {apt.nome ?? apt.phone}
                    </div>
                  ))}
                  {dayApts.length > 3 && (
                    <p className="text-[10px] text-gray-400 px-1.5">+{dayApts.length - 3} mais</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="card animate-slide-right w-72 shrink-0 rounded-l-none border-l-0 -ml-px flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Agendamento</h3>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={selected.status} />
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors ml-1"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex gap-2">
                <span className="text-gray-400 w-4 mt-0.5 shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                  </svg>
                </span>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Cliente</p>
                  <p className="font-medium text-gray-900">{selected.nome ?? selected.phone}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <span className="text-gray-400 mt-0.5 shrink-0"><IconPhone /></span>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Telefone</p>
                  <p className="text-gray-700">{selected.phone}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <span className="text-gray-400 mt-0.5 shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                </span>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Data e Horário</p>
                  <p className="text-gray-700">
                    {format(parseISO(selected.datetime), "dd/MM/yyyy · HH:mm", { locale: ptBR })}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <span className="text-gray-400 mt-0.5 shrink-0"><IconClock /></span>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Procedimento</p>
                  <p className="text-gray-700">{selected.procedure}</p>
                </div>
              </div>

              {selected.notes && (
                <div className="bg-amber-50 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1">Observações</p>
                  <p className="text-xs text-amber-800">{selected.notes}</p>
                </div>
              )}
            </div>

            {/* New slot info for reschedule */}
            {selected.status === 'reschedule_requested' && selected.new_slot_start && (
              <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-xs">
                <p className="text-[10px] uppercase tracking-wider text-blue-700 font-semibold mb-1">Novo horário solicitado</p>
                <p className="text-blue-800 font-medium">
                  {format(parseISO(selected.new_slot_start), "dd/MM/yyyy · HH:mm", { locale: ptBR })}
                </p>
              </div>
            )}

            {/* Actions */}
            {selected.status === 'pending' && (
              <div className="border-t border-gray-50 pt-3 space-y-2 mt-auto">
                <button
                  onClick={() => act(selected.id, 'confirm')}
                  disabled={busy === selected.id}
                  className="w-full btn-primary py-2 text-xs flex items-center justify-center gap-1.5"
                >
                  ✓ Confirmar agendamento
                </button>
                <button
                  onClick={() => act(selected.id, 'reject')}
                  disabled={busy === selected.id}
                  className="w-full btn-ghost py-2 text-xs text-red-500 hover:bg-red-50"
                >
                  ✕ Rejeitar
                </button>
              </div>
            )}

            {selected.status === 'reschedule_requested' && (
              <div className="border-t border-gray-50 pt-3 space-y-2 mt-auto">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Remarcação solicitada pela cliente</p>
                <button
                  onClick={() => act(selected.id, 'confirm')}
                  disabled={busy === selected.id}
                  className="w-full btn-primary py-2 text-xs flex items-center justify-center gap-1.5"
                >
                  ✓ Confirmar remarcação
                </button>
                <button
                  onClick={() => act(selected.id, 'reject')}
                  disabled={busy === selected.id}
                  className="w-full btn-ghost py-2 text-xs text-red-500 hover:bg-red-50"
                >
                  ✕ Rejeitar remarcação
                </button>
              </div>
            )}

            {selected.status === 'cancel_requested' && (
              <div className="border-t border-gray-50 pt-3 space-y-2 mt-auto">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Cancelamento solicitado pela cliente</p>
                <button
                  onClick={() => act(selected.id, 'confirm')}
                  disabled={busy === selected.id}
                  className="w-full bg-red-500 hover:bg-red-600 text-white rounded-xl py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  ✓ Confirmar cancelamento
                </button>
                <button
                  onClick={() => act(selected.id, 'reject')}
                  disabled={busy === selected.id}
                  className="w-full btn-ghost py-2 text-xs text-gray-500 hover:bg-gray-50"
                >
                  ✕ Manter agendamento
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <NewAppointmentModal
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}
