type Status =
  | 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'reschedule_requested' | 'cancel_requested'
  | 'qualified' | 'new' | 'returning'
  // Funil de leads — sessions.LEAD_STATUSES
  | 'novo' | 'qualificado' | 'consulta_agendada' | 'cliente' | 'perdido'

const styles: Record<Status, string> = {
  pending:               'bg-amber-100 text-amber-700',
  confirmed:             'bg-emerald-100 text-emerald-700',
  rejected:              'bg-red-100 text-red-600',
  cancelled:             'bg-gray-100 text-gray-500',
  qualified:             'bg-purple-100 text-purple-700',
  new:                   'bg-sky-100 text-sky-700',
  returning:             'bg-teal-100 text-teal-700',
  reschedule_requested:  'bg-blue-100 text-blue-700',
  cancel_requested:      'bg-orange-100 text-orange-700',
  novo:                  'bg-sky-100 text-sky-700',
  qualificado:           'bg-purple-100 text-purple-700',
  consulta_agendada:     'bg-amber-100 text-amber-700',
  cliente:               'bg-emerald-100 text-emerald-700',
  perdido:               'bg-gray-100 text-gray-500',
}

const labels: Record<Status, string> = {
  pending:               'Pendente',
  confirmed:             'Confirmado',
  rejected:              'Rejeitado',
  cancelled:             'Cancelado',
  qualified:             'Qualificado',
  new:                   'Primeira vez',
  returning:             'Retorno',
  reschedule_requested:  'Remarcação pendente',
  cancel_requested:      'Cancelamento pendente',
  novo:                  'Novo',
  qualificado:           'Qualificado',
  consulta_agendada:     'Consulta agendada',
  cliente:               'Cliente',
  perdido:               'Perdido',
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  )
}
