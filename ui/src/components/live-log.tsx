import { ArrowDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Segmented } from './ui/segmented';

/**
 * A job's log, streamed live over server-sent events. Auto-scroll follows new lines until you scroll up,
 * then offers "Jump to latest". Lines can be filtered to warnings and errors.
 */
export function LiveLog({ jobId, className, height = 'h-80' }: { jobId: number; className?: string; height?: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [ended, setEnded] = useState(false);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState<'all' | 'problems'>('all');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([]); setEnded(false);
    const es = new EventSource(`/api/jobs/${jobId}/log`);
    const buf: string[] = [];
    let raf = 0;
    const flush = () => { raf = 0; setLines((l) => { const next = l.concat(buf.splice(0)); return next.length > 4000 ? next.slice(-4000) : next; }); };
    es.onmessage = (e) => { buf.push(e.data); if (!raf) raf = requestAnimationFrame(flush); };
    es.addEventListener('end', () => { setEnded(true); es.close(); });
    es.onerror = () => { es.close(); setEnded(true); };
    return () => { es.close(); if (raf) cancelAnimationFrame(raf); };
  }, [jobId]);

  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines, follow]);
  const onScroll = () => { const b = box.current; if (!b) return; setFollow(b.scrollHeight - b.scrollTop - b.clientHeight < 24); };
  const shown = filter === 'all' ? lines : lines.filter((l) => /warn|error|fail|✗|❌/i.test(l));

  return (
    <div className={cn('relative', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Segmented size="sm" label="Log lines" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All', count: lines.length }, { value: 'problems', label: 'Problems' }]} />
        <span className="text-xs text-fg-3">{ended ? 'Finished' : 'Live'}</span>
      </div>
      <div ref={box} onScroll={onScroll} role="log" aria-live="off" className={cn('overflow-auto glass rounded-card p-3 font-mono text-xs leading-5 text-fg-2', height)}>
        {shown.length ? shown.map((l, i) => <div key={i} className={cn('break-words whitespace-pre-wrap', /error|fail/i.test(l) && 'text-bad', /warn/i.test(l) && 'text-warn')}>{l}</div>)
          : <p className="text-fg-3">{ended ? 'No log lines.' : 'Waiting for output…'}</p>}
      </div>
      {!follow ? (
        <button type="button" onClick={() => setFollow(true)} className="absolute right-3 bottom-3 inline-flex h-7 items-center gap-1 glass-strong rounded-full px-2.5 text-xs text-fg">
          <ArrowDown className="size-3" aria-hidden /> Jump to latest
        </button>
      ) : null}
    </div>
  );
}
