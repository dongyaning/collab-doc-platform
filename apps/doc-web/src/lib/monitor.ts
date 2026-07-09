import { init, setUser } from '@wiseflow/monitor-sdk';
import { useAuthStore } from '../stores/auth.store';

export function setupMonitor() {
  init({
    app: 'doc-web',
    endpoint: '/api/monitor/events',
    ignoreUrls: ['/api/monitor/events'],
    release: import.meta.env.VITE_APP_VERSION,
  });
  setUser(useAuthStore.getState().user?.id);
  useAuthStore.subscribe((state) => {
    setUser(state.user?.id);
  });
}
