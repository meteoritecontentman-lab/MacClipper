-- MacClipper Complete Database Setup
-- Run this ONCE in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ccnuqjmqmylergzatpua/sql/new
-- Then click "Run"

create extension if not exists pgcrypto;

-- ── profiles ─────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  avatar_url text,
  auth_provider text not null default 'email',
  verified boolean not null default false,
  linked_app_uuid text,
  linked_app_at timestamptz,
  bio text,
  last_seen_at timestamptz,
  follower_count bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable"
  on public.profiles for select using (true);

drop policy if exists "users manage their own profile" on public.profiles;
create policy "users manage their own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, auth_provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'User'),
    coalesce(new.raw_user_meta_data->>'provider', 'email')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── clips ─────────────────────────────────────────────────────────────────────
create table if not exists public.clips (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  content text not null,
  title text,
  description text,
  thumbnail_url text,
  visibility text not null default 'unlisted'
    check (visibility in ('public', 'unlisted', 'private')),
  game_title text,
  category_label text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.clips enable row level security;

drop policy if exists "public clips are readable" on public.clips;
create policy "public clips are readable"
  on public.clips for select
  using (visibility = 'public' or auth.uid() = user_id);

drop policy if exists "users can insert their own clips" on public.clips;
create policy "users can insert their own clips"
  on public.clips for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own clips" on public.clips;
create policy "users can update their own clips"
  on public.clips for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users can delete their own clips" on public.clips;
create policy "users can delete their own clips"
  on public.clips for delete
  using (auth.uid() = user_id);

grant select on public.clips to anon;
grant select, insert, update, delete on public.clips to authenticated;
grant usage, select on sequence public.clips_id_seq to authenticated;

-- ── favourites ────────────────────────────────────────────────────────────────
create table if not exists public.favourites (
  id uuid primary key default gen_random_uuid(),
  clip_id bigint not null references public.clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (clip_id, user_id)
);

alter table public.favourites enable row level security;

drop policy if exists "favourites are readable by owner" on public.favourites;
create policy "favourites are readable by owner"
  on public.favourites for select
  using (auth.uid() = user_id);

drop policy if exists "users can insert their own favourites" on public.favourites;
create policy "users can insert their own favourites"
  on public.favourites for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete their own favourites" on public.favourites;
create policy "users can delete their own favourites"
  on public.favourites for delete
  using (auth.uid() = user_id);

grant select, insert, delete on public.favourites to authenticated;

-- ── clip_likes ────────────────────────────────────────────────────────────────
create table if not exists public.clip_likes (
  id uuid primary key default gen_random_uuid(),
  clip_id bigint not null references public.clips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (clip_id, user_id)
);

alter table public.clip_likes enable row level security;

drop policy if exists "clip likes are readable" on public.clip_likes;
create policy "clip likes are readable"
  on public.clip_likes for select using (true);

drop policy if exists "users can insert their own likes" on public.clip_likes;
create policy "users can insert their own likes"
  on public.clip_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete their own likes" on public.clip_likes;
create policy "users can delete their own likes"
  on public.clip_likes for delete
  using (auth.uid() = user_id);

grant select on public.clip_likes to anon;
grant select, insert, delete on public.clip_likes to authenticated;

-- ── clip_comments ─────────────────────────────────────────────────────────────
create table if not exists public.clip_comments (
  id uuid primary key default gen_random_uuid(),
  clip_id bigint not null references public.clips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.clip_comments enable row level security;

drop policy if exists "clip comments are readable" on public.clip_comments;
create policy "clip comments are readable"
  on public.clip_comments for select using (true);

drop policy if exists "users can insert their own comments" on public.clip_comments;
create policy "users can insert their own comments"
  on public.clip_comments for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own comments" on public.clip_comments;
create policy "users can update their own comments"
  on public.clip_comments for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users can delete their own comments" on public.clip_comments;
create policy "users can delete their own comments"
  on public.clip_comments for delete
  using (auth.uid() = user_id);

grant select on public.clip_comments to anon;
grant select, insert, update, delete on public.clip_comments to authenticated;

-- ── profile_subscriptions ─────────────────────────────────────────────────────
create table if not exists public.profile_subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (subscriber_id, creator_id),
  check (subscriber_id <> creator_id)
);

alter table public.profile_subscriptions enable row level security;

drop policy if exists "profile subscriptions are readable" on public.profile_subscriptions;
create policy "profile subscriptions are readable"
  on public.profile_subscriptions for select using (true);

drop policy if exists "users can insert their own subscriptions" on public.profile_subscriptions;
create policy "users can insert their own subscriptions"
  on public.profile_subscriptions for insert
  with check (auth.uid() = subscriber_id);

drop policy if exists "users can delete their own subscriptions" on public.profile_subscriptions;
create policy "users can delete their own subscriptions"
  on public.profile_subscriptions for delete
  using (auth.uid() = subscriber_id);

grant select on public.profile_subscriptions to anon;
grant select, insert, delete on public.profile_subscriptions to authenticated;

-- ── triggers ──────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists clips_touch_updated_at on public.clips;
create trigger clips_touch_updated_at
  before update on public.clips
  for each row execute function public.touch_updated_at();

drop trigger if exists clip_comments_touch_updated_at on public.clip_comments;
create trigger clip_comments_touch_updated_at
  before update on public.clip_comments
  for each row execute function public.touch_updated_at();

-- ── set_clip_like helper ──────────────────────────────────────────────────────
create or replace function public.set_clip_like(target_clip_id bigint, should_like boolean default true)
returns table (liked boolean, like_count bigint)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if should_like then
    insert into public.clip_likes (clip_id, user_id)
    values (target_clip_id, current_user_id)
    on conflict (clip_id, user_id) do nothing;
  else
    delete from public.clip_likes
    where clip_id = target_clip_id and user_id = current_user_id;
  end if;
  return query
  select
    exists(select 1 from public.clip_likes where clip_id = target_clip_id and user_id = current_user_id) as liked,
    (select count(*)::bigint from public.clip_likes where clip_id = target_clip_id) as like_count;
end;
$$;

revoke all on function public.set_clip_like(bigint, boolean) from public;
grant execute on function public.set_clip_like(bigint, boolean) to authenticated;

-- ── notify PostgREST to reload schema ────────────────────────────────────────
notify pgrst, 'reload schema';
