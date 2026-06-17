import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Clipboard, Cloud, Clock, Mic, Monitor, PenLine, Shield, Star, Zap } from 'lucide-react';

const BRAND_ICON_URL = 'https://media.base44.com/images/public/user_69840c94143af1fbc044bd6f/cf2d115fa_AppIcon_1024x1024x32.png';

const features = [
  {
    icon: Mic,
    title: 'Voice Commanded',
    description: 'Say "Mac Clip That!" and save the highlight without taking your hands off the game.',
    badge: 'Signature Feature'
  },
  {
    icon: Zap,
    title: 'Instant Replay',
    description: 'Save the last moments of gameplay the second something happens. No need to record every full match manually.',
    badge: null
  },
  {
    icon: Clipboard,
    title: 'Clip Library',
    description: 'Rename, replay, favorite, and organize saved highlights from one clean Mac-ready library.',
    badge: null
  },
  {
    icon: PenLine,
    title: 'Edit Workflow',
    description: 'Trim, sequence, and prep clips before you upload them, send them, or post them anywhere else.',
    badge: 'Built In'
  },
  {
    icon: Monitor,
    title: 'Multi-Display Support',
    description: 'Choose the display you want to capture and switch when your setup changes.',
    badge: null
  },
  {
    icon: Cloud,
    title: 'Cloud Sharing',
    description: 'Upload selected clips, generate share links, and keep your best moments available online when you want them there.',
    badge: null
  },
  {
    icon: Shield,
    title: 'Private by Default',
    description: 'Keep clips on your Mac until you decide a highlight should be uploaded or shared.',
    badge: null
  },
  {
    icon: Clock,
    title: 'Always Ready',
    description: 'A rolling capture buffer stays ready in the background for the moment that actually matters.',
    badge: null
  }
];

const searchHighlights = ['Built for macOS', 'Voice trigger clips', '4K capture'];

const heroSignals = [
  {
    label: 'Native feel',
    value: 'Built for Mac gamers'
  },
  {
    label: 'Capture quality',
    value: 'Instant replay in 4K'
  },
  {
    label: 'Share flow',
    value: 'Keep clips local until you post'
  }
];

const workflowSteps = [
  {
    title: 'Capture the moment',
    description: 'Keep gameplay running, then save the last play with a hotkey or the voice trigger when the highlight happens.'
  },
  {
    title: 'Review and edit fast',
    description: 'Open the clip library, replay the moment, rename it, and jump into the editor when the clip needs cleanup.'
  },
  {
    title: 'Share only the best clips',
    description: 'Upload selected highlights, create share links, and keep the rest of your recordings local on your Mac.'
  }
];

const faqs = [
  {
    question: 'How do I clip the last seconds of gameplay on Mac?',
    answer: 'MacClipper uses a rolling capture buffer so you can save the moment that just happened instead of recording every match from start to finish.'
  },
  {
    question: 'Can I trigger a clip with my voice?',
    answer: 'Yes. MacClipper supports the voice command "Mac Clip That!" so you can save a highlight hands-free.'
  },
  {
    question: 'Do clips stay local by default?',
    answer: 'Yes. MacClipper can keep clips on your Mac, and you choose when to upload or share a highlight.'
  },
  {
    question: 'Is 4K capture available?',
    answer: 'Yes. MacClipper supports 4K capture for players who want higher quality highlights.'
  }
];

function Home({ currentUser }) {
  return (
    <div className="min-h-screen bg-background font-inter">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 md:px-12">
        <Link to="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
          <img src={BRAND_ICON_URL} alt="MacClipper" className="h-10 w-10 rounded-xl" />
          <span className="text-xl font-bold tracking-tight text-foreground">MacClipper</span>
        </Link>
        <div className="flex items-center gap-3">
          {currentUser ? (
            <>
              <Link to="/dashboard" className="rounded-lg px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                Dashboard
              </Link>
              <Link to="/clips" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Open Clips
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          ) : (
            <>
              <Link to="/signin" className="rounded-lg px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                Sign In
              </Link>
              <Link to="/signup" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-6 pb-24 pt-16 md:px-12">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }}>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              <Star className="h-3 w-3" />
              Built for Mac gamers
            </div>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-foreground md:text-6xl">
              Mac game clipping software
              <br />
              <span className="text-primary">that feels right from the first clip.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              MacClipper stays ready in the background, saves the moment right after it happens, and gives you one clean place to trim, organize, and share your best Mac clips without recording whole sessions manually.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link to={currentUser ? '/dashboard' : '/signup'} className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-4 text-lg font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                {currentUser ? 'Open Dashboard' : 'Start Clipping'}
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link to="/community" className="inline-flex items-center gap-2 rounded-lg border border-border px-8 py-4 text-lg font-medium text-foreground transition-colors hover:bg-muted">
                Watch Community
              </Link>
              <a href="/api/downloads/macclipper/latest" className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-8 py-4 text-lg font-semibold text-primary transition-colors hover:bg-primary/20">
                Download MacClipper
              </a>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              {searchHighlights.map((highlight) => (
                <span key={highlight} className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground">
                  {highlight}
                </span>
              ))}
            </div>
            <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
              {heroSignals.map((signal) => (
                <div key={signal.label} className="rounded-2xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{signal.label}</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">{signal.value}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
            className="flex justify-center"
          >
            <div className="relative">
              <div className="flex h-64 w-64 items-center justify-center rounded-[3rem] bg-gradient-to-br from-primary/20 via-accent/20 to-primary/10 md:h-80 md:w-80">
                <img src={BRAND_ICON_URL} alt="MacClipper instant replay and game clipping software for macOS" className="h-48 w-48 rounded-[2.5rem] shadow-2xl md:h-60 md:w-60" />
              </div>
              <div className="absolute -right-4 -top-4 h-20 w-20 rounded-2xl bg-accent/20 blur-xl"></div>
              <div className="absolute -bottom-6 -left-6 h-28 w-28 rounded-full bg-primary/15 blur-2xl"></div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 md:px-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-accent/10 p-10 text-center md:p-16"
        >
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15">
            <Mic className="h-8 w-8 text-primary" />
          </div>
          <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-foreground md:text-5xl">
            Just say <span className="text-primary">"Mac Clip That!"</span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            MacClipper's signature voice trigger saves a highlight hands-free when there is no time to reach for a shortcut.
          </p>
        </motion.div>
      </section>

      <section className="bg-muted/50 px-6 py-24 md:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">Everything you need to clip gameplay on Mac</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              MacClipper is built to feel welcoming and fast: clip the moment, clean it up quickly, and share only what you want to keep.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.07 * index }}
                className="relative rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:border-primary/20 hover:shadow-lg"
              >
                {feature.badge ? (
                  <span className={[
                    'absolute right-4 top-4 rounded-full px-2 py-0.5 text-xs font-semibold',
                    feature.badge === 'Coming Soon' ? 'bg-accent/15 text-accent' : 'bg-primary/10 text-primary'
                  ].join(' ')}>
                    {feature.badge}
                  </span>
                ) : null}
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-foreground">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24 md:px-12">
        <div className="mb-14 max-w-3xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">From instant replay capture to share-ready clips</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            MacClipper covers the full workflow people usually piece together with multiple tools: capture the moment, review it fast, edit when needed, then share only the highlights worth keeping.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {workflowSteps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.08 * index }}
              className="rounded-3xl border border-border bg-card p-8"
            >
              <span className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">Step {index + 1}</span>
              <h3 className="mt-4 text-2xl font-bold text-foreground">{step.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="bg-muted/50 px-6 py-24 md:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">MacClipper FAQ</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              Quick answers to the main questions people search before they choose Mac clipping software.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {faqs.map((faq, index) => (
              <motion.article
                key={faq.question}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.06 * index }}
                className="rounded-3xl border border-border bg-card p-8"
              >
                <h3 className="text-xl font-bold text-foreground">{faq.question}</h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">{faq.answer}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-12 md:px-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
          <Link to="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            <img src={BRAND_ICON_URL} alt="MacClipper" className="h-8 w-8 rounded-lg" />
            <span className="font-bold text-foreground">MacClipper</span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/support" className="transition-colors hover:text-foreground">Support</Link>
            <Link to="/bot-hosting" className="transition-colors hover:text-foreground">Bot Hosting</Link>
            <a href="/buy-4k.html" className="transition-colors hover:text-foreground">4K</a>
            <span>© 2026 MacClipper. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Home;