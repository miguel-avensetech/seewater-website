// Collection names, derived from the SeeWater manuscript data dictionary (Tables 4–25).
// Firestore documents use string IDs; foreign keys are stored as `<entity>Id` fields.

export const C = {
  admins: 'admins', // ADMIN
  users: 'users', // USER (homeowners)
  houses: 'houses', // HOUSE
  devices: 'devices', // IOT_DEVICE + DEVICE_REGISTRATION
  deviceStatusHistory: 'deviceStatusHistory', // DEVICE_STATUS_HISTORY
  sensors: 'sensors', // SENSOR
  sensorReadings: 'sensorReadings', // SENSOR_READING
  waterUsage: 'waterUsage', // WATER_USAGE (daily summaries per house)
  alerts: 'alerts', // ALERT
  notifications: 'notifications', // NOTIFICATION
  valves: 'valves', // VALVE
  activationCodes: 'activationCodes', // one document per code (admin/API only)
  valveCommands: 'valveCommands', // history of every valve command (admin, homeowner, automatic)
  deviceLogs: 'deviceLogs', // DEVICE_LOG
  systemLogs: 'systemLogs', // system activity / audit trail
  userManagement: 'userManagement', // USER_MANAGEMENT
  calibrations: 'calibrations', // CALIBRATION
  thresholdProfiles: 'thresholdProfiles', // THRESHOLD_PROFILE
  vibrationBaselines: 'vibrationBaselines', // VIBRATION_BASELINE
  vibrationBaselineHistory: 'vibrationBaselineHistory',
  announcements: 'announcements', // ANNOUNCEMENT
  waterInterruptions: 'waterInterruptions', // planned / emergency service interruptions
  waterRates: 'waterRates', // tariff schedules (₱ per m³) shown to homeowners and used for estimates
  firmwareUpdates: 'firmwareUpdates', // OTA firmware jobs, one per device
  feedback: 'feedback', // user suggestions / complaints / reports
  settings: 'settings',
};
