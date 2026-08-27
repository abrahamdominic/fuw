import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { store, UserProfile } from './store';
import { AppRole, can } from './rbac';
import { createSession, touchSession, deleteCurrentSession } from './sessions';

export interface ProfileData {
  id: string;
  fullName: string;
  displayName: string;
  email: string;
  matricNumber: string;
  faculty: string;
  department: string;
  level: string;
  role: AppRole;
  permissions: string[];
  isActive: boolean;
  bio?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  joinedDate?: string;
  matricChangesUsed?: number;
  facultyChangesUsed?: number;
  departmentChangesUsed?: number;
  facultyLocked?: boolean;
  departmentLocked?: boolean;
}

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: ProfileData | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isStudent: boolean;
  isProfileComplete: boolean;
  role: AppRole | null;
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  signInWithUsername: (
    username: string,
    password: string
  ) => Promise<{ error: Error | null; role?: AppRole }>;
  signUpWithPassword: (input: {
    fullName: string;
    username: string;
    email: string;
    password: string;
  }) => Promise<{ error: Error | null; needsEmailConfirmation?: boolean }>;
  completeProfile: (data: {
    fullName: string;
    matricNumber: string;
    faculty: string;
    department: string;
    level: string;
    bio?: string;
  }) => Promise<{ error: Error | null }>;
  updateProfile: (updates: Partial<ProfileData>) => Promise<{ error: Error | null }>;
  changePassword: (
    newPassword: string
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<ProfileData | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Canonical username rules shared by the UI and the auth layer. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,20}$/;

export const normalizeUsername = (username: string): string => username.trim().toLowerCase();

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
        role: prof.role === 'admin' || prof.role === 'super_admin' ? 'ADMIN' : 'STUDENT',
        bio: prof.bio || '',
        avatarUrl: prof.avatarUrl || '',
        isVerified: true,
        verificationStatus: 'VERIFIED',
        joinedDate: prof.joinedDate || ''
      };

      if (prof.role === 'admin' || prof.role === 'super_admin') {
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
          role: (data.role as AppRole) || 'student',
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
          isActive: data.is_active !== false,
          bio: data.bio || '',
          avatarUrl: data.avatar_url || '',
          isVerified: true,
          joinedDate: data.created_at ? new Date(data.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '2026',
          matricChangesUsed: data.matric_changes_used ?? 0,
          facultyChangesUsed: data.faculty_changes_used ?? 0,
          departmentChangesUsed: data.department_changes_used ?? 0,
          facultyLocked: !!data.faculty,
          departmentLocked: !!data.department
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
              // Deactivated accounts are signed out immediately.
              if (prof && !prof.isActive) {
                await supabase.auth.signOut();
                setProfile(null);
                syncToStore(null, null);
              } else {
                syncToStore(prof, initialSession.user);
              }
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
    const authClient = supabase;

    const { data: { subscription } } = authClient.auth.onAuthStateChange(
      async (event: AuthChangeEvent, currentSession: Session | null) => {
        if (!mounted) return;

        setSession(currentSession);
        setUser(currentSession?.user || null);

        if (currentSession?.user) {
          const prof = await fetchProfile(currentSession.user.id, currentSession.user.email);
          if (prof && !prof.isActive && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
            await authClient.auth.signOut();
            setProfile(null);
            syncToStore(null, null);
          } else {
            syncToStore(prof, currentSession.user);
          }
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

  // ── Session Lifecycle ──────────────────────────────────────
  // Create session record on mount if already authenticated, then heartbeat.
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) {
      // Clean up heartbeat when user signs out
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    // Create session record on login
    createSession().catch(() => {});

    // Heartbeat every 2 minutes to update last_active
    heartbeatRef.current = setInterval(() => {
      touchSession().catch(() => {});
    }, 2 * 60 * 1000);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [user]);

  // Sign in with username + password.
  // The username is resolved to its auth email through the SECURITY DEFINER
  // RPC `lookup_login_email`, then authentication is delegated entirely to
  // Supabase Auth (`signInWithPassword`). Passwords are never stored or
  // hashed client-side.
  const signInWithUsername = async (
    username: string,
    password: string
  ): Promise<{ error: Error | null; role?: AppRole }> => {
    if (!supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }

    const uname = normalizeUsername(username);
    if (!uname || !password) {
      return { error: new Error('Please enter your username and password.') };
    }

    try {
      const { data: loginEmail, error: lookupError } = await supabase.rpc(
        'lookup_login_email',
        { p_username: uname }
      );
      if (lookupError) {
        return { error: new Error('Unable to verify your account right now. Please try again.') };
      }
      const email = typeof loginEmail === 'string' ? loginEmail.trim() : '';
      if (!email) {
        return { error: new Error('No account found with this username.') };
      }

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes('invalid login credentials')) {
          return { error: new Error('Incorrect password. Please try again.') };
        }
        if (msg.includes('not confirmed')) {
          return {
            error: new Error(
              'Your email address has not been confirmed yet. Please check your inbox for the confirmation link.'
            )
          };
        }
        if (msg.includes('rate limit')) {
          return { error: new Error('Too many sign-in attempts. Please wait a few moments and try again.') };
        }
        return { error: new Error(authError.message) };
      }

      if (data.user) {
        setUser(data.user);
        setSession(data.session);

        const prof = await fetchProfile(data.user.id, data.user.email);
        if (!prof) {
          // Authorization could not be verified — never silently fall back to
          // the student role. End the session and surface a clear error.
          await supabase.auth.signOut();
          setProfile(null);
          syncToStore(null, null);
          return {
            error: new Error(
              'We could not verify your account permissions. Please try again in a moment or contact the library administrator.'
            )
          };
        }
        if (!prof.isActive) {
          await supabase.auth.signOut();
          setProfile(null);
          syncToStore(null, null);
          return { error: new Error('This account has been deactivated. Contact the library administrator.') };
        }
        syncToStore(prof, data.user);
        return { error: null, role: prof.role };
      }

      return { error: new Error('Sign-in failed. Please try again.') };
    } catch (err: any) {
      return { error: new Error(err.message || 'Sign-in failed. Please check your connection and try again.') };
    }
  };

  // Register a new account with Supabase Auth password signup. The chosen
  // username travels inside the signup metadata so the database trigger
  // persists it on the profile row; duplicate usernames/emails are rejected
  // via the `register_identity_check` RPC before any account is created.
  const signUpWithPassword = async (input: {
    fullName: string;
    username: string;
    email: string;
    password: string;
  }): Promise<{ error: Error | null; needsEmailConfirmation?: boolean }> => {
    if (!supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }

    const fullName = input.fullName.trim();
    const uname = normalizeUsername(input.username);
    const cleanEmail = input.email.trim().toLowerCase();

    if (!fullName) {
      return { error: new Error('Please enter your full name.') };
    }
    if (!USERNAME_PATTERN.test(uname)) {
      return {
        error: new Error(
          'Username must be 3–20 characters using only lowercase letters, numbers, dots, dashes, or underscores.'
        )
      };
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { error: new Error('Please enter a valid email address.') };
    }

    try {
      // Duplicate username / email pre-check (friendly errors before signup).
      const { data: check, error: checkError } = await supabase.rpc('register_identity_check', {
        p_username: uname,
        p_email: cleanEmail
      });
      if (!checkError && check && typeof check === 'object') {
        if ((check as any).username_taken) {
          return { error: new Error('That username is already taken. Please choose another one.') };
        }
        if ((check as any).email_taken) {
          return { error: new Error('An account with this email already exists. Please log in instead.') };
        }
      }

      const displayName = fullName.split(/\s+/)[0] || uname;
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: input.password,
        options: {
          data: { full_name: fullName, display_name: displayName, username: uname }
        }
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('already registered') || msg.includes('already exists')) {
          return { error: new Error('An account with this email already exists. Please log in instead.') };
        }
        if (msg.includes('password')) {
          return { error: new Error(error.message.replace(/^Password /, '')) };
        }
        if (msg.includes('rate limit') || msg.includes('signup requires')) {
          return { error: new Error(error.message) };
        }
        return { error: new Error(error.message) };
      }

      if (data.user) {
        setUser(data.user);
        setSession(data.session ?? null);
        // The handle_new_user trigger creates the bare profile row (with the
        // username). Pull it into context so ProtectedRoute passes instantly.
        const prof = await fetchProfile(data.user.id, data.user.email);
        if (prof) syncToStore(prof, data.user);
      }

      // When "Confirm email" is enabled server-side no session is returned.
      return { error: null, needsEmailConfirmation: !data.session };
    } catch (err: any) {
      return { error: new Error(err.message || 'Registration failed. Please check your connection and try again.') };
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
        role: profile?.role ?? 'student',
        permissions: profile?.permissions ?? [],
        isActive: true,
        bio: data.bio || '',
        isVerified: true,
        joinedDate: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      };

      // NOTE: role is intentionally NOT written here. Invited administrators
      // receive their role from the database trigger when their account is
      // created; overwriting it would silently demote them to students.
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        full_name: newProfile.fullName,
        email: user.email,
        matric_number: newProfile.matricNumber,
        faculty: newProfile.faculty,
        department: newProfile.department,
        level: newProfile.level,
        updated_at: new Date().toISOString()
      });

      if (error) {
        return { error: new Error(error.message) };
      }

      // Re-fetch so trigger-assigned fields (e.g. an admin invite role applied
      // on signup) are reflected immediately instead of using stale client state.
      const fresh = await fetchProfile(user.id, user.email);
      const finalProfile = fresh ?? newProfile;
      setProfile(finalProfile);
      syncToStore(finalProfile, user);
      return { error: null };
    } catch (err: any) {
      return { error: new Error(err.message || 'Failed to save student profile.') };
    }
  };

  // Update Profile
  const updateProfile = async (updates: Partial<ProfileData>) => {
    if (!supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }
    if (!user) {
      return { error: new Error('You must be signed in to update your profile.') };
    }

    try {
      // The cached profile can be null right after a restored session or if
      // the initial fetch failed. Re-fetch once so saving never fails merely
      // because the client-side copy was unavailable.
      let currentProfile = profile;
      if (!currentProfile) {
        currentProfile = await fetchProfile(user.id, user.email);
      }

      const updatedProfile: ProfileData = {
        ...(currentProfile ?? {
          id: user.id,
          fullName: '',
          displayName: '',
          email: user.email || '',
          matricNumber: '',
          faculty: '',
          department: '',
          level: '',
          role: 'student',
          permissions: [],
          isActive: true
        }),
        ...updates,
        // Role cannot be changed by student
        role: currentProfile?.role ?? 'student'
      };

      const dbUpdates: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.fullName !== undefined) dbUpdates.full_name = updates.fullName;
      if (updates.displayName !== undefined) dbUpdates.display_name = updates.displayName;
      if (updates.level !== undefined) dbUpdates.level = updates.level;
      if (updates.bio !== undefined) dbUpdates.bio = updates.bio;

      // Faculty and department are set once and then permanently locked for
      // the student. New students fill them in during profile completion or
      // their first save; afterwards the only sanctioned path to change them
      // is an admin-approved profile change request. Matriculation number is
      // the verified institutional identifier and can never be edited
      // directly by students either.
      const lockedFields: Array<{ field: string; key: keyof ProfileData; dbCol: string }> = [
        { field: 'faculty', key: 'faculty', dbCol: 'faculty' },
        { field: 'department', key: 'department', dbCol: 'department' }
      ];

      for (const { field, key, dbCol } of lockedFields) {
        if (updates[key] !== undefined && updates[key] !== currentProfile?.[key]) {
          const currentValue = (currentProfile as any)?.[key];
          if (currentValue) {
            return { error: new Error(`${field} is locked after being set. Submit a profile change request to update it.`) };
          }
          dbUpdates[dbCol] = updates[key];
        }
      }

      // Upsert (keyed by id) instead of update: when no profiles row exists
      // yet, an UPDATE would silently match zero rows while an INSERT here is
      // permitted by RLS (id = auth.uid()), creating it on first save.
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        email: user.email,
        ...dbUpdates
      });

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

  // Change password via Supabase Auth (hashed server-side, never stored locally).
  const changePassword = async (newPassword: string): Promise<{ error: Error | null }> => {
    if (!supabase || !user) {
      return { error: new Error('You must be signed in to change your password.') };
    }
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        return { error: new Error(error.message) };
      }
      return { error: null };
    } catch (err: any) {
      return { error: new Error(err.message || 'Failed to change password.') };
    }
  };

  // Sign Out
  const signOut = async () => {
    // Delete session record before signing out
    await deleteCurrentSession().catch(() => {});
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

  const role: AppRole | null =
    profile?.role ||
    (sessionStorage.getItem('fuw-admin') === 'true' ? 'admin' : user ? 'student' : null);
  const isSuperAdmin = role === 'super_admin';
  const isAdmin = role === 'admin' || isSuperAdmin;
  const permissions = profile?.permissions ?? [];
  const hasPermission = (permission: string) =>
    can({ role, permissions, isActive: profile?.isActive !== false }, permission);
  const isStudent = role === 'student';
  const isAuthenticated = !!user && profile?.isActive !== false;
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
      isSuperAdmin,
      isStudent,
      isProfileComplete,
      role,
      permissions,
      hasPermission,
      signInWithUsername,
      signUpWithPassword,
      completeProfile,
      updateProfile,
      changePassword,
      signOut,
      refreshProfile
    }),
    [user, session, profile, isLoading, isAuthenticated, isAdmin, isSuperAdmin, isStudent, isProfileComplete, role, permissions]
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
