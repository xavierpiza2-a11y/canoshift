import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'canoshift_theme';
const THEME_EVENT_NAME = 'canoshift_theme_changed';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  
  const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }

  return 'dark';
}

export function applyThemeToDOM(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');

  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
    document.body?.classList.add('dark');
    document.body?.classList.remove('light');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', '#020617');
    }
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    document.body?.classList.remove('dark');
    document.body?.classList.add('light');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', '#ffffff');
    }
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    applyThemeToDOM(theme);

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<ThemeMode>;
      if (customEvent.detail && (customEvent.detail === 'light' || customEvent.detail === 'dark')) {
        setTheme(customEvent.detail);
        applyThemeToDOM(customEvent.detail);
      }
    };

    window.addEventListener(THEME_EVENT_NAME, handleThemeChange);
    return () => window.removeEventListener(THEME_EVENT_NAME, handleThemeChange);
  }, [theme]);

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyThemeToDOM(next);
    setTheme(next);
    window.dispatchEvent(new CustomEvent(THEME_EVENT_NAME, { detail: next }));
  };

  const setExplicitTheme = (mode: ThemeMode) => {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    applyThemeToDOM(mode);
    setTheme(mode);
    window.dispatchEvent(new CustomEvent(THEME_EVENT_NAME, { detail: mode }));
  };

  return {
    theme,
    isDark: theme === 'dark',
    toggleTheme,
    setTheme: setExplicitTheme,
  };
}
