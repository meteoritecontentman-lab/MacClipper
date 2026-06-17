import React, { useRef, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Star, Pin, Copy, Trash2, Clipboard, Link as LinkIcon, Code, Image, File, Play, Monitor } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const typeIcons = {
  text: Clipboard,
  link: LinkIcon,
  code: Code,
  image: Image,
  file: File,
  video: Play,
  macclipper: Monitor, // MacClipper icon for screen recordings
};

function isVideoUrl(url) {
  return typeof url === 'string' && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
}

function isImageUrl(url) {
  return typeof url === 'string' && /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(url);
}

function VideoThumbnail({ url }) {
  const videoRef = useRef(null);
  const [thumb, setThumb] = useState(null);

  React.useEffect(() => {
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.currentTime = 1;
    video.muted = true;
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 180;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumb(canvas.toDataURL('image/jpeg'));
    };
  }, [url]);

  return (
    <div className="relative w-full h-40 rounded-lg overflow-hidden bg-black/10">
      {thumb ? (
        <img src={thumb} alt="Video thumbnail" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <Play className="w-10 h-10 text-muted-foreground opacity-40" />
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
          <Play className="w-5 h-5 text-white ml-0.5" />
        </div>
      </div>
      <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
        {url.match(/\.(\w+)(\?|$)/i)?.[1]?.toUpperCase()}
      </div>
    </div>
  );
}

export default function ClipCard({ clip }) {
  const queryClient = useQueryClient();
  const isVideo = isVideoUrl(clip.content);
  const isImage = isImageUrl(clip.content);
  const isMacClipper = clip.clip_type === 'macclipper' || clip.source_app === 'MacClipper';
  const Icon = typeIcons[clip.clip_type] || Clipboard;

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Clip.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clips'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Clip.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      toast.success('Clip deleted');
    },
  });

  const copyToClipboard = () => {
    navigator.clipboard.writeText(clip.content);
    toast.success('Copied to clipboard');
  };

  return (
    <Card className="group hover:shadow-md hover:border-primary/20 transition-all duration-200">
      <CardContent className="p-4 space-y-3">
        {/* Video preview for MacClipper clips */}
        {(isVideo || isMacClipper) && <VideoThumbnail url={clip.content} />}

        {/* Image preview */}
        {isImage && !isVideo && !isMacClipper && (
          <div className="w-full h-40 rounded-lg overflow-hidden bg-muted">
            <img src={clip.content} alt="Clip" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Content row */}
        <div className="flex items-start gap-3">
          {!isVideo && !isImage && !isMacClipper && (
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Icon className="w-4 h-4 text-primary" />
            </div>
          )}
          {isMacClipper && (
            <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Monitor className="w-4 h-4 text-red-500" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground break-words line-clamp-3">
              {isVideo || isImage || isMacClipper ? (
                <span className="font-medium">
                  {isMacClipper ? 'Screen Recording' : 'Media Clip'}
                </span>
              ) : (
                clip.content
              )}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {clip.clip_type && (
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                  isMacClipper
                    ? 'bg-red-500/10 text-red-700'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {isMacClipper ? 'MacClipper' : clip.clip_type}
                </span>
              )}
              {clip.source_app && clip.source_app !== 'MacClipper' && (
                <span className="text-xs text-muted-foreground">{clip.source_app}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {clip.created_date && format(new Date(clip.created_date), 'MMM d, h:mm a')}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 pt-2 border-t border-border opacity-0 group-hover:opacity-100 transition-opacity">
          {(isVideo || isMacClipper) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => window.open(clip.content, '_blank')}
            >
              <Play className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyToClipboard}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${clip.is_favorite ? 'text-accent' : ''}`}
            onClick={() => updateMutation.mutate({ id: clip.id, data: { is_favorite: !clip.is_favorite } })}
          >
            <Star className={`w-3.5 h-3.5 ${clip.is_favorite ? 'fill-accent' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${clip.is_pinned ? 'text-primary' : ''}`}
            onClick={() => updateMutation.mutate({ id: clip.id, data: { is_pinned: !clip.is_pinned } })}
          >
            <Pin className={`w-3.5 h-3.5 ${clip.is_pinned ? 'fill-primary' : ''}`} />
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => deleteMutation.mutate(clip.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}