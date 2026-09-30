// Managed by Acta. Do not edit.
export function VisuallyHidden({ children, as: Tag = 'span' }: { children: React.ReactNode; as?: 'span' | 'div' | 'label' }) {
  return <Tag className="kit-visually-hidden">{children}</Tag>;
}
