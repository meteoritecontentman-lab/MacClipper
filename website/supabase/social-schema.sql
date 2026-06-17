-- MacClipper social schema
-- Apply this in Supabase SQL editor before depending on profile sync,
-- likes, comments, or subscriptions in production.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null,
  avatar_url text,
  auth_provider text not null default 'email',
  verified boolean not null default false,
  linked_app_uuid text,
  linked_app_at timestamptz,
  bio text,
  last_seen_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add column if not exists verified boolean not null default false,
  add column if not exists linked_app_uuid text,
  add column if not exists linked_app_at timestamptz;

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable"
  on public.profiles
  for select
  using (true);

drop policy if exists "users manage their own profile" on public.profiles;
create policy "users manage their own profile"
  on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

alter table public.clips
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists thumbnail_url text,
  add column if not exists owner_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists visibility text not null default 'unlisted',
  add column if not exists game_title text,
  add column if not exists category_label text;

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
  on public.clip_likes
  for select
  using (true);

drop policy if exists "users can insert their own likes" on public.clip_likes;
create policy "users can insert their own likes"
  on public.clip_likes
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete their own likes" on public.clip_likes;
create policy "users can delete their own likes"
  on public.clip_likes
  for delete
  using (auth.uid() = user_id);

grant select on public.clip_likes to anon;
grant select, insert, delete on public.clip_likes to authenticated;

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
  on public.clip_comments
  for select
  using (true);

drop policy if exists "users can insert their own comments" on public.clip_comments;
create policy "users can insert their own comments"
  on public.clip_comments
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own comments" on public.clip_comments;
create policy "users can update their own comments"
  on public.clip_comments
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users can delete their own comments" on public.clip_comments;
create policy "users can delete their own comments"
  on public.clip_comments
  for delete
  using (auth.uid() = user_id);

grant select on public.clip_comments to anon;
grant select, insert, update, delete on public.clip_comments to authenticated;

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
  on public.profile_subscriptions
  for select
  using (true);

drop policy if exists "users can insert their own subscriptions" on public.profile_subscriptions;
create policy "users can insert their own subscriptions"
  on public.profile_subscriptions
  for insert
  with check (auth.uid() = subscriber_id);

drop policy if exists "users can delete their own subscriptions" on public.profile_subscriptions;
create policy "users can delete their own subscriptions"
  on public.profile_subscriptions
  for delete
  using (auth.uid() = subscriber_id);

grant select on public.profile_subscriptions to anon;
grant select, insert, delete on public.profile_subscriptions to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists clip_comments_touch_updated_at on public.clip_comments;
create trigger clip_comments_touch_updated_at
before update on public.clip_comments
for each row execute function public.touch_updated_at();

create or replace function public.set_clip_like(target_clip_id bigint, should_like boolean default true)
returns table (liked boolean, like_count bigint)
language plpgsql
security definer
set search_path = public
as $$
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
    exists(
      select 1
      from public.clip_likes
      where clip_id = target_clip_id and user_id = current_user_id
    ) as liked,
    (
      select count(*)::bigint
      from public.clip_likes
      where clip_id = target_clip_id
    ) as like_count;
end;
$$;

revoke all on function public.set_clip_like(bigint, boolean) from public;
grant execute on function public.set_clip_like(bigint, boolean) to authenticated;