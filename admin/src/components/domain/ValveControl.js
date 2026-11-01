'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { FlaskConical, Hourglass, Power, PowerOff, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/components/layout/AuthProvider';
import { VALVE } from '@/lib/labels';

/**
 * Solenoid valve control. The confirmed state (`valve.status`) only changes when
 * the ESP32 acknowledges the command; until then the UI shows "awaiting confirmation".
 */
export function ValveControl({ valve, device, onChanged, compact = false }) {
  const toast = useToast();
  const { canEdit } = useAuth();
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!valve) return <p className="text-xs text-muted">No solenoid valve registered for this device.</p>;

  const pending = valve.commandStatus === 'pending';
  const failed = valve.commandStatus === 'failed';
  const closing = valve.requestedState === 'closed';
  const offline = device && device.connectionStatus !== 'online';
  const simulated = Boolean(device?.isSimulated);

  async function send(action, reason) {
    await api(`/valves/${valve.id}/command`, { method: 'POST', body: { action, reason } });
    toast.info(action === 'close' ? 'Shutoff command sent' : 'Restore command sent', 'Waiting for the device to confirm the valve state.');
    onChanged?.();
  }

  async function run(path, success) {
    setBusy(true);
    try {
      await api(`/valves/${valve.id}/${path}`, { method: 'POST' });
      toast.success(success);
      onChanged?.();
    } catch (err) {
      toast.error('Action failed', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={clsx('space-y-2', compact && 'text-[13px]')}>
      <div className="flex flex-wrap items-center gap-2">
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
        {failed && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-crit-700">
            <XCircle className="h-3.5 w-3.5" aria-hidden /> Last command failed: {valve.failureReason}
          </span>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <>
              {simulated && (
                <Button size="sm" variant="secondary" icon={FlaskConical} loading={busy} onClick={() => run('simulate-ack', 'Simulated device confirmation recorded')} title="Test devices only — stands in for the ESP32 acknowledgement">
                  Simulate confirmation
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('cancel', 'Pending command cancelled')}>
                Cancel command
              </Button>
            </>
          ) : valve.status === 'closed' ? (
            <Button size="sm" variant="secondary" icon={Power} onClick={() => setConfirm('open')}>
              Restore water
            </Button>
          ) : (
            <Button size="sm" variant="danger-outline" icon={PowerOff} onClick={() => setConfirm('close')}>
              Shut off water
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'close'}
        onClose={() => setConfirm(null)}
        onConfirm={() => send('close', 'Manual shutoff from admin dashboard')}
        title="Shut off water supply?"
        confirmLabel="Send shutoff command"
        confirmText="SHUTOFF"
        message={
          <div className="space-y-2">
            <p>This sends a command to <strong>{device?.deviceName ?? 'the device'}</strong> to close the solenoid valve and stop water to the household.</p>
            <p className="text-[13px] text-muted">The valve is only shown as closed after the device responds. The homeowner is notified.{offline && ' This device is currently offline, so the command will wait until it reconnects.'}</p>
          </div>
        }
      />
      <ConfirmDialog
        open={confirm === 'open'}
        onClose={() => setConfirm(null)}
        onConfirm={() => send('open', 'Manual restore from admin dashboard')}
        title="Restore water supply?"
        tone="primary"
        confirmLabel="Send restore command"
        message={`This asks ${device?.deviceName ?? 'the device'} to reopen the valve. Make sure the leak or issue has been addressed first.`}
      />
    </div>
  );
}
