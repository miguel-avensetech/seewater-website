import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requireAdmin } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import monitoringRoutes from './routes/monitoring.js';
import usageRoutes from './routes/usage.js';
import userRoutes, { housesRouter } from './routes/users.js';
import deviceRoutes, { sensorsRouter } from './routes/devices.js';
import calibrationRoutes from './routes/calibration.js';
import vibrationRoutes from './routes/vibration.js';
import alertRoutes from './routes/alerts.js';
import logRoutes from './routes/logs.js';
import valveRoutes from './routes/valves.js';
import announcementRoutes from './routes/announcements.js';
import feedbackRoutes from './routes/feedback.js';
import settingsRoutes from './routes/settings.js';
import deviceApiRoutes from './routes/deviceApi.js';
import mobileRoutes from './routes/mobile/index.js';
import interruptionRoutes from './routes/interruptions.js';
import firmwareRoutes from './routes/firmware.js';
import rateRoutes from './routes/rates.js';
import { activationCodesRouter, notificationsRouter, valveCommandsRouter } from './routes/operations.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // IoT device ingestion (device-key auth).
  app.use('/api/device-api', deviceApiRoutes);

  // Homeowner mobile app API (bearer-token auth, own audience).
  app.use('/api/mobile', mobileRoutes);

  // Admin dashboard API (session-cookie auth).
  app.use('/api/auth', authRoutes);
  const admin = express.Router();
  admin.use(requireAdmin);
  admin.use('/dashboard', dashboardRoutes);
  admin.use('/monitoring', monitoringRoutes);
  admin.use('/usage', usageRoutes);
  admin.use('/users', userRoutes);
  admin.use('/houses', housesRouter);
  admin.use('/devices', deviceRoutes);
  admin.use('/sensors', sensorsRouter);
  admin.use('/calibration', calibrationRoutes);
  admin.use('/vibration', vibrationRoutes);
  admin.use('/alerts', alertRoutes);
  admin.use('/logs', logRoutes);
  admin.use('/valves', valveRoutes);
  admin.use('/announcements', announcementRoutes);
  admin.use('/feedback', feedbackRoutes);
  admin.use('/settings', settingsRoutes);
  admin.use('/interruptions', interruptionRoutes);
  admin.use('/rates', rateRoutes);
  admin.use('/firmware', firmwareRoutes);
  admin.use('/valve-commands', valveCommandsRouter);
  admin.use('/activation-codes', activationCodesRouter);
  admin.use('/notifications', notificationsRouter);
  app.use('/api', admin);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
