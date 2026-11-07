import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
const SESSION_KEY = 'cuemesh.session.v1';
type StoredSession = { token: string; user: User };
function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredSession>) : null;
    return parsed?.token && parsed.user ? (parsed as StoredSession) : null;
  } catch {
    return null;
  }
}
function writeSession(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // 瀏覽器封鎖儲存空間時退回只保留在記憶體，關閉分頁後需重新登入
  }
}
export function AuthProvider({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  const [stored] = useState(readSession);
  const token = useRef<string | null>(stored?.token ?? null);
  const [user, setUser] = useState<User | null>(stored?.user ?? null);
  const { locale } = usePreferences();
  const language = useRef(locale);
  language.current = locale;
  const clear = useCallback(() => {
    token.current = null;
    writeSession(null);
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
  // 重新開啟頁面時向伺服器確認登入仍有效；401 會由 API 層清除登入，網路暫時失敗則保留
  useEffect(() => {
    if (!stored) return;
    const controller = new AbortController();
    void api
      .me(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setUser(response.user);
        if (token.current) writeSession({ token: token.current, user: response.user });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [api, stored]);
  const value = useMemo<AuthContextValue>(
    () => ({
      api,
      user,
      login: async (email, password) => {
        const result = await api.login(email, password);
        token.current = result.token;
        writeSession(result);
        setUser(result.user);
      },
      register: async (email, password, name) => {
        const result = await api.register(email, password, name);
        token.current = result.token;
        writeSession(result);
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
