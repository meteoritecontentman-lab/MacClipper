import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clipboard, Star, Pin, Clock, Monitor } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { data: clips = [], isLoading } = useQuery({
    queryKey: ['clips'],
    queryFn: () => base44.entities.Clip.list('-created_date', 50),
  });

  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: () => base44.auth.me(),
  });

  const totalClips = clips.length;
  const favorites = clips.filter(c => c.is_favorite).length;
  const pinned = clips.filter(c => c.is_pinned).length;
  const macClipperClips = clips.filter(c => c.clip_type === 'macclipper' || c.source_app === 'MacClipper').length;
  const recentClips = clips.slice(0, 5);

  const stats = [
    { label: 'Total Clips', value: totalClips, icon: Clipboard, color: 'text-primary' },
    { label: 'MacClipper', value: macClipperClips, icon: Monitor, color: 'text-red-500' },
    { label: 'Favorites', value: favorites, icon: Star, color: 'text-accent' },
    { label: 'Pinned', value: pinned, icon: Pin, color: 'text-primary' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight">
          Welcome back{user?.full_name ? `, ${user.full_name}` : ''}
        </h1>
        <p className="text-muted-foreground mt-1">Here's your clipboard overview.</p>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <stat.icon className={`w-6 h-6 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Recent Clips */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-bold">Recent Clips</CardTitle>
          <Link to="/clips" className="text-sm text-primary font-medium hover:underline">
            View All →
          </Link>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recentClips.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clipboard className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No clips yet</p>
              <p className="text-sm mt-1">Connect your MacClipper app to start syncing clips.</p>
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <Monitor className="w-5 h-5 text-red-500 inline mr-2" />
                <span className="text-sm text-red-700">
                  <strong>MacClipper Integration:</strong> Add your API token in MacClipper Settings to enable cloud uploads.
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {recentClips.map((clip) => {
                const isMacClipperClip = clip.clip_type === 'macclipper' || clip.source_app === 'MacClipper';
                return (
                  <div
                    key={clip.id}
                    className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      isMacClipperClip ? 'bg-red-500/10' : 'bg-primary/10'
                    }`}>
                      {isMacClipperClip ? (
                        <Monitor className="w-4 h-4 text-red-500" />
                      ) : (
                        <Clipboard className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {isMacClipperClip ? 'Screen Recording' : clip.content}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {clip.clip_type && (
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                            isMacClipperClip
                              ? 'bg-red-500/10 text-red-700'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {isMacClipperClip ? 'MacClipper' : clip.clip_type}
                          </span>
                        )}
                        {clip.source_app && clip.source_app !== 'MacClipper' && (
                          <span className="text-xs text-muted-foreground">{clip.source_app}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {clip.is_favorite && <Star className="w-4 h-4 text-accent fill-accent" />}
                      <span className="text-xs text-muted-foreground">
                        {clip.created_date && format(new Date(clip.created_date), 'MMM d')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}