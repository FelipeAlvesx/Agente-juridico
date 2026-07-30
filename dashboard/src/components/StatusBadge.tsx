type Status = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'qualified' | 'new' | 'returning' | 'reschedule_requested' | 'cancel_requested'

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
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  )
}
