import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

export type Infant = {
  id: string;
  name: string;
  date_of_birth: string | null;
  gender: 'male' | 'female' | 'other' | null;
  current_weight_kg: number | null;
  current_height_cm: number | null;
  last_measurement_date: string | null;
};

type AuthError = { message: string } | null;

type AuthContextType = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError }>;
  signUpWithEmail: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: AuthError; needsEmailConfirmation?: boolean }>;
  signInWithGoogle: () => Promise<{ error: AuthError }>;
  resendConfirmation: (email: string) => Promise<{ error: AuthError }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  isLoading: true,
  signInWithEmail: async () => ({ error: { message: 'Not initialized' } }),
  signUpWithEmail: async () => ({ error: { message: 'Not initialized' } }),
  signInWithGoogle: async () => ({ error: { message: 'Not initialized' } }),
  resendConfirmation: async () => ({ error: { message: 'Not initialized' } }),
  signOut: async () => {},
});

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, bio')
    .eq('id', userId)
    .single();
  if (error) {
    console.warn('[auth] fetchProfile error:', error.message);
    return null;
  }
  return data as Profile;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).then(setProfile);
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).then(setProfile);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? { message: error.message } : null };
  };

  const signUpWithEmail = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    const needsEmailConfirmation = !error && !data.session && !!data.user;
    return {
      error: error ? { message: error.message } : null,
      needsEmailConfirmation,
    };
  };

  const signInWithGoogle = async () => {
    return { error: { message: 'Google sign-in not yet configured. Use email/password.' } };
  };

  const resendConfirmation = async (email: string) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    return { error: error ? { message: error.message } : null };
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('[auth] signOut error:', error);
        throw error;
      }
    } catch (err: any) {
      console.error('[auth] signOut exception:', err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isLoading,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        resendConfirmation,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
