# Supabase Social Notes

## What changed in the website

- Google and email auth still use Supabase Auth.
- The web app now attempts to upsert a `profiles` row after sign-in, token refresh, and user updates.
- Profile sync uses Supabase auth metadata so the account identity can own likes, comments, descriptions, favourites, and creator subscriptions.

## Why the like system should not trust the client

If the client increments a number directly, players can race requests, duplicate clicks, or replay calls and create fake counts.

The safer pattern is:

- store one like as one row,
- enforce uniqueness on `(clip_id, user_id)`,
- let the database decide whether the like already exists,
- return the real count from the database after the write.

That is why `website/supabase/social-schema.sql` includes:

- a unique constraint on `clip_likes (clip_id, user_id)`,
- row-level security policies tied to `auth.uid()`,
- a `set_clip_like(...)` function that inserts with `on conflict do nothing` instead of trusting the browser.

## Before wiring comments, likes, and subscriptions in the UI

Apply `website/supabase/social-schema.sql` in Supabase first. The current repo can build without it, but profile sync and future social UI depend on those tables and policies existing in the project.