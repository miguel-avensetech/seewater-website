'use client';

import clsx from 'clsx';
import { Hourglass, XCircle } from 'lucide-react';
import { fmtRelative } from '@/lib/format';
import { StatusBadge } from '@/components/ui/Badge';
import { VALVE } from '@/lib/labels';

/**
 * Read-only solenoid valve state. Only homeowners operate their valve (from the
 * app) or the automatic shutoff does; administrators can see it but not change it.
 * The confirmed state (`valve.status`) only changes when the ESP32 acknowledges.
 */
export function ValveStatus({ valve, compact = false }) {
  if (!valve) return <p className="text-xs text-muted">No solenoid valve registered for this device.</p>;

  const pending = valve.commandStatus === 'pending';
  const closing = valve.requestedState === 'closed';

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', compact && 'text-[13px]')}>
      <span className="text-xs font-medium text-muted">Valve</span>
      <StatusBadge map={VALVE} value={valve.status} />
      {pending && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-warn-700">
          <Hourglass className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          {closing ? 'Shutoff' : 'Restore'} awaiting device confirmation · sent {fmtRelative(valve.requestedAt)}
        </span>
      )}
      {valve.commandStatus === 'acknowledged' && (
        <span className="text-xs text-muted" title="The ESP32 relay design has no valve-position sensor">
          Device-reported · {valve.positionConfirmed ? 'position verified' : 'physical position not verified'}
          {valve.acknowledgedAt && ` · ${fmtRelative(valve.acknowledgedAt)}`}
        </span>
      )}
      {valve.commandStatus === 'failed' && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-crit-700">
          <XCircle className="h-3.5 w-3.5" aria-hidden /> Last command failed: {valve.failureReason}
        </span>
      )}
    </div>
  );
}
