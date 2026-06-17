import React from 'react';
import { Link, useLocation } from 'react-router-dom';

function NotFound() {
  const location = useLocation();
  const requestedPath = `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.12),transparent_42%),radial-gradient(circle_at_80%_10%,rgba(14,165,233,0.1),transparent_40%),radial-gradient(circle_at_50%_80%,rgba(245,158,11,0.12),transparent_45%)]" />

      <div className="relative z-10 w-full max-w-2xl rounded-3xl border border-border bg-card/95 p-8 text-center shadow-xl backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-muted-foreground">MacClipper</p>
        <h1 className="mt-4 text-6xl font-black tracking-tight text-foreground">404</h1>
        <p className="mt-3 text-xl font-semibold text-foreground">This page clipped out of existence.</p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          We could not find this route on the website.
        </p>

        <div className="mt-5 rounded-2xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          Requested path: <span className="font-mono text-foreground">{requestedPath}</span>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link to="/" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
            Go Home
          </Link>
          <Link to="/dashboard" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
            Open Dashboard
          </Link>
          <Link to="/support" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
            Get Support
          </Link>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
