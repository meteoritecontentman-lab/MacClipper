# GitHub Pages Google + Supabase Auth Setup

This project is deployed on GitHub Pages at:

- Production site: `https://userbro20.github.io/macclipper-site/`
- OAuth return target used by the app: `https://userbro20.github.io/macclipper-site/#/clips`

The website code builds that redirect target from the GitHub Pages hash-router runtime in `website/src/lib/appRuntime.js` and uses it in both sign-in and sign-up flows.

## 1. Supabase Dashboard

Open the project:

- Supabase project URL: `https://ccnuqjmqmylergzatpua.supabase.co`

Then go to `Authentication -> URL Configuration` and set:

- Site URL: `https://userbro20.github.io/macclipper-site`

Add these Redirect URLs:

- `https://userbro20.github.io/macclipper-site/**`
- `http://localhost:3000/**`

Why:

- Production uses a hash route after login: `#/clips`
- Supabase requires the `redirectTo` URL to match the redirect allow-list
- The wildcard keeps the production Pages route working even with hash fragments and future client-side paths

## 2. Supabase Google Provider

Go to `Authentication -> Providers -> Google`.

Set or verify:

- Enabled: `on`
- Client ID: the Google OAuth Web Client ID you create below
- Client Secret: the matching Google OAuth client secret

Supabase callback URL for this project:

- `https://ccnuqjmqmylergzatpua.supabase.co/auth/v1/callback`

That exact callback URL is what Google must redirect back to.

## 3. Google Cloud Console

Open Google Cloud Console for the OAuth app that backs this site.

Recommended path:

- `Google Auth Platform -> Clients`

Create or edit a `Web application` OAuth client.

### Authorized JavaScript origins

Add:

- `https://userbro20.github.io`
- `http://localhost:3000`

If Google rejects the GitHub Pages subpath, that is expected. Google wants origins, not full paths.

### Authorized redirect URIs

Add:

- `https://ccnuqjmqmylergzatpua.supabase.co/auth/v1/callback`

Do not put the GitHub Pages `#/clips` URL here. Google redirects to Supabase first, and Supabase then returns the user to the Pages app.

## 4. Google Consent Screen

Open `Google Auth Platform -> Branding` and `Audience`.

Set or verify:

- App name: `MacClipper`
- Support email: your preferred support email
- Authorized domain: `github.io`
- Homepage: `https://userbro20.github.io/macclipper-site/`
- Privacy policy: add once you have one
- Terms of service: add once you have one

If the app is still in testing mode, add your own Google account under test users or Google will block sign-in for non-test accounts.

Required scopes from Supabase Google auth:

- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

## 5. What the Site Currently Does

The website sends Google sign-in through Supabase with:

- Provider: `google`
- `redirectTo`: `https://userbro20.github.io/macclipper-site/#/clips` in production

Relevant files:

- `website/src/lib/appRuntime.js`
- `website/src/components/SignIn.js`
- `website/src/components/SignUp.js`

## 6. Quick Verification

After updating Supabase and Google:

1. Open `https://userbro20.github.io/macclipper-site/#/signup`
2. Click `Create with Google`
3. Complete consent
4. Confirm you land on `https://userbro20.github.io/macclipper-site/#/clips`
5. Confirm the user session exists and the profile menu shows the Google-derived name

## 7. If It Still Fails

Typical causes:

- `redirectTo` is not included in Supabase Redirect URLs
- Google OAuth client is missing the Supabase callback URI
- The Google OAuth app is still in testing mode and your account is not a test user
- The wrong Google client ID or secret was pasted into Supabase
- A stale localhost Site URL is still set in Supabase URL Configuration

## 8. No Code Change Needed For This Step

The current website code already points to the correct production redirect target for GitHub Pages.
This step is external console configuration only.