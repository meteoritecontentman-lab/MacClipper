import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

function ActionMenu({ label = 'Clip actions', items = [] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const visibleItems = items.filter((item) => item && typeof item.onSelect === 'function');

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((currentValue) => !currentValue)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={label}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-30 max-h-72 min-w-[11rem] overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-xl">
          {visibleItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={[
                'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted',
                item.destructive ? 'text-destructive' : 'text-foreground'
              ].join(' ')}
            >
              <span className="inline-flex items-center gap-2">
                {item.icon ? <item.icon className="h-4 w-4" /> : null}
                <span>{item.label}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ActionMenu;