// `?.` para o módulo continuar importável fora do Vite (ver api.test.ts).
const BASE = import.meta.env?.VITE_API_URL ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export interface Stats {
  leads_total: number
  leads_qualified: number
  appointments_total: number
  appointments_pending: number
  appointments_confirmed: number
  escalations_total: number
  conversion_rate: number
}

export type LeadStatus = 'novo' | 'qualificado' | 'consulta_agendada' | 'cliente' | 'perdido'

export type MotivoPerda =
  | 'sem_resposta' | 'fora_area_atuacao' | 'sem_interesse'
  | 'buscou_outro_escritorio' | 'so_queria_informacao' | 'outro'

export const MOTIVO_PERDA_LABELS: Record<MotivoPerda, string> = {
  sem_resposta:            'Parou de responder',
  fora_area_atuacao:       'Fora da área de atuação',
  sem_interesse:           'Sem interesse',
  buscou_outro_escritorio: 'Foi para outro escritório',
  so_queria_informacao:    'Só queria informação',
  outro:                   'Outro',
}

export interface Lead {
  phone: string
  nome: string | null
  status: LeadStatus
  motivo_perda: MotivoPerda | ''
  /** Texto livre gravado pelo agente ao encerrar (ex.: área não atendida). */
  motivo_perda_detalhe: string
  qualified: boolean
  created_at: string | null
  last_contact: string | null
  // Campos de qualificação da vertical (tenants/*.yaml → lead_fields)
  area_juridica?: string | null
  resumo_caso?: string | null
  urgencia?: string | null
  origem?: string | null
}

/** Dias sem contato a partir dos quais um lead aberto entra na fila de retomada. */
export const STALE_DAYS = 3

export type FollowUpBucket = 'quente' | 'esfriando' | 'frio' | 'sem_resposta'

/**
 * Regra única de "precisa de follow-up". Mora aqui porque a Sidebar (contador)
 * e a tela de Follow-up (fila) precisam concordar — duas cópias divergem.
 * Retorna null para quem não está na fila.
 */
export function followUpBucket(lead: Lead): FollowUpBucket | null {
  if (lead.status === 'cliente') return null
  // Perdido por silêncio ainda merece uma última tentativa; perdido com motivo real, não.
  if (lead.status === 'perdido') return lead.motivo_perda === 'sem_resposta' ? 'sem_resposta' : null
  if (!lead.last_contact) return null
  const days = Math.floor((Date.now() - Date.parse(lead.last_contact)) / 86_400_000)
  if (Number.isNaN(days) || days < STALE_DAYS) return null
  if (days <= 7) return 'quente'
  if (days <= 20) return 'esfriando'
  return 'frio'
}

export interface Appointment {
  id: number
  phone: string
  nome: string | null
  procedure: string
  datetime: string
  slot_end: string | null
  new_slot_start: string | null
  new_slot_end: string | null
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'reschedule_requested' | 'cancel_requested'
  notes: string | null
  created_at: string
}

/**
 * Consultas que travam esperando uma decisão do escritório. Mesma razão do
 * followUpBucket: o contador da Sidebar e a lista da Agenda têm que bater.
 */
export const APPOINTMENT_NEEDS_ACTION: Appointment['status'][] = [
  'pending', 'reschedule_requested', 'cancel_requested',
]

export const needsAction = (a: Appointment) => APPOINTMENT_NEEDS_ACTION.includes(a.status)

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface ConversationSummary {
  phone: string
  nome: string
  last_message: string
  last_role: 'user' | 'assistant'
  last_ts: string | null
  escalated: boolean
}

export interface Service {
  id: number
  category: string
  name: string
  duration: number
  price: number
  active: boolean
}

export interface Professional {
  id: number
  name: string
  specialty: string
  initials: string
  color: string
  rating: number
  appointments_count: number
  services_count: number
  active: boolean
}

/** Espelha ESCALATION_CATEGORIES em verticals/advocacia/tools.py. */
export type EscalationCategory =
  | 'urgencia_prazo' | 'consulta_juridica' | 'processo_em_andamento'
  | 'reclamacao' | 'pedido_humano' | 'confusao_repetida'

export interface Escalation {
  id: number
  phone: string
  nome: string | null
  reason: string
  category: EscalationCategory
  created_at: string
}

export interface FirmConfig {
  name: string
  segment: string
  address: string
  phone: string
  hours: string
  timezone: string
  agent_name: string
}

export const api = {
  getStats: () =>
    request<Omit<Stats, 'conversion_rate'>>('/api/stats').then((d) => ({
      ...d,
      conversion_rate: d.leads_total > 0 ? d.leads_qualified / d.leads_total : 0,
    })),

  getLeads: (params?: { limit?: number; offset?: number; status?: LeadStatus }) => {
    const qs = new URLSearchParams()
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    if (params?.status) qs.set('status', params.status)
    return request<{ leads: Lead[]; count: number }>(`/api/leads?${qs}`).then((r) => r.leads)
  },

  // status 'auto' apaga a marcação manual e devolve o lead ao status derivado.
  setLeadStatus: (phone: string, status: LeadStatus | 'auto', motivo_perda?: MotivoPerda) =>
    request<{ ok: boolean }>(`/api/leads/${encodeURIComponent(phone)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, motivo_perda }),
    }),

  getAppointments: (params?: { status?: string; date_from?: string; date_to?: string }) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.date_from) qs.set('date_from', params.date_from)
    if (params?.date_to) qs.set('date_to', params.date_to)
    return request<{ appointments: Appointment[]; count: number }>(`/api/appointments?${qs}`).then((r) => r.appointments)
  },

  getConversations: () =>
    request<{ conversations: ConversationSummary[] }>('/api/conversations').then((r) => r.conversations),

  getConversation: (phone: string) =>
    request<{ phone: string; messages: Message[] }>(`/api/conversations/${encodeURIComponent(phone)}`).then((r) => r.messages),

  confirmAppointment: (id: number) =>
    request<{ ok: boolean }>(`/api/appointments/${id}/confirm`, { method: 'POST' }),

  rejectAppointment: (id: number, reason?: string) =>
    request<{ ok: boolean }>(`/api/appointments/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  rescheduleAppointment: (id: number, new_slot_start: string, new_slot_end: string) =>
    request<{ ok: boolean }>(`/api/appointments/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ new_slot_start, new_slot_end }),
    }),

  cancelAppointment: (id: number, reason?: string) =>
    request<{ ok: boolean }>(`/api/appointments/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  createAppointment: (data: {
    phone: string
    nome: string
    procedure: string
    slot_start: string
    slot_end: string
    notes?: string
    status?: 'pending' | 'confirmed'
  }) =>
    request<{ id: number; ok: boolean }>('/api/appointments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Services
  getServices: () =>
    request<{ services: Service[] }>('/api/services').then((r) => r.services),

  createService: (data: Omit<Service, 'id'>) =>
    request<{ id: number; ok: boolean }>('/api/services', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateService: (id: number, data: Partial<Omit<Service, 'id'>>) =>
    request<{ ok: boolean }>(`/api/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteService: (id: number) =>
    request<{ ok: boolean }>(`/api/services/${id}`, { method: 'DELETE' }),

  // Professionals
  getProfessionals: () =>
    request<{ professionals: Professional[] }>('/api/professionals').then((r) => r.professionals),

  createProfessional: (data: Omit<Professional, 'id'>) =>
    request<{ id: number; ok: boolean }>('/api/professionals', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProfessional: (id: number, data: Partial<Omit<Professional, 'id'>>) =>
    request<{ ok: boolean }>(`/api/professionals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteProfessional: (id: number) =>
    request<{ ok: boolean }>(`/api/professionals/${id}`, { method: 'DELETE' }),

  // Escalations
  getEscalations: (limit = 50) =>
    request<{ escalations: Escalation[]; count: number }>(`/api/escalations?limit=${limit}`).then((r) => r.escalations),

  // Config
  getConfig: () =>
    request<FirmConfig>('/api/config'),

  updateConfig: (data: Partial<FirmConfig>) =>
    request<{ ok: boolean }>('/api/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}
