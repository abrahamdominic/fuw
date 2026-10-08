SELECT 
    polname, 
    polcmd, 
    pg_get_expr(polqual, polrelid) AS qual, 
    pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
JOIN pg_class ON pg_policy.polrelid = pg_class.oid
WHERE pg_class.relname = 'profiles';
