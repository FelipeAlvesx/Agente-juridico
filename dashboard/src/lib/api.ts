const BASE = import.meta.env.VITE_API_URL ?? ''

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

export interface Lead {
  phone: string
  nome: string | null
  procedimento_interesse: string | null
  indicacao: string | null
  qualified: boolean
  created_at: string | null
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

export interface Escalation {
  id: number
  phone: string
  nome: string | null
  reason: string
  category: 'medica' | 'reclamacao' | 'pedido_humano' | 'confusao_repetida' | 'fora_escopo'
  created_at: string
}

export interface ClinicConfig {
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

  getLeads: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    return request<{ leads: Lead[]; count: number }>(`/api/leads?${qs}`).then((r) => r.leads)
  },

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
    request<ClinicConfig>('/api/config'),

  updateConfig: (data: Partial<ClinicConfig>) =>
    request<{ ok: boolean }>('/api/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}
