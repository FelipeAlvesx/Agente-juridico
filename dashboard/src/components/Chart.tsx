import { motion } from 'framer-motion'
import { MUTED } from '../lib/theme'

/**
 * Peças compartilhadas dos gráficos. Eixos recessivos, tooltip em ficha branca,
 * legenda sempre presente com ≥2 séries (identidade nunca fica só na cor).
 */

export const axisTick = { fontSize: 11, fill: MUTED } as const
export const axisProps = { axisLine: false, tickLine: false, tick: axisTick } as const

export function ChartTooltip({ active, payload, label, suffix = '' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-line shadow-lift rounded-xl px-3 py-2 text-xs min-w-[120px]">
      {label != null && <p className="font-semibold text-ink mb-1.5">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 leading-relaxed">
          <span
            className="w-2.5 h-2.5 rounded-[3px] shrink-0"
            style={{ background: p.color ?? p.payload?.fill ?? MUTED }}
          />
          <span className="text-slate-500">{p.name}</span>
          <span className="ml-auto font-semibold text-ink tabular-nums">
            {typeof p.value === 'number' ? p.value.toLocaleString('pt-BR') : p.value}{suffix}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ChartLegend({ items }: { items: { name: string; color: string; value?: number }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
      {items.map((d) => (
        <div key={d.name} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: d.color }} />
          <span className="text-xs text-slate-500">{d.name}</span>
          {d.value != null && (
            <span className="text-xs font-semibold text-ink tabular-nums">{d.value}</span>
          )}
        </div>
      ))}
    </div>
  )
}

/** Barra de progresso horizontal — usada no funil e nos rankings de área. */
export function MeterRow({
  label,
  value,
  total,
  color,
  caption,
  delay = 0,
}: {
  label: string
  value: number
  total: number
  color: string
  caption?: string
  delay?: number
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-[13px] text-ink truncate">{label}</span>
        <span className="text-[13px] font-semibold text-ink tabular-nums shrink-0">
          {value.toLocaleString('pt-BR')}
          <span className="text-slate-400 font-normal ml-1.5">{pct}%</span>
        </span>
      </div>
      <div className="h-2 bg-line/70 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 0.61, 0.36, 1], delay }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
      {caption && <p className="text-[11px] text-slate-400 mt-1">{caption}</p>}
    </div>
  )
}
