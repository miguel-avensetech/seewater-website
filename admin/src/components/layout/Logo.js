import clsx from 'clsx';

// SeeWater mark: a droplet with an "eye" ripple — monitoring water.
export function Logo({ className }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id="sw-drop" x1="8" y1="4" x2="32" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2CCBE0" />
          <stop offset="1" stopColor="#0E63C2" />
        </linearGradient>
      </defs>
      <path d="M20 3c6.2 7.6 12 14.6 12 21.2C32 31 26.6 36 20 36S8 31 8 24.2C8 17.6 13.8 10.6 20 3Z" fill="url(#sw-drop)" />
      <path d="M12.5 25.2c2.2-2.6 4.7-3.9 7.5-3.9s5.3 1.3 7.5 3.9c-2.2 2.6-4.7 3.9-7.5 3.9s-5.3-1.3-7.5-3.9Z" fill="#fff" fillOpacity=".95" />
      <circle cx="20" cy="25.2" r="2.3" fill="#0A1F3D" />
    </svg>
  );
}

export function Wordmark({ className, light = false }) {
  return (
    <span className={clsx('flex items-center gap-2.5', className)}>
      <Logo className="h-8 w-8" />
      <span className="leading-none">
        <span className={clsx('block text-[17px] font-bold tracking-tight', light ? 'text-white' : 'text-ink')}>
          See<span className={light ? 'text-aqua-400' : 'text-ocean-600'}>Water</span>
        </span>
        <span className={clsx('mt-1 block text-[10px] font-semibold uppercase tracking-[0.16em]', light ? 'text-white/50' : 'text-faint')}>Admin Console</span>
      </span>
    </span>
  );
}
