import React from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { buildAppURL, consumeAuthRedirect } from '../lib/appRuntime';
import { logAuthDebug } from '../lib/authDebug';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.6-6 5.9-6c1.8 0 3.1.8 3.8 1.4l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.9 2.5 2.8 6.7 2.8 12s4.1 9.5 9.2 9.5c5.3 0 8.8-3.7 8.8-9 0-.6-.1-1-.1-1.4H12z"/>
    </svg>
  );
}

function SignIn() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [resetBusy, setResetBusy] = React.useState(false);
  const [resetMessage, setResetMessage] = React.useState('');

  const handleGoogleSignIn = async () => {
    setErrorMessage('');
    // Clear any stale PKCE code-verifier so the new flow gets a fresh one.
    Object.keys(window.localStorage)
      .filter(k => k.includes('code-verifier'))
      .forEach(k => window.localStorage.removeItem(k));
    const nextPath = consumeAuthRedirect() || '/dashboard';
    const redirectTo = buildAppURL(nextPath);
    logAuthDebug('google sign-in click', { redirectTo });

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
      logAuthDebug('google sign-in error', { message: error.message });
      setErrorMessage(error.message || 'Google sign-in failed.');
      console.error('Error signing in:', error);
    }
  };

  const handleEmailSignIn = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);
    logAuthDebug('email sign-in submit', { email: email.trim() });

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    setIsSubmitting(false);

    if (error) {
      logAuthDebug('email sign-in error', { message: error.message });
      setErrorMessage(error.message || 'Email sign-in failed.');
      return;
    }

    logAuthDebug('email sign-in success redirecting to dashboard');
    window.location.assign(consumeAuthRedirect() || '/dashboard');
  };

  const handleResetPassword = async () => {
    const targetEmail = email.trim();
    if (!targetEmail) {
      setErrorMessage('Enter your email first, then click Forgot password.');
      return;
    }

    setErrorMessage('');
    setResetMessage('');
    setResetBusy(true);

    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: buildAppURL('/reset-password')
    });

    setResetBusy(false);

    if (error) {
      setErrorMessage(error.message || 'Could not send reset email.');
      return;
    }

    setResetMessage('Password reset email sent. Check your inbox and spam folder.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 font-inter">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">MacClipper Account</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">Welcome back.</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Continue with Google and land straight inside the MacClipper dashboard.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="my-5 h-px w-full bg-border" />

        <form onSubmit={handleEmailSignIn} className="space-y-3">
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
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in with Email'}
          </button>
          <button
            type="button"
            onClick={handleResetPassword}
            disabled={resetBusy}
            className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resetBusy ? 'Sending reset email...' : 'Forgot password'}
          </button>
        </form>

        {errorMessage ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
        ) : null}

        {resetMessage ? (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{resetMessage}</p>
        ) : null}

        <div className="mt-6 rounded-2xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-semibold text-foreground">What gets created</p>
          <p className="mt-1 text-sm text-muted-foreground">Your Google name and email become the starting point for your MacClipper account and channel identity.</p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link to="/signup" className="font-medium text-primary hover:underline">Create your MacClipper space</Link>
        </p>
      </div>
    </div>
  );
}

export default SignIn;