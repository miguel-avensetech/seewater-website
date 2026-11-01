import clsx from 'clsx';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

const variants = {
  primary: 'bg-ocean-600 text-white hover:bg-ocean-700 dark:hover:bg-ocean-500 shadow-sm disabled:bg-ocean-600/60',
  secondary: 'bg-surface text-ink-soft border border-line-strong hover:bg-canvas hover:text-ink shadow-sm',
  ghost: 'text-ink-soft hover:bg-ocean-50 hover:text-ocean-700',
  danger: 'bg-crit-600 text-white hover:bg-crit-700 dark:hover:bg-crit-600/85 shadow-sm disabled:bg-crit-600/60',
  'danger-outline': 'bg-surface text-crit-700 border border-crit-600/40 hover:bg-crit-50',
};

const sizes = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  icon: 'h-9 w-9 justify-center',
  'icon-sm': 'h-8 w-8 justify-center',
};

export function buttonClass({ variant = 'primary', size = 'md', className } = {}) {
  return clsx(
    'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-70',
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant, size, loading = false, icon: Icon, children, className, disabled, type = 'button', ...props }) {
  return (
    <button type={type} className={buttonClass({ variant, size, className })} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant, size, icon: Icon, children, className, ...props }) {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })} {...props}>
      {Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </Link>
  );
}
