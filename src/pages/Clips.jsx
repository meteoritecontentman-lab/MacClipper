import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clipboard, Search } from 'lucide-react';
import ClipCard from '@/components/clips/ClipCard';

export default function Clips() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const { data: clips = [], isLoading } = useQuery({
    queryKey: ['clips'],
    queryFn: () => base44.entities.Clip.list('-created_date', 200),
  });

  const filtered = clips.filter((clip) => {
    const matchSearch = !search || clip.content?.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || clip.clip_type === typeFilter;
    return matchSearch && matchType;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight">My Clips</h1>
        <p className="text-muted-foreground mt-1">Browse and manage your clipboard history.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search clips..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="link">Link</SelectItem>
            <SelectItem value="code">Code</SelectItem>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="file">File</SelectItem>
            <SelectItem value="video">Video</SelectItem>
            <SelectItem value="macclipper">MacClipper</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Clips Grid */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Clipboard className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="font-semibold text-lg">No clips found</p>
          <p className="text-sm mt-1">
            {search ? 'Try a different search term.' : 'Connect MacClipper to start syncing clips.'}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </div>
      )}
    </div>
  );
}