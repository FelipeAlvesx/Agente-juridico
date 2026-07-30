/**
 * Tokens visuais compartilhados entre gráficos e listas.
 *
 * SERIES é a paleta categórica dos gráficos. Foi validada (faixa de luminosidade,
 * piso de croma, separação para deuteranopia/tritanopia, contraste ≥ 3:1 no papel).
 * Ordem é fixa: a cor segue a entidade, nunca a posição no ranking. Não recicle,
 * não gere uma 7ª cor — o excedente vira "Outras".
 */
export const SERIES = [
  '#2E5FA3', // navy
  '#B07C1E', // latão
  '#0E8F7E', // teal
  '#C24B3C', // terracota
  '#6B58B8', // violeta
  '#5C8C3A', // oliva
] as const

/** Etapas do funil: escala sequencial de um hue só, claro → escuro. */
export const FUNNEL_RAMP = ['#A9C2E4', '#7FA2D0', '#5580BC', '#2E5FA3', '#1E3A63'] as const

export const INK   = '#141E33'
export const BRASS = '#B07C1E'
export const MUTED = '#94A3B8'

/** Status reservado — nunca reaproveitado como "série 4". */
export const STATUS = {
  good:     '#2F7D4F',
  warning:  '#B07C1E',
  serious:  '#C2600F',
  critical: '#B3261E',
  neutral:  '#64748B',
} as const

/** Cor estável por entidade (avatar, coluna) — hash, não índice de lista. */
export function hueFor(key: string): string {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return SERIES[h % SERIES.length]
}

export function initials(nome: string | null | undefined, phone: string): string {
  const n = (nome ?? '').trim()
  if (!n) return phone.replace(/\D/g, '').slice(-2) || '—'
  const parts = n.split(/\s+/)
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** O sufixo do JID não interessa a ninguém no escritório. */
export function shortPhone(phone: string): string {
  return phone.replace('@s.whatsapp.net', '')
}

export const AREA_SHORT: Record<string, string> = {
  'Direito Trabalhista':            'Trabalhista',
  'Direito de Família e Sucessões': 'Família',
  'Direito do Consumidor':          'Consumidor',
  'Direito Previdenciário':         'Previdenciário',
  'Direito Civil e Contratos':      'Cível',
  'Direito Empresarial':            'Empresarial',
  'Direito Imobiliário':            'Imobiliário',
  'Direito Criminal':               'Criminal',
}

export const shortArea = (a?: string | null) => (a ? AREA_SHORT[a] ?? a : '')

export const URGENCIA: Record<string, { label: string; color: string; bg: string }> = {
  alta:  { label: 'Urgente',      color: '#B3261E', bg: '#FDECEA' },
  media: { label: 'Moderada',     color: '#B07C1E', bg: '#F8F0DE' },
  baixa: { label: 'Sem pressa',   color: '#475569', bg: '#F1F5F9' },
}
