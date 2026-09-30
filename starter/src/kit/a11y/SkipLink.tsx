// Managed by Acta. Do not edit. Unstyled beyond focus: see kit.css.
export function SkipLink({ target = '#main', children = 'Skip to content' }: { target?: string; children?: React.ReactNode }) {
  return <a href={target} className="kit-skip-link">{children}</a>;
}
