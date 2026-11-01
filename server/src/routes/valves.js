import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, conflict, notFound } from '../lib/errors.js';
import { parse, z } from '../lib/validate.js';
import { requireRole } from '../middleware/auth.js';
import { acknowledgeValveCommand, cancelValveCommand, recentValveCommands, requestValveCommand } from '../services/valves.js';

const router = Router();

router.get(
  '/:id/commands',
  asyncHandler(async (req, res) => {
    const valve = await db.get(C.valves, req.params.id);
    if (!valve) throw notFound('Valve');
    res.json({ items: await recentValveCommands(valve.id, 20) });
  }),
);

const commandSchema = z.object({
  action: z.enum(['close', 'open']),
  reason: z.string().trim().max(300).optional().default(''),
});

router.post(
  '/:id/command',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { action, reason } = parse(commandSchema, req.body);
    const valve = await requestValveCommand({ valveId: req.params.id, action, reason, actor: req.admin, actorType: 'admin' });
    res.status(202).json(valve);
  }),
);

// Withdraws a command the device never picked up (e.g. it is offline).
router.post(
  '/:id/cancel',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const valve = await db.get(C.valves, req.params.id);
    if (!valve) throw notFound('Valve');
    res.json(await cancelValveCommand({ valve, actor: req.admin, actorType: 'admin' }));
  }),
);

// Test devices only: lets an admin stand in for the ESP32 acknowledgement so the
// full shutoff flow can be demonstrated without hardware. Results are labelled simulated.
router.post(
  '/:id/simulate-ack',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const valve = await db.get(C.valves, req.params.id);
    if (!valve) throw notFound('Valve');
    const device = await db.get(C.devices, valve.deviceId);
    if (!device?.isSimulated) throw conflict('Only simulated test devices can be acknowledged from the dashboard. Real valves must be confirmed by the hardware.');
    const updated = await acknowledgeValveCommand({ valve, commandId: valve.commandId, state: valve.requestedState, success: true, positionConfirmed: false });
    res.json(updated);
  }),
);

export default router;
