SELECT proname, prosrc 
FROM pg_proc 
WHERE proname IN (
    'protect_profile_privileges',
    'profiles_guard_verification',
    'profiles_identity_lock',
    'profiles_sync_verification_flag'
);
