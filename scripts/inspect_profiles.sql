SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'profiles' 
ORDER BY ordinal_position;

SELECT 
    polname, 
    polpermissive, 
    polroles::text, 
    polcmd, 
    pg_get_expr(polqual, polrelid) AS qual, 
    pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
JOIN pg_class ON pg_policy.polrelid = pg_class.oid
WHERE pg_class.relname = 'profiles';

SELECT tgname, tgtype, proname 
FROM pg_trigger 
JOIN pg_proc ON pg_trigger.tgfoid = pg_proc.oid 
JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid 
WHERE pg_class.relname = 'profiles';
