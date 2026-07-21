"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

type AuthState = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  configured: isFirebaseConfigured,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Start "loading" only when Firebase is actually configured (otherwise there
  // is nothing to wait for) — avoids a synchronous setState inside the effect.
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = async () => {
    if (!isFirebaseConfigured) {
      alert("Firebase isn't configured yet. Add your keys to .env.local — see .env.local.example.");
      return;
    }
    await signInWithPopup(auth, googleProvider);
  };

  const signOut = async () => {
    if (isFirebaseConfigured) await fbSignOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, configured: isFirebaseConfigured, signInWithGoogle, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
