import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import { addDays, dayKey, startOfDay } from '../lib/time.js';
import { loadLookups } from '../services/lookups.js';
import { loadDailyUsage } from '../services/usage.js';
import { activeInterruptions } from './interruptions.js';
import { promoteScheduled } from './announcements.js';

const router = Router();

const OPEN = ['open', 'acknowledged'];

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const today = startOfDay();
    await promoteScheduled();
    const [lk, alerts, usage, announcements, feedback, activity, feedbackAll] = await Promise.all([
      loadLookups(),
      db.list(C.alerts, { where: [['alertStatus', 'in', OPEN]] }),
      loadDailyUsage(addDays(today, -6), new Date()),
      db.list(C.announcements, { orderBy: ['createdAt', 'desc'], limit: 30 }),
      db.list(C.feedback, { orderBy: ['createdAt', 'desc'], limit: 5 }),
      db.list(C.systemLogs, { orderBy: ['createdAt', 'desc'], limit: 8 }),
      db.list(C.feedback),
    ]);

    const devices = lk.devices;
    const online = devices.filter((d) => d.connectionStatus === 'online').length;
    const offline = devices.filter((d) => d.connectionStatus === 'offline').length;
    const critical = alerts.filter((a) => a.severityLevel === 'critical').length;
    const interruptions = await activeInterruptions();

    let systemStatus = 'operational';
    const issues = [];
    if (critical) {
      systemStatus = 'critical';
      issues.push(`${critical} critical alert${critical > 1 ? 's' : ''} open`);
    }
    if (offline) {
      if (systemStatus === 'operational') systemStatus = 'degraded';
      issues.push(`${offline} device${offline > 1 ? 's' : ''} offline`);
    }
    if (alerts.length - critical > 0) {
      if (systemStatus === 'operational') systemStatus = 'degraded';
      issues.push(`${alerts.length - critical} warning alert${alerts.length - critical > 1 ? 's' : ''} open`);
    }

    const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(today, i - 6)));
    const byDay = new Map(days.map((d) => [d, 0]));
    for (const u of usage) if (byDay.has(u.date)) byDay.set(u.date, byDay.get(u.date) + u.litersUsed);
    const todayKey = dayKey(today);
    const todayRows = usage.filter((u) => u.date === todayKey);

    res.json({
      stats: {
        totalUsers: lk.users.length,
        totalHouseholds: lk.houses.length,
        publishedAnnouncements: await db.count(C.announcements, { where: [['status', '==', 'published']] }),
        totalFeedback: feedbackAll.length,
        newFeedback: feedbackAll.filter((f) => f.status === 'new').length,
        activeUsers: lk.users.filter((u) => u.status === 'active').length,
        totalDevices: devices.length,
        connectedDevices: online,
        offlineDevices: offline,
        activeAlerts: alerts.length,
        criticalAlerts: critical,
        waterInterruptions: interruptions.length,
      },
      systemStatus: { status: systemStatus, issues },
      consumption: {
        unit: 'L',
        today: todayRows.reduce((s, u) => s + u.litersUsed, 0),
        yesterday: byDay.get(days[5]) ?? 0,
        // null = no readings yet today (never shown as 0 L/min).
        peakFlowToday: todayRows.length ? todayRows.reduce((m, u) => Math.max(m, u.peakFlowRate), 0) : null,
        hasReadings: usage.length > 0,
        last7Days: days.map((d) => ({ date: d, liters: byDay.get(d) })),
        sources: [...new Set(usage.map((u) => u.source))],
      },
      interruptions: interruptions.slice(0, 3),
      recentAnnouncements: announcements.filter((a) => a.status !== 'draft').slice(0, 5),
      recentFeedback: feedback.map((f) => ({ ...f, userName: lk.userById.get(f.userId)?.fullName ?? 'Unknown user' })),
      recentActivity: activity.map((a) => ({ ...a, deviceName: lk.deviceName(a.deviceId) })),
    });
  }),
);

export default router;
