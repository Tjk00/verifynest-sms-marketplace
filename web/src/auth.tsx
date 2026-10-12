import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface User {
  id: string;
  email: string;
  role: 'customer' | 'admin';
  status: 'active' | 'suspended';
}

export interface PublicSettings {
  operatingMode: 'test' | 'live';
  depositsEnabled: boolean;
  paymentProvider: string | null;
  supportEmail: string | null;
  supportEmailConfigured: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  settings: PublicSettings | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null, loading: true, settings: null,
  refresh: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [me, status] = await Promise.all([
        api.get<{ user: User | null }>('/api/auth/me'),
        api.get<{ settings: PublicSettings }>('/api/catalog/status'),
      ]);
      setUser(me.user);
      setSettings(status.settings);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } finally {
      setUser(null);
      void refresh();
    }
  }, [refresh]);

  return <AuthContext.Provider value={{ user, loading, settings, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
