import type { Transition, Variants } from 'framer-motion'

/**
 * Vocabulário de movimento do CRM. Uma curva só, três durações.
 * Ease de saída suave (sem overshoot): a interface é séria, não saltitante.
 */
export const EASE = [0.22, 0.61, 0.36, 1] as const

export const springy: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }
export const smooth:  Transition = { duration: 0.34, ease: EASE }
export const quick:   Transition = { duration: 0.18, ease: EASE }

/** Troca de tela: sobe entrando, desce saindo — dá direção à navegação. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { ...smooth, staggerChildren: 0.05, delayChildren: 0.04 } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.16, ease: EASE } },
}

/** Filho de uma lista/grid com stagger. Combina com `stagger` no pai. */
export const itemVariants: Variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: smooth },
  exit:    { opacity: 0, y: -6, scale: 0.98, transition: quick },
}

export const stagger = (delayChildren = 0, staggerChildren = 0.05): Variants => ({
  initial: {},
  animate: { transition: { staggerChildren, delayChildren } },
})

/**
 * Entrada de item de lista com delay próprio, sem herdar variant do pai.
 *
 * `AnimatePresence` no meio da árvore corta a propagação de variants — o filho
 * fica preso no estado `initial` (opacity 0) e a lista some. Todo item dentro de
 * um `AnimatePresence` usa isto em vez de `variants={itemVariants}`.
 */
export const revealItem = (i = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { ...smooth, delay: Math.min(i * 0.045, 0.4) },
})

/** Cartão clicável: levanta no hover, afunda no clique. */
export const liftable = {
  whileHover: { y: -3, transition: quick },
  whileTap:   { scale: 0.985, transition: { duration: 0.08 } },
}

export const modalBackdrop: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: quick },
  exit:    { opacity: 0, transition: quick },
}

export const modalPanel: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: springy },
  exit:    { opacity: 0, scale: 0.97, y: 6, transition: quick },
}
