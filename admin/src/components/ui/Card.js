import clsx from 'clsx';

export function Card({ className, children, ...props }) {
  return (
    <section className={clsx('min-w-0 rounded-xl border border-line bg-surface shadow-card', className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions, icon: Icon, className }) {
  return (
    <header className={clsx('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ocean-50 text-ocean-600">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className, children }) {
  return <div className={clsx('px-5 py-4', className)}>{children}</div>;
}
