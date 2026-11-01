// Human-readable labels and badge tones for API enum values.
// Tones: ok | warn | crit | info | neutral | aqua

const map = (entries) => Object.fromEntries(entries.map(([k, label, tone]) => [k, { label, tone }]));

export const CONNECTION = map([
  ['online', 'Online', 'ok'],
  ['offline', 'Offline', 'crit'],
  ['never_connected', 'Never connected', 'neutral'],
  ['not_activated', 'Not activated', 'neutral'],
]);

export const ACTIVATION = map([
  ['pending', 'Pending activation', 'warn'],
  ['activated', 'Activated', 'ok'],
  ['deactivated', 'Deactivated', 'neutral'],
]);

export const FLOW_STATUS = map([
  ['normal', 'Normal', 'ok'],
  ['high', 'High flow', 'warn'],
  ['critical', 'Critical', 'crit'],
  ['no_data', 'No data', 'neutral'],
  ['unknown', 'No data', 'neutral'],
]);

export const SEVERITY = map([
  ['info', 'Info', 'info'],
  ['warning', 'Warning', 'warn'],
  ['critical', 'Critical', 'crit'],
]);

export const ALERT_STATUS = map([
  ['open', 'Open', 'crit'],
  ['acknowledged', 'Acknowledged', 'warn'],
  ['resolved', 'Resolved', 'ok'],
]);

export const ALERT_TYPE = map([
  ['possible_leak', 'Possible leak', 'crit'],
  ['high_flow', 'High flow', 'warn'],
  ['device_offline', 'Device offline', 'neutral'],
  ['sensor_fault', 'Sensor fault', 'warn'],
]);

export const LOG_CATEGORY = map([
  ['high_flow', 'High flow', 'warn'],
  ['possible_leak', 'Possible leak', 'crit'],
  ['sensor_event', 'Sensor event', 'aqua'],
  ['connectivity', 'Connectivity', 'info'],
  ['valve_operation', 'Valve operation', 'info'],
  ['system_update', 'System update', 'neutral'],
  ['admin_action', 'Admin action', 'neutral'],
]);

export const LOG_STATUS = map([
  ['info', 'Info', 'info'],
  ['success', 'Success', 'ok'],
  ['warning', 'Warning', 'warn'],
  ['error', 'Error', 'crit'],
  ['critical', 'Critical', 'crit'],
  ['pending', 'Pending', 'warn'],
]);

export const VALVE = map([
  ['open', 'Open', 'ok'],
  ['closed', 'Closed', 'crit'],
  ['unknown', 'Unknown', 'neutral'],
]);

export const VALVE_COMMAND = map([
  ['pending', 'Pending', 'warn'],
  ['acknowledged', 'Acknowledged', 'ok'],
  ['failed', 'Failed', 'crit'],
  ['cancelled', 'Cancelled', 'neutral'],
]);

export const INTERRUPTION_STATUS = map([
  ['scheduled', 'Scheduled', 'info'],
  ['ongoing', 'Ongoing', 'crit'],
  ['completed', 'Completed', 'ok'],
  ['cancelled', 'Cancelled', 'neutral'],
]);

export const INTERRUPTION_TYPE = map([
  ['planned', 'Planned maintenance', 'info'],
  ['emergency', 'Emergency', 'crit'],
]);

export const RATE_STATUS = map([
  ['draft', 'Draft', 'neutral'],
  ['scheduled', 'Scheduled', 'info'],
  ['active', 'Active', 'ok'],
  ['superseded', 'Superseded', 'neutral'],
]);

export const CUSTOMER_CLASS = map([
  ['residential', 'Residential', 'info'],
  ['commercial', 'Commercial', 'aqua'],
  ['government', 'Government', 'neutral'],
  ['industrial', 'Industrial', 'warn'],
]);

export const CODE_STATUS = map([
  ['active', 'Active', 'ok'],
  ['used', 'Used', 'info'],
  ['expired', 'Expired', 'warn'],
  ['revoked', 'Revoked', 'neutral'],
]);

export const REQUESTER = map([
  ['admin', 'Administrator', 'info'],
  ['homeowner', 'Homeowner', 'aqua'],
  ['automatic', 'Automatic shutoff', 'warn'],
]);

export const NOTIFICATION_KIND = map([
  ['possible_leak', 'Leak alert', 'crit'],
  ['high_flow', 'High flow', 'warn'],
  ['device_offline', 'Device offline', 'neutral'],
  ['usage_threshold', 'Daily limit', 'warn'],
  ['valve', 'Valve', 'info'],
  ['interruption', 'Interruption', 'warn'],
  ['feedback_response', 'Feedback reply', 'aqua'],
  ['system', 'System / MCWD', 'info'],
]);

export const USER_STATUS = map([
  ['active', 'Active', 'ok'],
  ['inactive', 'Inactive', 'neutral'],
]);

export const HOUSE_STATUS = map([
  ['monitored', 'Monitored', 'ok'],
  ['pending_installation', 'Pending installation', 'warn'],
  ['inactive', 'Inactive', 'neutral'],
]);

export const CALIBRATION = map([
  ['calibrated', 'Calibrated', 'ok'],
  ['due', 'Recalibration due', 'warn'],
  ['not_calibrated', 'Not calibrated', 'crit'],
]);

export const SENSOR_TYPE = map([
  ['flow', 'Water flow', 'info'],
  ['vibration', 'Vibration (piezo)', 'aqua'],
]);

export const THRESHOLD_PROFILE = map([
  ['custom', 'Custom profile', 'info'],
  ['default', 'System default', 'neutral'],
  ['none', 'Not configured', 'warn'],
]);

export const FIRMWARE_STATUS = map([
  ['pending', 'Waiting for device', 'warn'],
  ['downloading', 'Downloading', 'info'],
  ['installing', 'Installing', 'info'],
  ['installed', 'Installed', 'ok'],
  ['failed', 'Failed', 'crit'],
  ['cancelled', 'Cancelled', 'neutral'],
]);

export const SENSOR_STATUS = map([
  ['active', 'Active', 'ok'],
  ['inactive', 'Inactive', 'neutral'],
  ['faulty', 'Faulty', 'crit'],
]);

export const ENVIRONMENT = map([
  ['quiet', 'Quiet residential', 'ok'],
  ['moderate', 'Moderate activity', 'info'],
  ['high_traffic', 'Near busy road / highway', 'warn'],
]);

export const ANNOUNCEMENT_STATUS = map([
  ['draft', 'Draft', 'neutral'],
  ['scheduled', 'Scheduled', 'info'],
  ['published', 'Published', 'ok'],
  ['archived', 'Archived', 'neutral'],
]);

export const ANNOUNCEMENT_CATEGORY = map([
  ['service_advisory', 'Service advisory', 'info'],
  ['billing_notice', 'Billing notice', 'warn'],
  ['conservation_reminder', 'Water conservation', 'aqua'],
  ['customer_tip', 'Customer tip', 'neutral'],
]);

export const PRIORITY = map([
  ['low', 'Low', 'neutral'],
  ['normal', 'Normal', 'info'],
  ['high', 'High', 'warn'],
  ['urgent', 'Urgent', 'crit'],
]);

export const FEEDBACK_STATUS = map([
  ['new', 'New', 'info'],
  ['in_review', 'In review', 'warn'],
  ['resolved', 'Resolved', 'ok'],
  ['closed', 'Closed', 'neutral'],
]);

export const FEEDBACK_TYPE = map([
  ['suggestion', 'Suggestion', 'aqua'],
  ['complaint', 'Complaint', 'crit'],
  ['report', 'Report', 'warn'],
]);

export const ROLE = map([
  ['super_admin', 'Super admin', 'info'],
  ['admin', 'Administrator', 'info'],
  ['viewer', 'Viewer (read-only)', 'neutral'],
]);

export const options = (m) => Object.entries(m).map(([value, { label }]) => ({ value, label }));

export const lookup = (m, key) => m[key] ?? { label: key ? String(key).replaceAll('_', ' ') : '—', tone: 'neutral' };
