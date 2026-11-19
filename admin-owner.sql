-- Quiet Move Chess: server-verified owner-only Admin access
-- 1) Create your account in Supabase Dashboard > Authentication > Users.
-- 2) Copy that user's UUID (User UID).
-- 3) Replace YOUR_OWNER_AUTH_USER_UUID below with that UUID, then run this file.

create table if not exists public.qm_admin_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.qm_admin_owners enable row level security;

-- No client may add, change, or remove owner records.
drop policy if exists "owner can read own admin record" on public.qm_admin_owners;
create policy "owner can read own admin record"
on public.qm_admin_owners for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.qm_admin_owners from anon, authenticated;
grant select on table public.qm_admin_owners to authenticated;

create or replace function public.is_qm_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.qm_admin_owners a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_qm_admin() from public;
revoke all on function public.is_qm_admin() from anon;
grant execute on function public.is_qm_admin() to authenticated;

-- IMPORTANT: replace the UUID below with your own Supabase Auth User UID.
-- Run this separately after replacing the placeholder:
-- insert into public.qm_admin_owners (user_id)
-- values ('YOUR_OWNER_AUTH_USER_UUID'::uuid)
-- on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
