import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { parse, z } from '../lib/validate.js';
import { requireRole } from '../middleware/auth.js';
import { logSystem } from '../services/activity.js';
import { getSettings, saveSettings } from '../services/settings.js';

const router = Router();

const schema = z
  .object({
    leakAlertsEnabled: z.boolean(),
    highFlowAlertsEnabled: z.boolean(),
    deviceOfflineAlertsEnabled: z.boolean(),
    highFlowWarningLpm: z.coerce.number().positive('Must be greater than 0').max(200),
    highFlowCriticalLpm: z.coerce.number().positive('Must be greater than 0').max(200),
    leakMinFlowLpm: z.coerce.number().min(0.05, 'Minimum 0.05').max(10),
    dailyUsageWarningLiters: z.coerce.number().int().min(50).max(100000),
    alertCooldownMinutes: z.coerce.number().int().min(1).max(1440),
    autoShutoffOnCriticalLeak: z.boolean(),
  })
  .refine((d) => d.highFlowCriticalLpm > d.highFlowWarningLpm, { path: ['highFlowCriticalLpm'], message: 'Must be above the warning level' });

router.get('/', asyncHandler(async (_req, res) => res.json(await getSettings())));

router.patch(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const before = await getSettings();
    const data = parse(schema, req.body);
    const saved = await saveSettings(data, req.admin);
    const changed = Object.keys(data).filter((k) => data[k] !== before[k]);
    if (changed.length) {
      await logSystem({ category: 'system_update', action: 'settings_updated', description: `System settings changed: ${changed.join(', ')}`, status: 'info', actor: req.admin });
    }
    res.json(saved);
  }),
);

export default router;
