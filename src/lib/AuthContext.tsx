import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { store, UserProfile } from './store';

export interface ProfileData {
  id: string;
  fullName: string;
  displayName: string;
  email: string;
  matricNumber: string;
  faculty: string;
  department: string;
  level: string;
  role: 'student' | 'admin';
  bio?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  joinedDate?: string;
}

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: ProfileData | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isStudent: boolean;
  isProfileComplete: boolean;
  role: 'student' | 'admin' | null;
  sendOtp: (email: string, shouldCreateUser?: boolean) => Promise<{ error: Error | null; message?: string }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: Error | null; isNewUser?: boolean; role?: 'student' | 'admin' }>;
  completeProfile: (data: {
    fullName: string;
    matricNumber: string;
    faculty: string;
    department: string;
    level: string;
    bio?: string;
  }) => Promise<{ error: Error | null }>;
  updateProfile: (updates: Partial<ProfileData>) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<ProfileData | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Sync profile to store currentUser whenever profile changes
  const syncToStore = (prof: ProfileData | null, authedUser: User | null) => {
    if (prof && authedUser) {
      const storeUser: UserProfile = {
        id: prof.id || authedUser.id,
        fullName: prof.fullName || authedUser.user_metadata?.full_name || '',
        displayName: prof.displayName || prof.fullName?.split(' ')[0] || '',
        email: prof.email || authedUser.email || '',
        matricNumber: prof.matricNumber || '',
        faculty: prof.faculty || '',
        department: prof.department || '',
        level: prof.level || '',
        role: prof.role === 'admin' ? 'ADMIN' : 'STUDENT',
        bio: prof.bio || '',
        avatarUrl: prof.avatarUrl || '',
        isVerified: true,
        verificationStatus: 'VERIFIED',
        joinedDate: prof.joinedDate || ''
      };

      if (prof.role === 'admin') {
        store.setAuthenticatedAdmin(storeUser);
      } else {
        store.setAuthenticatedStudent(storeUser);
      }
    } else {
      store.clearAuthentication();
    }
  };

  // Fetch user profile from Supabase profiles table
  const fetchProfile = async (userId: string, userEmail?: string): Promise<ProfileData | null> => {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('Profile fetch warning:', error.message);
      }

      if (data) {
        const loadedProfile: ProfileData = {
          id: data.id,
          fullName: data.full_name,
          displayName: data.full_name?.split(' ')[0] || data.full_name,
          email: data.email || userEmail || '',
          matricNumber: data.matric_number || '',
          faculty: data.faculty || '',
          department: data.department || '',
          level: data.level || '',
          role: (data.role as 'student' | 'admin') || 'student',
          bio: data.bio || '',
          avatarUrl: data.avatar_url || '',
          isVerified: true,
          joinedDate: data.created_at ? new Date(data.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '2026'
        };
        setProfile(loadedProfile);
        return loadedProfile;
      }
    } catch (err) {
      console.error('Error fetching user profile:', err);
    }
    return null;
  };

  // Initial session restoration & onAuthStateChange listener
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      if (!supabase) {
        setIsLoading(false);
        return;
      }

      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (mounted) {
          setSession(initialSession);
          setUser(initialSession?.user || null);

          if (initialSession?.user) {
            const prof = await fetchProfile(initialSession.user.id, initialSession.user.email);
            if (mounted) {
              syncToStore(prof, initialSession.user);
            }
          }
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initAuth();

    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, currentSession: Session | null) => {
        if (!mounted) return;

        setSession(currentSession);
        setUser(currentSession?.user || null);

        if (currentSession?.user) {
          const prof = await fetchProfile(currentSession.user.id, currentSession.user.email);
          syncToStore(prof, currentSession.user);
        } else {
          setProfile(null);
          syncToStore(null, null);
        }
        setIsLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Send Email OTP
  const sendOtp = async (email: string, shouldCreateUser: boolean = true) => {
    if (!supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { error: new Error('Please enter a valid university or personal email address.') };
    }

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser,
          emailRedirectTo: window.location.origin
        }
      });

      if (error) {
        // Humanize common Supabase errors
        if (error.message.toLowerCase().includes('rate limit')) {
          return { error: new Error('Too many OTP requests. Please wait a few moments before trying again.') };
        }
        if (error.message.toLowerCase().includes('signups not allowed') || error.message.toLowerCase().includes('user not found')) {
          return { error: new Error('No account found with this email. Please register first.') };
        }
        return { error: new Error(error.message) };
      }

      return { error: null, message: `A 6-digit verification code has been sent to ${cleanEmail}.` };
    } catch (err: any) {
      return { error: new Error(err.message || 'Unable to send OTP. Please check your network connection.') };
    }
  };

  // Verify Email OTP
  const verifyOtp = async (
    email: string,
    token: string
  ): Promise<{ error: Error | null; isNewUser?: boolean; role?: 'student' | 'admin' }> => {
    if (!supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanToken = token.trim();

    if (cleanToken.length !== 6) {
      return { error: new Error('Please enter the complete 6-digit verification code.') };
    }

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: 'email'
      });

      if (error) {
        if (error.message.toLowerCase().includes('expired')) {
          return { error: new Error('This verification code has expired. Please request a new code.') };
        }
        if (error.message.toLowerCase().includes('invalid') || error.message.toLowerCase().includes('token')) {
          return { error: new Error('Invalid verification code. Please check your email and try again.') };
        }
        return { error: new Error(error.message) };
      }

      if (data.user) {
        setUser(data.user);
        setSession(data.session);

        const loadedProfile = await fetchProfile(data.user.id, data.user.email);
        if (loadedProfile) {
          syncToStore(loadedProfile, data.user);
          // A brand-new signup gets an auto-created bare profile from the
          // database trigger. Treat it as "new user" until academic details
          // (matric number / faculty / department) have been completed.
          const needsCompletion =
            !loadedProfile.matricNumber ||
            !loadedProfile.faculty ||
            !loadedProfile.department;
          return {
            error: null,
            isNewUser: needsCompletion,
            role: (loadedProfile.role === 'admin' ? 'admin' : 'student') as 'student' | 'admin'
          };
        } else {
          // Profile needs to be completed
          return { error: null, isNewUser: true, role: 'student' as const };
        }
      }

      return { error: new Error('Verification completed but user session was not found.') };
    } catch (err: any) {
      return { error: new Error(err.message || 'Verification failed. Please check your connection and try again.') };
    }
  };


  // Complete Profile for New Users
  const completeProfile = async (data: {
    fullName: string;
    matricNumber: string;
    faculty: string;
    department: string;
    level: string;
    bio?: string;
  }) => {
    if (!supabase || !user) {
      return { error: new Error('You must be authenticated to complete your profile.') };
    }

    try {
      const newProfile: ProfileData = {
        id: user.id,
        fullName: data.fullName.trim(),
        displayName: data.fullName.trim().split(' ')[0],
        email: user.email || '',
        matricNumber: data.matricNumber.trim().toUpperCase(),
        faculty: data.faculty,
        department: data.department,
        level: data.level,
        role: 'student',
        bio: data.bio || '',
        isVerified: true,
        joinedDate: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      };

      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        full_name: newProfile.fullName,
        email: user.email,
        matric_number: newProfile.matricNumber,
        faculty: newProfile.faculty,
        department: newProfile.department,
        level: newProfile.level,
        role: 'student',
        updated_at: new Date().toISOString()
      });

      if (error) {
        return { error: new Error(error.message) };
      }

      setProfile(newProfile);
      syncToStore(newProfile, user);
      return { error: null };
    } catch (err: any) {
      return { error: new Error(err.message || 'Failed to save student profile.') };
    }
  };

  // Update Profile
  const updateProfile = async (updates: Partial<ProfileData>) => {
    if (!supabase || !user || !profile) {
      return { error: new Error('No authenticated profile found.') };
    }

    try {
      const updatedProfile: ProfileData = {
        ...profile,
        ...updates,
        // Role cannot be changed by student
        role: profile.role
      };

      const dbUpdates: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.fullName !== undefined) dbUpdates.full_name = updates.fullName;
      if (updates.matricNumber !== undefined) dbUpdates.matric_number = updates.matricNumber;
      if (updates.faculty !== undefined) dbUpdates.faculty = updates.faculty;
      if (updates.department !== undefined) dbUpdates.department = updates.department;
      if (updates.level !== undefined) dbUpdates.level = updates.level;
      if (updates.bio !== undefined) dbUpdates.bio = updates.bio;

      const { error } = await supabase
        .from('profiles')
        .update(dbUpdates)
        .eq('id', user.id);

      if (error) {
        return { error: new Error(error.message) };
      }

      setProfile(updatedProfile);
      syncToStore(updatedProfile, user);
      return { error: null };
    } catch (err: any) {
      return { error: new Error(err.message || 'Failed to update profile.') };
    }
  };

  // Sign Out
  const signOut = async () => {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('Sign out error:', err);
      }
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    syncToStore(null, null);
  };

  // Refresh Profile
  const refreshProfile = async () => {
    if (user) {
      const p = await fetchProfile(user.id, user.email);
      if (p) {
        syncToStore(p, user);
      }
      return p;
    }
    return null;
  };

  const role = profile?.role || (sessionStorage.getItem('fuw-admin') === 'true' ? 'admin' : user ? 'student' : null);
  const isAdmin = role === 'admin';
  const isStudent = role === 'student';
  const isAuthenticated = !!user;
  // A profile is complete once academic identity details have been saved
  const isProfileComplete = !!(profile && profile.matricNumber && profile.faculty && profile.department);

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      isLoading,
      isAuthenticated,
      isAdmin,
      isStudent,
      isProfileComplete,
      role,
      sendOtp,
      verifyOtp,
      completeProfile,
      updateProfile,
      signOut,
      refreshProfile
    }),
    [user, session, profile, isLoading, isAuthenticated, isAdmin, isStudent, isProfileComplete, role]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
