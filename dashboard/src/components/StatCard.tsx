import { useEffect, useState } from 'react'
import { IconTrendUp, IconTrendDown } from './Icon'

interface Props {
  label: string
  subtitle?: string
  value: string | number
  trend?: { pct: number; label?: string }
  icon?: React.ReactNode
  delay?: number
}

function AnimatedNumber({ target }: { target: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const duration = 700
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setN(Math.round(ease * target))
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target])
  return <>{n.toLocaleString('pt-BR')}</>
}

export function StatCard({ label, subtitle, value, trend, icon, delay = 0 }: Props) {
  const isNumeric = typeof value === 'number'
  const up = trend && trend.pct >= 0

  return (
    <div
      className="card animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {icon && (
          <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center text-primary/70 shrink-0">
            {icon}
          </div>
        )}
      </div>

      <p className="text-3xl font-bold text-gray-900 tracking-tight">
        {isNumeric ? <AnimatedNumber target={value} /> : value}
      </p>

      {trend && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
          {up ? <IconTrendUp /> : <IconTrendDown />}
          <span>{up ? '+' : ''}{trend.pct.toFixed(1)}% {trend.label ?? 'vs mês anterior'}</span>
        </div>
      )}
    </div>
  )
}
