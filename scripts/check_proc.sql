SELECT proname, proargnames 
FROM pg_proc 
WHERE proname LIKE '%profile%' OR proname LIKE '%student%'
ORDER BY proname;
