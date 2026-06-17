import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Link as LinkIcon, Loader, XCircle, ArrowRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { buildCloudAPIURL } from '../lib/appRuntime';

function DiscordIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 127.14 96.36" fill="currentColor">
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,56.6,124.08,32.65,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
    </svg>
  );
}

function parseQueryParams(location) {
  const params = new URLSearchParams(location.search || '');
  return {
    discordUserId: params.get('discordUserId') || '',
    discordUsername: params.get('discordUsername') || '',
  };
}

function LinkDiscord({ currentUser = null, authResolved = false }) {
  const location = useLocation();
  const { discordUserId, discordUsername } = useMemo(() => parseQueryParams(location), [location]);
  const [state, setState] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');

  const canLink = authResolved && currentUser && discordUserId && discordUsername;

  useEffect(() => {
    if (!authResolved) return;
    if (!currentUser) {
      setState('signin_needed');
      setStatusMsg('You need to sign in to link your Discord.');
      return;
    }
    if (!discordUserId || !discordUsername) {
      setState('missing_params');
      setStatusMsg('Missing Discord account info in the URL. Run `/link` in Discord to get a valid link.');
      return;
    }
    setState('ready');
    setStatusMsg(`Ready to link **${discordUsername}** to your MacClipper account.`);
  }, [authResolved, currentUser, discordUserId, discordUsername]);

  const handleLink = async () => {
    setState('linking');
    setStatusMsg('Linking...');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        setState('failed');
        setStatusMsg('Session expired. Please sign in again.');
        return;
      }

      const response = await fetch(buildCloudAPIURL('/discord-link/start'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ discordUserId, discordUsername }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState('failed');
        setStatusMsg(data.error || `Linking failed (${response.status}).`);
        return;
      }

      const user = data.user || {};
      const tier = user.subscriptionTier || 'free';
      const features = user.paidFeatures || [];
      const hasPro = tier === 'pro' || features.includes('4k-pro');

      if (hasPro) {
        setState('success_pro');
        setStatusMsg('Discord linked with **Pro**! 🎉');
      } else {
        setState('success');
        setStatusMsg('Discord linked successfully!');
      }
    } catch (error) {
      setState('failed');
      setStatusMsg(error.message || 'Linking failed. Please try again.');
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#5865F2]/10">
          <DiscordIcon className="h-8 w-8 text-[#5865F2]" />
        </div>
        <h1 className="page-heading">Link Discord</h1>
        <p className="page-subtitle">Connect your Discord to your MacClipper account.</p>
      </div>

      <section className="glass-card p-6">
        {!authResolved ? (
          <div className="flex items-center justify-center py-8">
            <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : state === 'signin_needed' ? (
          <div className="space-y-4 text-center py-4">
            <XCircle className="mx-auto h-12 w-12 text-amber-500" />
            <p className="text-lg font-semibold">Sign in required</p>
            <p className="text-sm text-muted-foreground">{statusMsg}</p>
            <Link to="/signin" className="inline-block rounded-xl bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white hover:bg-[#4752C4] transition-colors">
              Sign In
            </Link>
          </div>
        ) : state === 'missing_params' ? (
          <div className="space-y-4 text-center py-4">
            <XCircle className="mx-auto h-12 w-12 text-rose-500" />
            <p className="text-lg font-semibold">Invalid link</p>
            <p className="text-sm text-muted-foreground">{statusMsg}</p>
          </div>
        ) : state === 'linking' ? (
          <div className="space-y-4 text-center py-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#5865F2]/10">
              <Loader className="h-8 w-8 animate-spin text-[#5865F2]" />
            </div>
            <p className="text-lg font-semibold">Linking Discord...</p>
            <p className="text-sm text-muted-foreground">{statusMsg}</p>
          </div>
        ) : state === 'success' || state === 'success_pro' ? (
          <div className="rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-500/20 via-[#5865F2]/10 to-emerald-500/10 p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
              <DiscordIcon className="h-8 w-8 text-emerald-500" />
            </div>
            <p className="text-2xl font-extrabold text-foreground">
              {state === 'success_pro' ? '🌟 Linked with Pro!' : '✅ Linked!'}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {state === 'success_pro'
                ? 'Your Discord is connected with Pro access. Check your Discord DMs from the bot!'
                : 'Your Discord is connected. Check your Discord DMs from the bot!'}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="https://discord.com/channels/@me"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white hover:bg-[#4752C4] transition-colors"
              >
                <DiscordIcon className="h-4 w-4" />
                Open Discord
                <ArrowRight className="h-4 w-4" />
              </a>
              <Link to="/dashboard" className="rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors">
                Dashboard
              </Link>
            </div>
          </div>
        ) : state === 'failed' ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-8 text-center">
            <XCircle className="mx-auto h-12 w-12 text-rose-500" />
            <p className="mt-3 text-xl font-bold">Linking Failed</p>
            <p className="mt-2 text-sm text-muted-foreground">{statusMsg}</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={handleLink}
                className="rounded-xl bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white hover:bg-[#4752C4] transition-colors"
              >
                Try Again
              </button>
              <Link to="/dashboard" className="rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors">
                Dashboard
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#5865F2]/10">
                <DiscordIcon className="h-6 w-6 text-[#5865F2]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{discordUsername}</p>
                <p className="text-xs text-muted-foreground">ID: {discordUserId}</p>
              </div>
            </div>

            {currentUser?.email ? (
              <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <span className="text-xl font-bold text-primary">{currentUser.email[0].toUpperCase()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{currentUser.email}</p>
                  <p className="text-xs text-muted-foreground">MacClipper account</p>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleLink}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#5865F2] px-6 py-4 text-base font-bold text-white hover:bg-[#4752C4] transition-colors shadow-lg shadow-[#5865F2]/20"
            >
              <DiscordIcon className="h-5 w-5" />
              Link Discord
            </button>

            <p className="text-xs text-center text-muted-foreground leading-relaxed">
              Your Discord will be linked to the MacClipper account <strong>{currentUser?.email || ''}</strong>.<br />
              If you linked the Mac app, your Pro status will sync automatically and the bot will assign your Pro role.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export default LinkDiscord;
