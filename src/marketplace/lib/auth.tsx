import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { MarketplaceProfile, MarketplaceVendor } from './types';
import { useAuth as usePlatformAuth } from '../../lib/AuthContext';
import { useTheme } from '../../lib/ThemeContext';

/**
 * Marketplace-specific view of the platform session.
 *
 * There is deliberately NO second authentication system here (must.md Phase 4).
 * `user`, `session`, sign-in and sign-out all come from the single platform
 * `AuthProvider`; this context only adds the two things that are genuinely
 * Marketplace-scoped:
 *
 *   1. the delivery campus area, which lives in `marketplace_addresses`, and
 *   2. the Marketplace vendor/staff grants, which are resolved server-side by
 *      `mp_is_admin` / `mp_is_staff` over `marketplace_admin_staff`.
 *
 * Profile identity fields are projected from the shared `profiles` row rather
 * than a second profile table, so a name or matric number edited in the E
 * Library shows up in the Marketplace immediately and there is no second copy
 * to drift.
 */
interface MarketplaceAuthContextType {
  user: User | null;
  profile: MarketplaceProfile | null;
  vendor: MarketplaceVendor | null;
  isAdmin: boolean;
  isStaff: boolean;
  isLoading: boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  signInWithEmail: (email: string, password?: string) => Promise<any>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const MarketplaceAuthContext = createContext<MarketplaceAuthContextType | null>(null);

/** Marketplace column names -> shared `profiles` column names. */
export function mapSharedProfile(row: Record<string, unknown> | null): MarketplaceProfile | null {
  if (!row) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    id: String(row.id ?? ''),
    email: str(row.email),
    full_name: str(row.full_name),
    matric_number: str(row.matric_number),
    phone: str(row.phone_number),
    faculty: str(row.faculty),
    department: str(row.department),
    level: str(row.level),
    avatar_url: str(row.avatar_url),
    // The platform account can be deactivated by an administrator; the
    // Marketplace surfaces that as a suspended profile.
    is_suspended: row.is_active === false,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const platform = usePlatformAuth();
  const { theme, toggleTheme } = useTheme();

  const [profile, setProfile] = useState<MarketplaceProfile | null>(null);
  const [vendor, setVendor] = useState<MarketplaceVendor | null>(null);
  const [mpAdmin, setMpAdmin] = useState(false);
  const [mpStaff, setMpStaff] = useState(false);
  const [mpLoading, setMpLoading] = useState(true);

  // Guards against a slow response for a previous user landing after a newer
  // one. Without it, signing out and back in quickly can leave the previous
  // account's name, vendor row and grants on screen.
  const loadToken = useRef(0);

  const user = platform.user;

  const loadUserData = useCallback(async (currentUser: User | null) => {
    const token = ++loadToken.current;

    if (!currentUser) {
      setProfile(null);
      setVendor(null);
      setMpAdmin(false);
      setMpStaff(false);
      setMpLoading(false);
      return;
    }

    setMpLoading(true);

    try {
      // 1. Shared identity: the same `profiles` row every other platform reads.
      //    The Market- specific delivery campus area is layered on from the
      //    user's default address, because it is Marketplace-owned data.
      const [profileRes, addressRes, vendorRes, adminCheck, staffCheck] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, phone_number, faculty, department, level, avatar_url, is_active')
          .eq('id', currentUser.id)
          .maybeSingle(),
        supabase
          .from('marketplace_addresses')
          .select('campus_area')
          .eq('user_id', currentUser.id)
          .eq('is_default', true)
          .maybeSingle(),
        supabase
          .from('marketplace_vendors')
          .select('*')
          .eq('owner_id', currentUser.id)
          .is('deleted_at', null)
          .maybeSingle(),
        supabase.rpc('mp_is_admin', { p_uid: currentUser.id }),
        supabase.rpc('mp_is_staff'),
      ]);

      if (token !== loadToken.current) return;

      const sharedFromPlatform: MarketplaceProfile | null = platform.profile
        ? {
            id: platform.profile.id,
            email: platform.profile.email,
            full_name: platform.profile.fullName,
            matric_number: platform.profile.matricNumber,
            phone: platform.profile.phoneNumber,
            faculty: platform.profile.faculty,
            department: platform.profile.department,
            level: platform.profile.level,
            avatar_url: platform.profile.avatarUrl,
            is_suspended: platform.profile.isActive === false,
          }
        : null;

      const mapped =
        mapSharedProfile((profileRes.data as Record<string, unknown> | null) ?? null) ||
        sharedFromPlatform;
      const campusArea =
        (addressRes.data as { campus_area?: string } | null)?.campus_area ?? undefined;
      setProfile(mapped ? { ...mapped, campus_hostel: campusArea } : mapped);
      setVendor((vendorRes.data as MarketplaceVendor | null) ?? null);

      // Marketplace grants come from the database and only from the database.
      //
      // `mp_is_admin(p_uid)` is the Marketplace's own admin concept, backed by
      // `marketplace_admin_staff` — it is deliberately NOT the platform's admin
      // flag. A platform administrator who has no `marketplace_admin_staff` row
      // must not see Marketplace admin screens, and a Marketplace admin who is
      // not a platform administrator must still see them; the RPCs that gate
      // every privileged action (wallet, support, adverts) check the same table,
      // so trusting anything else here would show UI the server refuses.
      const admin = Boolean(adminCheck.data);
      setMpAdmin(admin);
      // `mp_is_staff()` with no argument is defined as `mp_is_admin(auth.uid())`,
      // so it is the same answer; the OR is kept explicit because the Navbar
      // gates on `(isAdmin || isStaff)`.
      setMpStaff(Boolean(staffCheck.data) || admin);
    } catch (err) {
      if (typeof window === 'undefined' || token !== loadToken.current) return;
      console.warn('Error loading Marketplace user data:', err);
      if (platform.profile) {
        setProfile({
          id: platform.profile.id,
          email: platform.profile.email,
          full_name: platform.profile.fullName,
          matric_number: platform.profile.matricNumber,
          phone: platform.profile.phoneNumber,
          faculty: platform.profile.faculty,
          department: platform.profile.department,
          level: platform.profile.level,
          avatar_url: platform.profile.avatarUrl,
          is_suspended: platform.profile.isActive === false,
        });
      }
    } finally {
      if (typeof window !== 'undefined' && token === loadToken.current) {
        setMpLoading(false);
      }
    }
  }, [platform.profile]);

  useEffect(() => {
    if (platform.isLoading) return;
    void loadUserData(platform.user);
  }, [platform.isLoading, platform.user, platform.profile, loadUserData]);

  // Safety net: never allow mpLoading to block UI indefinitely on slow RPCs
  useEffect(() => {
    if (!mpLoading) return;
    const timer = window.setTimeout(() => {
      setMpLoading(false);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [mpLoading]);

  // Destructure the platform functions this adapter delegates to. Depending on
  // the whole `platform` object would rebuild every callback on every render,
  // because the context value is a fresh object each time.
  const { signOut: platformSignOut, refreshProfile: platformRefreshProfile, signInWithUsername } =
    platform;

  // The shared provider already owns the session, so signing out is a single
  // platform-wide operation.
  const signOut = useCallback(async () => {
    setProfile(null);
    setVendor(null);
    setMpAdmin(false);
    setMpStaff(false);
    await platformSignOut();
  }, [platformSignOut]);

  const refreshAuth = useCallback(async () => {
    await platformRefreshProfile();
    const { data } = await supabase.auth.getUser();
    await loadUserData(data.user);
  }, [platformRefreshProfile, loadUserData]);

  const signInWithEmail = useCallback(
    async (email: string, password?: string) => {
      if (!password) {
        // Magic link. The platform client owns the session either way.
        return await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/marketplace` },
        });
      }
      // `signInWithUsername` accepts an email identifier and is the single
      // sign-in entry point, so MFA/AAL handling stays in one place.
      return await signInWithUsername(email, password);
    },
    [signInWithUsername]
  );

  return (
    <MarketplaceAuthContext.Provider
      value={{
        user,
        profile,
        vendor,
        isAdmin: mpAdmin,
        isStaff: mpStaff,
        isLoading: platform.isLoading || (Boolean(platform.user) && mpLoading),
        theme,
        toggleTheme,
        signInWithEmail,
        signOut,
        refreshAuth,
      }}
    >
      {children}
    </MarketplaceAuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(MarketplaceAuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside the Marketplace AuthProvider.');
  }
  return context;
};
