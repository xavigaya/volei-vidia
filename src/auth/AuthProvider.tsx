import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { kvClear, kvGet, kvSet } from '../offline/store';
import { flush, pendingCount, resetOutbox } from '../offline/outbox';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** Intenta enviar els canvis pendents i retorna quants en queden */
  pendingBeforeSignOut: () => Promise<number>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Usuari a qui pertanyen les dades desades al dispositiu
const OWNER_KEY = 'owner';

async function wipeLocalData() {
  await kvClear();
  resetOutbox();
}

// Si les dades desades són d'un altre usuari (p. ex. la sessió va caducar i
// ara entra una altra persona al mateix dispositiu), s'esborren.
async function ensureOwner(userId: string) {
  const owner = await kvGet<string>(OWNER_KEY);
  if (owner && owner !== userId) await wipeLocalData();
  if (owner !== userId) await kvSet(OWNER_KEY, userId);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) await ensureOwner(data.session.user.id);
      if (!cancelled) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_IN' && newSession) {
        void ensureOwner(newSession.user.id).then(() => {
          if (!cancelled) setSession(newSession);
        });
        return;
      }
      setSession(newSession);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    loading,
    pendingBeforeSignOut: async () => {
      await flush();
      return pendingCount();
    },
    signOut: async () => {
      await supabase.auth.signOut();
      await wipeLocalData();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
