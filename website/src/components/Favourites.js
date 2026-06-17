import React, { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { hydrateClipsWithSharedLinks } from '../lib/cloudSharedClips';
import ClipCard from './ClipCard';

function Favourites({ currentUser = null, authResolved = false }) {
  const [favourites, setFavourites] = useState([]);
  const user = authResolved ? currentUser : undefined;

  useEffect(() => {
    if (!authResolved) {
      return;
    }

    if (currentUser?.id) {
      fetchFavourites(currentUser.id);
      return;
    }

    setFavourites([]);
  }, [authResolved, currentUser]);

  const fetchFavourites = async (userId) => {
    const { data, error } = await supabase
      .from('favourites')
      .select('clips(*)')
      .eq('user_id', userId);
    if (error) console.error('Error fetching favourites:', error);
    else {
      const clipRows = data.map((fav) => fav.clips).filter(Boolean);
      const hydratedClips = await hydrateClipsWithSharedLinks(clipRows).catch((resolveError) => {
        console.error('Error resolving shared clip links for favourites:', resolveError);
        return clipRows;
      });
      setFavourites(hydratedClips);
    }
  };

  if (user === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-heading">Favorites</h1>
        <p className="page-subtitle">Your starred clips in one place.</p>
      </div>

      {favourites.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          <Star className="mx-auto mb-4 h-16 w-16 opacity-20" />
          <p className="text-lg font-semibold">No favorites yet</p>
          <p className="mt-1 text-sm">Star a clip to add it here.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {favourites.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              isFavorite={true}
              onToggleFavorite={() => {
                setFavourites((existingClips) => existingClips.filter((item) => item.id !== clip.id));
                supabase.from('favourites').delete().eq('clip_id', clip.id).eq('user_id', user.id).then(({ error }) => {
                  if (error) {
                    console.error('Error removing favourite:', error);
                    fetchFavourites(user.id);
                  }
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default Favourites;