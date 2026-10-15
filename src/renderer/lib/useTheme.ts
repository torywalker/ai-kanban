import { useEffect } from 'react';

export function useTheme(): void {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark);
    };
    apply(query.matches);
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
}
