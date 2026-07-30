type Status =
  | 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'reschedule_requested' | 'cancel_requested'
  | 'qualified' | 'new' | 'returning'
  // Funil de leads — sessions.LEAD_STATUSES
  | 'novo' | 'qualificado' | 'consulta_agendada' | 'cliente' | 'perdido'

const styles: Record<Status, string> = {
  pending:               'bg-brass/12 text-brass',
  confirmed:             'bg-emerald-50 text-emerald-800',
  rejected:              'bg-red-50 text-red-700',
  cancelled:             'bg-slate-100 text-slate-500',
  qualified:             'bg-primary/10 text-primary',
  new:                   'bg-sky-50 text-sky-800',
  returning:             'bg-teal-50 text-teal-800',
  reschedule_requested:  'bg-indigo-50 text-indigo-700',
  cancel_requested:      'bg-orange-50 text-orange-800',
  novo:                  'bg-sky-50 text-sky-800',
  qualificado:           'bg-primary/10 text-primary',
  consulta_agendada:     'bg-brass/12 text-brass',
  cliente:               'bg-emerald-50 text-emerald-800',
  perdido:               'bg-slate-100 text-slate-500',
}

const labels: Record<Status, string> = {
  pending:               'Aguardando confirmação',
  confirmed:             'Confirmada',
  rejected:              'Recusada',
  cancelled:             'Cancelada',
  qualified:             'Qualificado',
  new:                   'Primeiro contato',
  returning:             'Retorno',
  reschedule_requested:  'Remarcação pendente',
  cancel_requested:      'Cancelamento pendente',
  novo:                  'Novo',
  qualificado:           'Qualificado',
  consulta_agendada:     'Consulta agendada',
  cliente:               'Cliente',
  perdido:               'Perdido',
}

/** Ponto de cor + rótulo: identidade nunca fica só na cor. */
export function StatusBadge({ status, dot = false }: { status: Status; dot?: boolean }) {
  return (
    <span className={`badge ${styles[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {labels[status] ?? status}
    </span>
  )
}
