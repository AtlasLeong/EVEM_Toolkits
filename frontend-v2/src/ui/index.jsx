import { motion } from 'framer-motion'
import { clsx } from 'clsx'

// ── PageHeader ─────────────────────────────────────────────
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-2xl font-bold tracking-tight text-white"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.08 }}
            className="mt-1 text-sm text-white/40"
          >
            {subtitle}
          </motion.p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────
export function Card({ children, className, hover = false, ...props }) {
  return (
    <motion.div
      className={clsx(
        'glass rounded-2xl p-5 card-shadow',
        hover && 'transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.06] cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// ── Input ───────────────────────────────────────────────────
export function Input({ className, ...props }) {
  return (
    <input
      className={clsx(
        'w-full px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08]',
        'text-white/90 text-sm placeholder:text-white/25',
        'transition-all duration-200',
        'focus:outline-none focus:border-gold-500/60 focus:bg-white/[0.07]',
        className
      )}
      {...props}
    />
  )
}

// ── Button ──────────────────────────────────────────────────
export function Button({ children, variant = 'default', size = 'md', className, ...props }) {
  const variants = {
    gold:    'btn-gold rounded-xl',
    default: 'bg-white/[0.07] hover:bg-white/[0.11] text-white/80 border border-white/[0.08] rounded-xl transition-all duration-200',
    ghost:   'text-white/50 hover:text-white/85 hover:bg-white/[0.05] rounded-xl transition-all duration-200',
    danger:  'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl transition-all duration-200',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-[15px]',
  }
  return (
    <button
      className={clsx('font-medium flex items-center gap-1.5', variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  )
}

// ── Badge ───────────────────────────────────────────────────
export function Badge({ children, variant = 'default', className }) {
  const variants = {
    default: 'bg-white/[0.07] text-white/60 border-white/[0.08]',
    gold:    'bg-gold-500/10 text-gold-400 border-gold-500/20',
    red:     'bg-red-500/10 text-red-400 border-red-500/20',
    green:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  }
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}

// ── Spinner ─────────────────────────────────────────────────
export function Spinner({ size = 20 }) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      style={{ width: size, height: size }}
      className="rounded-full border-2 border-white/10 border-t-gold-400"
    />
  )
}

// ── Skeleton ─────────────────────────────────────────────────
export function Skeleton({ className }) {
  return (
    <div className={clsx(
      'rounded-lg bg-white/[0.05] animate-pulse',
      className
    )} />
  )
}

// ── Empty State ──────────────────────────────────────────────
export function Empty({ icon: Icon, title, desc }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {Icon && <Icon size={40} className="text-white/15 mb-4" strokeWidth={1} />}
      <p className="text-white/40 font-medium">{title}</p>
      {desc && <p className="text-white/25 text-sm mt-1">{desc}</p>}
    </div>
  )
}

// ── Divider ──────────────────────────────────────────────────
export function Divider({ className }) {
  return <div className={clsx('h-px bg-white/[0.06]', className)} />
}
