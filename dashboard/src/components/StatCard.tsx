import { ReactNode, useEffect } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import { itemVariants, quick } from '../lib/motion'
import { IconTrendUp, IconTrendDown } from './Icon'

interface Props {
  label: string
  subtitle?: ReactNode
  value: string | number
  trend?: { pct: number; label?: string }
  icon?: ReactNode
  /** Realça o card quando o número exige ação (pendências, urgências). */
  accent?: 'brass' | 'critical'
  onClick?: () => void
}

/** Contador que sobe até o valor — spring, para o número "assentar". */
export function AnimatedNumber({ target }: { target: number }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(0)
  const spring = useSpring(mv, { stiffness: 90, damping: 20, mass: 0.8 })
  const text = useTransform(spring, (v) => Math.round(v).toLocaleString('pt-BR'))

  useEffect(() => { mv.set(target) }, [target, mv])

  if (reduce) return <>{target.toLocaleString('pt-BR')}</>
  return <motion.span>{text}</motion.span>
}

const ACCENTS = {
  brass:    { ring: 'ring-1 ring-brass/25', chip: 'bg-brass/12 text-brass',    bar: 'bg-brass' },
  critical: { ring: 'ring-1 ring-red-200',  chip: 'bg-red-50 text-red-700',    bar: 'bg-red-500' },
  none:     { ring: '',                     chip: 'bg-primary/8 text-primary', bar: 'bg-primary' },
}

export function StatCard({ label, subtitle, value, trend, icon, accent, onClick }: Props) {
  const isNumeric = typeof value === 'number'
  const up = trend && trend.pct >= 0
  const a = ACCENTS[accent ?? 'none']

  return (
    <motion.div
      variants={itemVariants}
      whileHover={onClick ? { y: -3, transition: quick } : undefined}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      onClick={onClick}
      className={`card relative overflow-hidden ${a.ring} ${onClick ? 'cursor-pointer' : ''}`}
    >
      {/* Filete superior: assinatura do card, cresce na entrada. */}
      <motion.span
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1], delay: 0.12 }}
        className={`absolute top-0 left-0 h-[3px] w-full origin-left ${a.bar} opacity-70`}
      />

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-1 truncate">{subtitle}</p>}
        </div>
        {icon && (
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${a.chip}`}>
            {icon}
          </div>
        )}
      </div>

      <p className="font-display text-[32px] leading-none font-semibold text-ink tabular-nums">
        {isNumeric ? <AnimatedNumber target={value} /> : value}
      </p>

      {trend && (
        <div className={`flex items-center gap-1 mt-2.5 text-xs font-medium ${up ? 'text-emerald-700' : 'text-red-600'}`}>
          {up ? <IconTrendUp className="w-3.5 h-3.5" /> : <IconTrendDown className="w-3.5 h-3.5" />}
          <span>{up ? '+' : ''}{trend.pct.toFixed(1)}% {trend.label ?? 'vs período anterior'}</span>
        </div>
      )}
    </motion.div>
  )
}
