import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { Skeleton } from './skeleton';

/** Markdown text, rendered and sanitised. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }) as string), [text]);
  return <div className={cn('md', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A markdown file fetched by URL. `version` refetches when the file changes. */
export function MarkdownFile({ url, version, className }: { url: string; version?: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setErr(null);
    fetch(url, { cache: 'no-store' }).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
      .then((t) => { if (live) setText(t); }).catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [url, version]);
  if (err) return <p className="p-4 text-sm text-fg-3">Couldn't load this document ({err}).</p>;
  if (text === null) return <div className="flex flex-col gap-2 p-4"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /></div>;
  return <Markdown text={text} className={className} />;
}
