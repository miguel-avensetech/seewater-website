'use client';

import { useEffect, useState } from 'react';

// Light / dark theme for the admin console. The choice is stored per browser;
// with no stored choice the console follows the operating system setting.
export const THEME_KEY = 'sw-theme';

// Runs in <head> before first paint (see app/layout.js) so there is no flash.
export const themeScript = `(function(){try{var k='${THEME_KEY}',m=matchMedia('(prefers-color-scheme: dark)'),d=document.documentElement;function a(){var t=localStorage.getItem(k);d.dataset.theme=t==='light'||t==='dark'?t:m.matches?'dark':'light'}a();m.addEventListener('change',a);window.addEventListener('storage',function(e){if(e.key===k)a()})}catch(e){}})();`;

function read() {
  if (typeof document === 'undefined') return { theme: 'light', explicit: false };
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {}
  return { theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', explicit: stored === 'light' || stored === 'dark' };
}

export function useTheme() {
  const [state, setState] = useState({ theme: 'light', explicit: false });

  useEffect(() => {
    setState(read());
    // Picks up system changes and changes made in other tabs (via the head script).
    const obs = new MutationObserver(() => setState(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const setTheme = (theme) => {
    try {
      if (theme) localStorage.setItem(THEME_KEY, theme);
      else localStorage.removeItem(THEME_KEY);
    } catch {}
    document.documentElement.dataset.theme = theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setState(read());
  };

  return { ...state, setTheme };
}
