import { useEffect } from 'react';
import { useSetRecoilState } from 'recoil';
import { SettingsTabValues } from 'librechat-data-provider';
import { useTheme } from '@librechat/client';
import store from '~/store';

const VALID_TABS = new Set<string>(Object.values(SettingsTabValues));

/**
 * Syncs LibreChat state with the Evols parent page via postMessage.
 *
 * Handled message types:
 *   { type: 'evols:theme', theme: 'light' | 'dark' }
 *   { type: 'evols:openSettings', tab: SettingsTabValues }
 */
export function useEvolsThemeSync() {
  const { setTheme } = useTheme();
  const setEvolsSettings = useSetRecoilState(store.evolsSettingsDialog);

  useEffect(() => {
    localStorage.removeItem('theme-colors');
    localStorage.removeItem('theme-name');
    const root = document.documentElement;
    Array.from(root.style).forEach((prop) => root.style.removeProperty(prop));
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { type } = event.data ?? {};

      if (type === 'evols:theme') {
        const incoming = event.data.theme as string;
        if (incoming === 'light' || incoming === 'dark') {
          setTheme(incoming);
        }
        return;
      }

      if (type === 'evols:openSettings') {
        const tab = event.data.tab as string;
        const resolvedTab = VALID_TABS.has(tab)
          ? (tab as SettingsTabValues)
          : SettingsTabValues.CHAT;
        setEvolsSettings({ open: true, tab: resolvedTab });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setTheme, setEvolsSettings]);
}
