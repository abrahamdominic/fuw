SELECT json_build_object(
  'policies', (SELECT json_agg(json_build_object('policyname', policyname, 'qual', qual, 'with_check', with_check)) FROM pg_policies WHERE tablename = 'library_announcements')
)::text AS line;
