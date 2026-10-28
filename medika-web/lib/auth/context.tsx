"use client";

/**
 * Auth context — login / register / logout / session restore.
 *
 * Session restore strategy: on mount we read the token from sessionStorage
 * (if any) and revalidate it against GET /api/profile. If the backend says
 * the token is invalid we clear it. This avoids trusting a stale cached
 * user object for authorization decisions.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import type { User } from "@/lib/api/types";
import { clearSession, readSession, writeSession } from "./session";

export interface AuthState {
  user: User | null;
  token: string | null;
  status: "restoring" | "authenticated" | "anonymous";
}

export interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<User>;
  register: (input: api.RegisterInput) => Promise<User>;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    status: "restoring",
  });
  const restoreController = useRef<AbortController | null>(null);

  // ── Session restore (runs once on mount) ──────────────────────────────────
  useEffect(() => {
    const stored = readSession();
    if (!stored?.token) {
      setState({ user: null, token: null, status: "anonymous" });
      return;
    }
    const controller = new AbortController();
    restoreController.current = controller;
    api
      .getProfile(stored.token, controller.signal)
      .then((user) => {
        writeSession(stored.token, user);
        setState({ user, token: stored.token, status: "authenticated" });
      })
      .catch((err) => {
        // Only an explicit 401/403 means the token is invalid. A network
        // failure (offline, backend briefly down) must NOT log the user out —
        // keep the session and let data screens surface their own errors.
        if (err instanceof ApiError && (err.code === "unauthorized" || err.code === "forbidden")) {
          clearSession();
          setState({ user: null, token: null, status: "anonymous" });
        } else if (err instanceof ApiError && err.code === "aborted") {
          // Component unmounted during restore — leave state untouched.
        } else {
          // Network/timeout/server error: trust the stored session so a
          // refresh while offline keeps the user signed in.
          const cachedUser = (stored.user ?? null) as User | null;
          if (cachedUser && cachedUser.id) {
            setState({ user: cachedUser, token: stored.token, status: "authenticated" });
          } else {
            clearSession();
            setState({ user: null, token: null, status: "anonymous" });
          }
        }
      });
    return () => controller.abort();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    writeSession(res.token, res.user);
    setState({ user: res.user, token: res.token, status: "authenticated" });
    return res.user;
  }, []);

  const register = useCallback(async (input: api.RegisterInput) => {
    const res = await api.register(input);
    writeSession(res.token, res.user);
    setState({ user: res.user, token: res.token, status: "authenticated" });
    return res.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setState({ user: null, token: null, status: "anonymous" });
  }, []);

  const setUser = useCallback((user: User) => {
    setState((prev) => {
      if (prev.token) writeSession(prev.token, user);
      return { ...prev, user };
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout, setUser }),
    [state, login, register, logout, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
