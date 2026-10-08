import { ApiError } from '../../api';
import { Notice } from './notice';
import { Empty } from './empty';

/** The error state for a view. Unreachable-server errors are explained by the global banner, so they render nothing here. */
export function ErrorState({ error, what = 'this', className }: { error: unknown; what?: string; className?: string }) {
  if (error instanceof ApiError && error.unreachable) return null;
  if (error instanceof ApiError && error.status === 404) return <Empty className={className}>No {what} found. It may have been removed, or the link is wrong.</Empty>;
  return <Notice tone="bad" title={`Couldn't load ${what}`} className={className}>{(error as Error)?.message}</Notice>;
}
