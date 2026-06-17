import React from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { buildAppURL, consumeAuthRedirect } from '../lib/appRuntime';
import { logAuthDebug } from '../lib/authDebug';
import { syncSupabaseProfile } from '../lib/profileSync';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.6-6 5.9-6c1.8 0 3.1.8 3.8 1.4l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.9 2.5 2.8 6.7 2.8 12s4.1 9.5 9.2 9.5c5.3 0 8.8-3.7 8.8-9 0-.6-.1-1-.1-1.4H12z"/>
    </svg>
  );
}

function SignUp() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleGoogleSignIn = async () => {
    setErrorMessage('');
    Object.keys(window.localStorage)
      .filter(k => k.includes('code-verifier'))
      .forEach(k => window.localStorage.removeItem(k));
    const nextPath = consumeAuthRedirect() || '/dashboard';
    const redirectTo = buildAppURL(nextPath);
    logAuthDebug('google sign-up click', { redirectTo });

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          prompt: 'select_account'
        }
      }
    });
    if (error) {
      logAuthDebug('google sign-up error', { message: error.message });
      setErrorMessage(error.message || 'Google sign-up failed.');
      console.error('Error signing in:', error);
    }
  };

  const formatSignUpErrorMessage = (message) => {
    const normalizedMessage = String(message || '').trim();
    const normalizedLower = normalizedMessage.toLowerCase();
    if (normalizedLower.includes('already registered') || normalizedLower.includes('user already registered')) {
      return 'This email is already registered. Use Sign in or reset your password.';
    }
    if (normalizedMessage.toLowerCase().includes('email rate limit exceeded') || normalizedMessage.toLowerCase().includes('email rate exceeded')) {
      return 'Too many signup emails were requested too quickly. Wait a few minutes and try again, or use Google sign-in right now.';
    }

    return normalizedMessage || 'Email sign-up failed.';
  };

  const handleEmailSignUp = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);
    logAuthDebug('email sign-up submit', { email: email.trim() });

    const trimmedEmail = email.trim();
    const nextPath = consumeAuthRedirect() || '/dashboard';
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo: buildAppURL(nextPath)
      }
    });

    setIsSubmitting(false);

    if (error) {
      logAuthDebug('email sign-up error', { message: error.message });
      setErrorMessage(formatSignUpErrorMessage(error.message));
      return;
    }

    if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
      setErrorMessage('This email is already registered. Use Sign in or reset your password.');
      return;
    }

    if (data?.user) {
      void syncSupabaseProfile(data.user).catch((syncError) => {
        console.error('Profile sync after email sign-up failed:', syncError);
      });
    }

    logAuthDebug('email sign-up success redirecting to dashboard');
    window.location.assign(nextPath);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 font-inter">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">MacClipper Account</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">Start a channel that already feels like home.</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Say yes to Google once and MacClipper uses your name and email to shape the account, initials icon, and creator identity that follow you across clips.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <GoogleIcon />
          Create with Google
        </button>

        <div className="my-5 h-px w-full bg-border" />

        <form onSubmit={handleEmailSignUp} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="new-password"
            required
            minLength={6}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Creating account...' : 'Create with Email'}
          </button>
        </form>

        {errorMessage ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
        ) : null}

        <div className="mt-6 rounded-2xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-semibold text-foreground">What you are approving</p>
          <p className="mt-1 text-sm text-muted-foreground">MacClipper uses the Google information you approve to create your website account name, email identity, initials icon, and creator profile.</p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/signin" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default SignUp;