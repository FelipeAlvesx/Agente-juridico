import { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { itemVariants, pageVariants } from '../lib/motion'

/** Casca de tela: entrada animada + stagger dos filhos diretos. */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`pb-10 ${className}`}
    >
      {children}
    </motion.div>
  )
}

/** Filho animado do Page. Use em qualquer bloco que deva entrar em cascata. */
export function Reveal({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div variants={itemVariants} className={className} {...rest}>
      {children}
    </motion.div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <Reveal className="mb-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-[26px] leading-tight font-semibold text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
      </div>
      <div className="rule-brass mt-4" />
    </Reveal>
  )
}

export function Section({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Reveal className={`card ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle && <p className="panel-sub">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Reveal>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  className = '',
}: {
  icon?: ReactNode
  title: string
  hint?: string
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}
    >
      {icon && <div className="text-slate-200 mb-3">{icon}</div>}
      <p className="text-sm font-medium text-slate-500">{title}</p>
      {hint && <p className="text-xs text-slate-400 mt-1 max-w-xs">{hint}</p>}
    </motion.div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

/** Placeholder de lista enquanto o primeiro fetch não volta. */
export function SkeletonRows({ rows = 4, height = 'h-14' }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`${height} w-full`} />
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <Skeleton className="h-3 w-24 mb-4" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </>
  )
}
