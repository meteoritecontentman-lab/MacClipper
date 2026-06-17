import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Clock3, Server, ShieldCheck } from 'lucide-react';
import { buildCloudAPIURL } from '../lib/appRuntime';

const STATUS_REFRESH_MS = 60000;
const BOT_HEALTH_URL = String(process.env.REACT_APP_BOT_HEALTH_URL || '').trim();

function formatTimestamp(value) {
  if (!value) {
    return 'Not checked yet';
  }

  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) {
    return 'Not checked yet';
  }

  return dateValue.toLocaleString();
}

function BotHosting() {
  const [status, setStatus] = useState('checking');
  const [statusMessage, setStatusMessage] = useState('Checking cloud API health...');
  const [lastCheckedAt, setLastCheckedAt] = useState('');

  useEffect(() => {
    let active = true;

    const checkHealth = async () => {
      try {
        const apiResponse = await fetch(buildCloudAPIURL('/health'), { cache: 'no-store' });
        const botResponse = BOT_HEALTH_URL
          ? await fetch(BOT_HEALTH_URL, { cache: 'no-store' }).catch(() => null)
          : null;

        if (!active) {
          return;
        }

        if (apiResponse.ok && (!BOT_HEALTH_URL || botResponse?.ok)) {
          setStatus('online');
          setStatusMessage(BOT_HEALTH_URL
            ? 'Cloud API and Discord bot runtime are online.'
            : 'Cloud API is online. Set REACT_APP_BOT_HEALTH_URL to monitor bot runtime too.');
        } else if (apiResponse.ok && BOT_HEALTH_URL && !botResponse?.ok) {
          setStatus('degraded');
          setStatusMessage('Cloud API is online, but bot runtime health check failed.');
        } else {
          setStatus('degraded');
          setStatusMessage(`Cloud API responded with HTTP ${apiResponse.status}.`);
        }
      } catch {
        if (!active) {
          return;
        }

        setStatus('offline');
        setStatusMessage('Cloud API health check failed.');
      } finally {
        if (active) {
          setLastCheckedAt(new Date().toISOString());
        }
      }
    };

    void checkHealth();
    const intervalId = window.setInterval(() => {
      void checkHealth();
    }, STATUS_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const statusTone = useMemo(() => {
    if (status === 'online') {
      return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200';
    }
    if (status === 'degraded') {
      return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
    }
    if (status === 'offline') {
      return 'border-rose-400/40 bg-rose-500/10 text-rose-100';
    }
    return 'border-slate-400/40 bg-slate-500/10 text-slate-100';
  }, [status]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <section className="border-b border-white/10 bg-[radial-gradient(circle_at_top,_rgba(96,165,250,0.3),_transparent_45%),radial-gradient(circle_at_80%_20%,_rgba(16,185,129,0.22),_transparent_30%)] px-6 py-20 md:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
            <Server className="h-4 w-4" />
            MacClipper Bot Hosting
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-white md:text-6xl">
            Always-available bot hosting page on macclipper.co
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-slate-200">
            This page is served from cloud hosting and stays online independently from your local machine. Even when your laptop is asleep,
            this panel remains reachable for status checks and bot operations links.
          </p>
          <div className={`mt-8 rounded-2xl border p-5 ${statusTone}`}>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em]">
              <Activity className="h-4 w-4" />
              Live Cloud Status
            </div>
            <p className="mt-2 text-lg font-bold">{statusMessage}</p>
            <p className="mt-1 text-sm opacity-90">Last checked: {formatTimestamp(lastCheckedAt)}</p>
          </div>
        </div>
      </section>

      <section className="px-6 py-16 md:px-12">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          <article className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <ShieldCheck className="h-6 w-6 text-emerald-300" />
            <h2 className="mt-4 text-xl font-bold">Hosted On Cloud CDN</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Route is deployed with the main MacClipper site, so the hosting page itself remains available 24/7.
            </p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <Clock3 className="h-6 w-6 text-cyan-300" />
            <h2 className="mt-4 text-xl font-bold">Continuous Health Polling</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Automatic cloud API checks run every minute so you can quickly spot operational issues while away.
            </p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <Server className="h-6 w-6 text-indigo-300" />
            <h2 className="mt-4 text-xl font-bold">Bot Ops Base</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Use this page as your dedicated bot operations home on macclipper.co for setup, monitoring, and support links.
            </p>
          </article>
        </div>

        <div className="mx-auto mt-10 flex max-w-6xl flex-wrap items-center gap-4">
          <Link to="/support" className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-400">
            Open Support
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/" className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10">
            Back To Home
          </Link>
        </div>
      </section>
    </div>
  );
}

export default BotHosting;