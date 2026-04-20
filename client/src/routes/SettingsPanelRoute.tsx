import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Chat, Speech, Data } from '~/components/Nav/SettingsTabs';
import { useEvolsAutoAuth } from '~/hooks/useEvolsAutoAuth';
import { useEvolsThemeSync } from '~/hooks/useEvolsThemeSync';
import { useAuthContext } from '~/hooks/AuthContext';

const PANELS: Record<string, React.ComponentType> = {
  chat: Chat,
  speech: Speech,
  data: Data,
};

export default function SettingsPanelRoute() {
  useEvolsAutoAuth();
  useEvolsThemeSync();

  const { tab } = useParams<{ tab: string }>();
  const { isAuthenticated } = useAuthContext();

  useEffect(() => {
    document.documentElement.classList.add('evols-panel');
    return () => document.documentElement.classList.remove('evols-panel');
  }, []);

  const Panel = PANELS[tab ?? ''];

  if (!isAuthenticated || !Panel) {
    return null;
  }

  return (
    <div className="p-6">
      <Panel />
    </div>
  );
}
