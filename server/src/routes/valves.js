import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { recentValveCommands } from '../services/valves.js';

// Administrators can view valve history but not operate valves: only the
// homeowner (mobile app) or the automatic shutoff sends valve commands.
const router = Router();

router.get(
  '/:id/commands',
  asyncHandler(async (req, res) => {
    const valve = await db.get(C.valves, req.params.id);
    if (!valve) throw notFound('Valve');
    res.json({ items: await recentValveCommands(valve.id, 20) });
  }),
);

export default router;
