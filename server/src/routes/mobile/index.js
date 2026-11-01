import { Router } from 'express';
import { requireHomeowner } from '../../middleware/homeownerAuth.js';
import authRoutes from './auth.js';
import dataRoutes from './data.js';

// Homeowner mobile app API. Bearer-token auth only (no cookies), so permissive
// CORS here cannot be abused for cross-site requests with ambient credentials.
const router = Router();

router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

router.use('/auth', authRoutes);
router.use(requireHomeowner, dataRoutes);

export default router;
