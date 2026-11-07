import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { WebsiteApi } from './api';
import type { RuntimeConfig, User } from './contracts';
import { usePreferences } from './preferences';
type AuthContextValue = {
  api: WebsiteApi;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  const token = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const { locale } = usePreferences();
  const language = useRef(locale);
  language.current = locale;
  const clear = useCallback(() => {
    token.current = null;
    setUser(null);
  }, []);
  const api = useMemo(
    () =>
      new WebsiteApi(
        config,
        fetch,
        () => token.current,
        clear,
        () => language.current,
      ),
    [config, clear],
  );
  const value = useMemo<AuthContextValue>(
    () => ({
      api,
      user,
      login: async (email, password) => {
        const result = await api.login(email, password);
        token.current = result.token;
        setUser(result.user);
      },
      register: async (email, password, name) => {
        const result = await api.register(email, password, name);
        token.current = result.token;
        setUser(result.user);
      },
      logout: async () => {
        try {
          await api.logout();
        } finally {
          clear();
        }
      },
    }),
    [api, user, clear],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is missing.');
  return context;
}
