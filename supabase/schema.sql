-- Run in Supabase SQL editor. Never use the service role key in the browser.
create type public.app_role as enum ('student','admin');
create type public.material_status as enum ('pending','approved','rejected');
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text not null, email text not null unique, matric_number text unique, faculty text, department text, level text, role public.app_role not null default 'student', created_at timestamptz default now(), updated_at timestamptz default now());
create table public.materials (id uuid primary key default gen_random_uuid(), title text not null, description text, faculty text not null, department text not null, level text not null, course_code text, course_title text, semester text, material_type text, file_url text not null, file_name text not null, uploaded_by uuid not null references public.profiles(id), status public.material_status not null default 'pending', approved_by uuid references public.profiles(id), approved_at timestamptz, rejection_reason text, created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.profiles enable row level security; alter table public.materials enable row level security;
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
create policy "profiles own read" on public.profiles for select using (id=auth.uid() or public.is_admin());
create policy "profiles own update" on public.profiles for update using (id=auth.uid()) with check (id=auth.uid() and role=(select role from public.profiles where id=auth.uid()));
create policy "approved materials public read" on public.materials for select using (status='approved' or uploaded_by=auth.uid() or public.is_admin());
create policy "authenticated uploads" on public.materials for insert to authenticated with check (uploaded_by=auth.uid() and (status='pending' or public.is_admin()));
create policy "admin material review" on public.materials for update to authenticated using (public.is_admin()) with check (public.is_admin());
insert into storage.buckets (id,name,public) values ('library-materials','library-materials',false) on conflict do nothing;
create policy "upload own material files" on storage.objects for insert to authenticated with check (bucket_id='library-materials' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "read approved storage via signed url" on storage.objects for select to authenticated using (bucket_id='library-materials' and (owner_id=auth.uid() or public.is_admin()));
