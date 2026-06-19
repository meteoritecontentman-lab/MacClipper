-- MacClipper Presence Status System
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ccnuqjmqmylergzatpua/sql/new

-- Add status column to profiles table
alter table public.profiles
  add column if not exists status text not null default 'offline'
  check (status in ('online', 'idle', 'do_not_disturb', 'offline'));

-- RPC: update profile status (security definer so anon key can call it)
create or replace function public.update_my_status(p_profile_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('online', 'idle', 'do_not_disturb', 'offline') then
    raise exception 'Invalid status: %', p_status;
  end if;
  update public.profiles
  set status = p_status,
      updated_at = timezone('utc', now())
  where id = p_profile_id;
end;
$$;

revoke all on function public.update_my_status(uuid, text) from public;
grant execute on function public.update_my_status(uuid, text) to anon;
grant execute on function public.update_my_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
