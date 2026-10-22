"use client";

/**
 * Provides a single MedikaSocket instance for the whole authenticated app,
 * connected as soon as the user session is established.
 *
 * The MedikaSocket constructor is server-safe (no browser APIs); all I/O
 * happens in effects, so the context value is always provided — including
 * during static prerendering — and useSocket never throws at build time.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MedikaSocket } from "@/lib/ws/socket";
import { useAuth } from "@/lib/auth/context";

type Status = "connecting" | "open" | "closed";

interface SocketContextValue {
  socket: MedikaSocket;
  status: Status;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, status: authStatus } = useAuth();
  const socketRef = useRef<MedikaSocket | null>(null);
  const [status, setStatus] = useState<Status>("closed");

  if (!socketRef.current) {
    socketRef.current = new MedikaSocket();
  }

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const off = socket.onStatus(setStatus);
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (authStatus === "authenticated" && token) {
      socket.connect(token);
    } else if (authStatus === "anonymous") {
      socket.disconnect();
    }
  }, [token, authStatus]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const value = useMemo<SocketContextValue>(
    () => ({ socket: socketRef.current as MedikaSocket, status }),
    [status],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within <SocketProvider>");
  return ctx;
}
