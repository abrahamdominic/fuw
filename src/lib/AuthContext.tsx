import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { store, UserProfile } from './store';
import { AppRole, can } from './rbac';
import { createSession, touchSession, deleteCurrentSession } from './sessions';
import { analyticsTracker } from './analyticsTracker';
import { getAAL, type AALState, type TOTPFactor } from './security';

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
  levelChangesUsed?: number;
  facultyLocked?: boolean;
  departmentLocked?: boolean;
  gender?: string;
  phoneNumber?: string;
}

// Maximum number of identity-field edits allowed while a profile is incomplete.
// Once the profile is complete all identity fields are permanently locked.
const MAX_PROFILE_CHANGES = 2;

/** Fields that are subject to the "change twice, then lock" rule. */
const CHANGE_LIMITED_FIELDS: Array<{
  key: 'matricNumber' | 'faculty' | 'department' | 'level';
  dbCol: string;
  counterKey: 'matricChangesUsed' | 'facultyChangesUsed' | 'departmentChangesUsed' | 'levelChangesUsed';
}> = [
  { key: 'matricNumber',   dbCol: 'matric_number',     counterKey: 'matricChangesUsed' },
  { key: 'faculty',        dbCol: 'faculty',            counterKey: 'facultyChangesUsed' },
  { key: 'department',     dbCol: 'department',         counterKey: 'departmentChangesUsed' },
  { key: 'level',          dbCol: 'level',              counterKey: 'levelChangesUsed' },
];

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
  ) => Promise<{ error: Error | null; role?: AppRole; mfaRequired?: boolean }>;
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
    gender?: string;
    phoneNumber?: string;
  }) => Promise<{ error: Error | null }>;
  updateProfile: (updates: Partial<ProfileData>) => Promise<{ error: Error | null }>;
  changePassword: (
    newPassword: string
  ) => Promise<{ error: Error | null }>;
  sendPasswordReset: (emailOrUsername: string) => Promise<{ error: Error | null }>;
  resetPassword: (newPassword: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<ProfileData | null>;
  /** After a successful password sign-in, the AAL state indicating whether
   *  a second factor (TOTP) challenge is required. `null` when no MFA prompt
   *  is pending. Login UIs read this to show the OTP entry screen. */
  mfaRequired: AALState | null;
  /** Reset the MFA prompt (e.g. when the user cancels or the challenge succeeds). */
  clearMfaRequired: () => void;
  /** The verified TOTP factor the login UI should challenge against. */
  mfaVerifiedFactor: TOTPFactor | null;
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
  const lastUserIdRef = useRef<string | null>(null);

  // MFA (Authenticator App) prompt state — after a password login succeeds,
  // this is set to the AAL state so the login UI can render the OTP challenge.
  const [mfaRequired, setMfaRequired] = useState<AALState | null>(null);
  const [mfaVerifiedFactor, setMfaVerifiedFactor] = useState<TOTPFactor | null>(null);
  const clearMfaRequired = () => { setMfaRequired(null); };

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
        isVerified: prof.isVerified === true,
        verificationStatus: prof.isVerified ? 'VERIFIED' : 'PENDING',
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

  // Post-login housekeeping executed after a successful password sign-in:
  //   1. Check the AAL level — when the user has a verified TOTP factor and
  //      the next level is `aal2`, surface the MFA prompt instead of letting
  //      the app proceed to the dashboard.
  //   2. Ensure the "profile not complete" reminder exists for students whose
  //      profile is still incomplete (re-inserted until they finish setup).
  const afterAuthenticated = async (prof: ProfileData): Promise<AALState | null> => {
    let mfaState: AALState | null = null;
    let verifiedFactor: TOTPFactor | null = null;
    try {
      const aal = await getAAL();
      if (aal.next === 'aal2' && aal.verified.length > 0) {
        mfaState = aal;
        verifiedFactor = aal.verified[0];
      }
    } catch {
      // MFA not enabled server-side or a transient failure — treat as aal1.
    }
    setMfaRequired(mfaState);
    setMfaVerifiedFactor(verifiedFactor);

    if (supabase && prof && !prof.isActive) return mfaState;
    // Notify until the profile is complete (only meaningful for students).
    if (supabase && prof && prof.role === 'student' && !(prof.matricNumber && prof.faculty && prof.department)) {
      try {
        await supabase.rpc('ensure_profile_setup_notification');
      } catch {
        // RPC may not exist yet if the migration hasn't been applied — ignore.
      }
    }
    return mfaState;
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
          isVerified: data.verified === true,
          joinedDate: data.created_at ? new Date(data.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '2026',
          matricChangesUsed: data.matric_changes_used ?? 0,
          facultyChangesUsed: data.faculty_changes_used ?? 0,
          departmentChangesUsed: data.department_changes_used ?? 0,
          levelChangesUsed: data.level_changes_used ?? 0,
          facultyLocked: !!data.faculty,
          departmentLocked: !!data.department,
          gender: data.gender || '',
          phoneNumber: data.phone_number || ''
        };
        setProfile(loadedProfile);
        return loadedProfile;
      }

      // Self-heal: If profile row is missing from profiles table, create it now for the authenticated user
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser && currentUser.id === userId) {
        const meta = currentUser.user_metadata || {};
        const fallbackProfile = {
          id: userId,
          email: userEmail || currentUser.email || '',
          full_name: meta.full_name || userEmail?.split('@')[0] || 'Student',
          display_name: meta.display_name || meta.full_name?.split(' ')[0] || 'Student',
          username: meta.username || null,
          matric_number: meta.matric_number || null,
          faculty: meta.faculty || null,
          department: meta.department || null,
          level: meta.level || null,
          gender: meta.gender || null,
          phone_number: meta.phone_number || null,
          role: 'student' as AppRole,
          is_active: true,
        };
        const { data: created } = await supabase
          .from('profiles')
          .insert(fallbackProfile)
          .select()
          .maybeSingle();

        if (created) {
          const loadedProfile: ProfileData = {
            id: created.id,
            fullName: created.full_name,
            displayName: created.full_name?.split(' ')[0] || created.full_name,
            email: created.email || userEmail || '',
            matricNumber: created.matric_number || '',
            faculty: created.faculty || '',
            department: created.department || '',
            level: created.level || '',
            role: (created.role as AppRole) || 'student',
            permissions: Array.isArray(created.permissions) ? created.permissions : [],
            isActive: created.is_active !== false,
            bio: created.bio || '',
            avatarUrl: created.avatar_url || '',
            isVerified: created.verified === true,
            joinedDate: created.created_at ? new Date(created.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '2026',
            matricChangesUsed: created.matric_changes_used ?? 0,
            facultyChangesUsed: created.faculty_changes_used ?? 0,
            departmentChangesUsed: created.department_changes_used ?? 0,
            levelChangesUsed: created.level_changes_used ?? 0,
            facultyLocked: !!created.faculty,
            departmentLocked: !!created.department,
            gender: created.gender || '',
            phoneNumber: created.phone_number || ''
          };
          setProfile(loadedProfile);
          return loadedProfile;
        }
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
              } else if (prof) {
                await afterAuthenticated(prof);
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

        // Track auth lifecycle for analytics (attributed to the actual user).
        if (currentSession?.user) {
          lastUserIdRef.current = currentSession.user.id;
          if (event === 'SIGNED_IN') {
            analyticsTracker.trackAuthEvent('login', currentSession.user.id);
          }
        } else if (event === 'SIGNED_OUT') {
          analyticsTracker.trackAuthEvent('logout', lastUserIdRef.current);
          lastUserIdRef.current = null;
        }

        setSession(currentSession);
        setUser(currentSession?.user || null);

        if (currentSession?.user) {
          const prof = await fetchProfile(currentSession.user.id, currentSession.user.email);
          if (prof && !prof.isActive && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
            await authClient.auth.signOut();
            setProfile(null);
            syncToStore(null, null);
          } else {
            if (prof && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
              await afterAuthenticated(prof);
            }
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
    usernameOrEmail: string,
    password: string
  ): Promise<{ error: Error | null; role?: AppRole; mfaRequired?: boolean }> => {
    if (!supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }

    const raw = usernameOrEmail.trim();
    if (!raw || !password) {
      return { error: new Error('Please enter your username or email and password.') };
    }

    // 1. Direct Email Sign-In (if identifier is an email)
    if (raw.includes('@')) {
      const email = raw.toLowerCase();
      try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (authError) {
          const msg = authError.message.toLowerCase();
          if (msg.includes('invalid') || msg.includes('credentials')) {
            return { error: new Error('Invalid email or password. Please verify your credentials and try again.') };
          }
          if (msg.includes('not confirmed') || msg.includes('email_not_confirmed')) {
            return {
              error: new Error(
                'Your email address has not been confirmed yet. Please check your inbox for the confirmation link.'
              )
            };
          }
          if (msg.includes('rate')) {
            return { error: new Error('Too many sign-in attempts. Please wait a few moments and try again.') };
          }
          return { error: new Error(authError.message) };
        }

        if (authData.user && authData.session) {
          setUser(authData.user);
          setSession(authData.session);

          const prof = await fetchProfile(authData.user.id, authData.user.email);
          if (!prof) {
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
          const mfaPending = (await afterAuthenticated(prof)) !== null;
          syncToStore(prof, authData.user);
          return { error: null, role: prof.role, mfaRequired: mfaPending };
        }

        return { error: new Error('Sign-in failed. Please try again.') };
      } catch (err: any) {
        return { error: new Error(err?.message || 'Sign-in failed. Please check your connection and try again.') };
      }
    }

    // 2. Username Sign-In (edge function -> lookup_login_email RPC fallback)
    const uname = normalizeUsername(raw);
    let code: string | null = null;
    let session: any = null;

    try {
      const { data, error } = await supabase.functions.invoke('resolve-login', {
        body: { op: 'login', username: uname, password }
      });
      if (!error && data && typeof data === 'object' && (data as any).session) {
        session = (data as any).session;
      } else if (data && typeof data === 'object' && (data as any).error) {
        code = (data as any).error;
      }
    } catch {
      // Edge function may not be deployed or failed; fall through to database lookup
    }

    // Fallback: If edge function did not produce session, try RPC lookup_login_email
    if (!session) {
      try {
        const { data: rpcEmail } = await supabase.rpc('lookup_login_email', {
          p_username: uname
        });
        if (rpcEmail && typeof rpcEmail === 'string' && rpcEmail.includes('@')) {
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: rpcEmail.toLowerCase(),
            password
          });
          if (authError) {
            const msg = authError.message.toLowerCase();
            if (msg.includes('not confirmed') || msg.includes('email_not_confirmed')) {
              return {
                error: new Error(
                  'Your email address has not been confirmed yet. Please check your inbox for the confirmation link.'
                )
              };
            }
            return { error: new Error('Invalid username or password. Please verify your credentials and try again.') };
          }
          if (authData.user && authData.session) {
            session = authData.session;
          }
        }
      } catch {
        // Ignore fallback RPC error
      }
    }

    if (!session) {
      if (code === 'EMAIL_NOT_CONFIRMED') {
        return {
          error: new Error(
            'Your email address has not been confirmed yet. Please check your inbox for the confirmation link.'
          )
        };
      }
      if (code === 'RATE_LIMITED') {
        return { error: new Error('Too many sign-in attempts. Please wait a few moments and try again.') };
      }
      return {
        error: new Error(
          'Invalid username or password. You can also sign in directly using your registered email address.'
        )
      };
    }

    try {
      await supabase.auth.setSession(session);
      const {
        data: { user },
        error: userErr
      } = await supabase.auth.getUser();
      if (userErr || !user) {
        await supabase.auth.signOut();
        return { error: new Error('Sign-in failed. Please try again.') };
      }

      if (user) {
        setUser(user);
        setSession(session);

        const prof = await fetchProfile(user.id, user.email);
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
        const mfaPending = (await afterAuthenticated(prof)) !== null;
        syncToStore(prof, user);
        return { error: null, role: prof.role, mfaRequired: mfaPending };
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
        analyticsTracker.trackAuthEvent('registration', data.user.id, {
          needs_email_confirmation: !data.session
        });
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
    gender?: string;
    phoneNumber?: string;
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
        gender: data.gender || '',
        phoneNumber: data.phoneNumber || '',
        isVerified: profile?.isVerified === true,
        joinedDate: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      };

      // NOTE: role is intentionally NOT written here. Invited administrators
      // receive their role from the database trigger when their account is
      // created; overwriting it would silently demote them to students.
      //
      // Identity fields written here count as the student's first recorded
      // change (kept at 1), so an incomplete profile keeps exactly one more
      // sanctioned edit before every identity field locks permanently.
      const usedMatric = profile?.matricChangesUsed ?? 0;
      const usedFaculty = profile?.facultyChangesUsed ?? 0;
      const usedDept = profile?.departmentChangesUsed ?? 0;
      const usedLevel = profile?.levelChangesUsed ?? 0;

      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        full_name: newProfile.fullName,
        email: user.email,
        matric_number: newProfile.matricNumber,
        faculty: newProfile.faculty,
        department: newProfile.department,
        level: newProfile.level,
        gender: newProfile.gender || null,
        phone_number: newProfile.phoneNumber || null,
        matric_changes_used: newProfile.matricNumber ? Math.max(usedMatric, 1) : usedMatric,
        faculty_changes_used: newProfile.faculty ? Math.max(usedFaculty, 1) : usedFaculty,
        department_changes_used: newProfile.department ? Math.max(usedDept, 1) : usedDept,
        level_changes_used: newProfile.level ? Math.max(usedLevel, 1) : usedLevel,
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
      if (updates.gender !== undefined) dbUpdates.gender = updates.gender || null;
      if (updates.phoneNumber !== undefined) dbUpdates.phone_number = updates.phoneNumber || null;

      // Identity fields follow the "change twice, then lock" rule:
      //
      //   * While the profile is INCOMPLETE, each of these fields may be
      //     changed at most `MAX_PROFILE_CHANGES` (2) times — tracked by the
      //     `*_changes_used` counters. Reaching the limit locks that field.
      //   * Once the profile is COMPLETE (matric + faculty + department all
      //     set), every identity field is permanently locked. The only
      //     sanctioned path to a later change is an admin-approved profile
      //     change request.
      const isCompleteNow =
        !!currentProfile?.matricNumber &&
        !!currentProfile.faculty &&
        !!currentProfile.department;

      const FIELD_LABEL: Record<string, string> = {
        matricNumber: 'Matriculation Number',
        faculty: 'Faculty',
        department: 'Department',
        level: 'Level'
      };
      const COUNTER_TO_DB: Record<string, string> = {
        matricChangesUsed: 'matric_changes_used',
        facultyChangesUsed: 'faculty_changes_used',
        departmentChangesUsed: 'department_changes_used',
        levelChangesUsed: 'level_changes_used'
      };

      for (const { key, dbCol, counterKey } of CHANGE_LIMITED_FIELDS) {
        const incoming = updates[key];
        if (incoming === undefined) continue;

        const normalized =
          key === 'matricNumber'
            ? String(incoming).trim().toUpperCase()
            : String(incoming);
        const currentValue = String((currentProfile as any)?.[key] ?? '');
        if (normalized === currentValue) continue;

        const used = (currentProfile as any)?.[counterKey] ?? 0;

        if (isCompleteNow) {
          return {
            error: new Error(
              `${FIELD_LABEL[key]} is locked after your profile is complete. Submit a profile change request to update it.`
            )
          };
        }
        if (used >= MAX_PROFILE_CHANGES) {
          return {
            error: new Error(
              `You have used all your allowed changes for ${FIELD_LABEL[key]}. Contact the library administrator for further changes.`
            )
          };
        }

        dbUpdates[dbCol] = normalized;
        dbUpdates[COUNTER_TO_DB[counterKey]] = used + 1;
        // Mirror the increment locally so the next edit within the same
        // session enforces the limit correctly.
        (updatedProfile as any)[counterKey] = used + 1;
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

  // Request a password reset email. Accepts either the registered email or a
  // username (resolved to the account email server-side in the resolve-login
  // edge function; no public lookup RPC exists). Always returns a neutral
  // success for unknown accounts so the endpoint cannot be used to enumerate
  // which usernames/emails exist.
  const sendPasswordReset = async (emailOrUsername: string): Promise<{ error: Error | null }> => {
    let email = emailOrUsername.trim().toLowerCase();
    if (!supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }

    if (!email.includes('@')) {
      // Username-based reset: try resolve-login edge function, fallback to lookup_login_email RPC
      let resolvedEmail: string | null = null;
      try {
        const { data } = await supabase.functions.invoke('resolve-login', {
          body: { op: 'reset_username', username: emailOrUsername, redirectTo: `${window.location.origin}/reset-password` }
        });
        if (data) return { error: null };
      } catch {
        // Edge function may not be deployed, fall through to lookup RPC
      }

      try {
        const { data: rpcEmail } = await supabase.rpc('lookup_login_email', {
          p_username: normalizeUsername(emailOrUsername)
        });
        if (rpcEmail && typeof rpcEmail === 'string' && rpcEmail.includes('@')) {
          resolvedEmail = rpcEmail;
        }
      } catch {
        // Ignore lookup error
      }

      if (resolvedEmail) {
        await supabase.auth.resetPasswordForEmail(resolvedEmail, {
          redirectTo: `${window.location.origin}/reset-password`
        }).catch(() => undefined);
      }
      return { error: null };
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (error) {
        return { error: new Error(error.message) };
      }
      return { error: null };
    } catch (err: any) {
      return { error: new Error(err.message || 'Failed to send the password reset email.') };
    }
  };

  // Set a brand-new password from the password-recovery page (the recovery
  // token already established an authenticated session, so this is simply a
  // password update, hashed server-side).
  const resetPassword = async (newPassword: string): Promise<{ error: Error | null }> => {
    if (!supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        return { error: new Error(error.message) };
      }
      return { error: null };
    } catch (err: any) {
      return { error: new Error(err.message || 'Failed to reset your password.') };
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

  // Role is derived solely from the server-fetched profile (DB). Never from
  // sessionStorage: that flag is only a legacy UI hint and must not influence
  // authorization decisions.
  const role: AppRole | null = profile?.role || (user ? 'student' : null);
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
      sendPasswordReset,
      resetPassword,
      signOut,
      refreshProfile,
      mfaRequired,
      clearMfaRequired,
      mfaVerifiedFactor
    }),
    [user, session, profile, isLoading, isAuthenticated, isAdmin, isSuperAdmin, isStudent, isProfileComplete, role, permissions, mfaRequired, mfaVerifiedFactor]
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
