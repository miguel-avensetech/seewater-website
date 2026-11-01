import { Plus_Jakarta_Sans } from 'next/font/google';
import { ToastProvider } from '@/components/ui/Toast';
import { themeScript } from '@/lib/theme';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata = {
  title: { default: 'SeeWater Admin', template: '%s · SeeWater Admin' },
  description: 'IoT-powered residential water usage monitoring and leak detection — administration console.',
  icons: { icon: '/icon.svg' },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0a1f3d' },
    { media: '(prefers-color-scheme: dark)', color: '#06142b' },
  ],
};

export default function RootLayout({ children }) {
  return (
    // data-theme is set by the inline script before React hydrates.
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
