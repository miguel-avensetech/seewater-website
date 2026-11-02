import {
  Activity,
  BarChart3,
  Bell,
  Cpu,
  Gauge,
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  ScrollText,
  Settings,
  Users,
  Home,
  KeyRound,
  BellRing,
  HardDrive,
  SlidersHorizontal,
} from 'lucide-react';

// Sidebar structure: the five branches of the admin Functional Decomposition
// Diagram (manuscript Fig. 7.1), plus the dashboard. `also` lists extra routes
// that belong to an item (e.g. the Announcement Management tabs).
export const NAV = [
  { group: 'Overview', items: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    group: 'IoT Device Management',
    items: [
      { href: '/devices', label: 'Register Device', icon: Cpu },
      { href: '/activation-codes', label: 'Activation Codes', icon: KeyRound },
      { href: '/monitoring', label: 'Monitor Status', icon: Activity },
      { href: '/alerts', label: 'System Alerts', icon: Bell, badge: 'alerts' },
      { href: '/logs/devices', label: 'Device Logs', icon: HardDrive },
    ],
  },
  {
    group: 'User Management',
    items: [
      { href: '/users', label: 'Registered Users', icon: Users },
      { href: '/households', label: 'Households', icon: Home },
      { href: '/usage', label: 'User Water Usage', icon: BarChart3 },
      { href: '/feedback', label: 'User Feedback', icon: MessageSquareText, badge: 'feedback' },
    ],
  },
  {
    group: 'Announcement Management',
    items: [
      { href: '/announcements', label: 'Announcements', icon: Megaphone, also: ['/rates', '/interruptions'] },
      { href: '/notifications', label: 'Sent Notifications', icon: BellRing },
    ],
  },
  {
    group: 'Sensor Calibration Management',
    items: [
      { href: '/calibration', label: 'Sensor Calibration', icon: SlidersHorizontal, also: ['/vibration'] },
    ],
  },
  {
    group: 'Account Management',
    items: [
      { href: '/settings', label: 'System Preferences', icon: Settings },
      { href: '/logs/system', label: 'System Logs', icon: ScrollText },
    ],
  },
];

const matches = (pathname, href) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

export const isActive = (pathname, item) => {
  const { href, also = [] } = typeof item === 'string' ? { href: item } : item;
  return matches(pathname, href) || also.some((h) => matches(pathname, h));
};

export const findNav = (pathname) =>
  NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })))
    .filter((i) => isActive(pathname, i))
    .sort((a, b) => b.href.length - a.href.length)[0];
