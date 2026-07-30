import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api, Appointment } from '../lib/api'
import { StatusBadge } from './StatusBadge'

interface Props {
  appointment: Appointment
  onUpdate: () => void
}

export function AppointmentCard({ appointment: apt, onUpdate }: Props) {
  const [busy, setBusy] = useState(false)

  async function act(action: 'confirm' | 'reject') {
    setBusy(true)
    try {
      if (action === 'confirm') await api.confirmAppointment(apt.id)
      else await api.rejectAppointment(apt.id)
      onUpdate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{apt.nome ?? apt.phone}</p>
        <p className="text-sm text-gray-500 truncate">{apt.procedure}</p>
        <p className="text-xs text-gray-400 mt-1">
          {format(parseISO(apt.datetime), "d 'de' MMM, HH:mm", { locale: ptBR })}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <StatusBadge status={apt.status} />
        {apt.status === 'pending' && (
          <div className="flex gap-2">
            <button
              onClick={() => act('confirm')}
              disabled={busy}
              className="btn-primary py-1 text-xs"
            >
              Confirmar
            </button>
            <button
              onClick={() => act('reject')}
              disabled={busy}
              className="btn-ghost py-1 text-xs text-red-500 hover:bg-red-50"
            >
              Rejeitar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
