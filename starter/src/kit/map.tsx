'use client';
/**
 * Managed by Acta. Do not edit.
 *
 * A Google map of the business, loaded only when someone asks for it. An iframe map costs about 1 MB and a
 * second of main-thread time, which would sink Lighthouse performance, so the page ships a lightweight facade
 * (styled by the site) and swaps in the real map on tap. No API key: the public embed URL is used, with the
 * business name and address so the pin lands on the listing.
 *
 * Usage:  <MapEmbed business={site.business} className="..." facadeClassName="..." label="Show the map" />
 * The site styles the facade however the design wants; the component only guarantees behaviour and a11y.
 * The `data-acta-map` attribute is how the map gate finds it.
 */
import { useState, type ReactNode } from 'react';

export interface MapBusiness { name: string; address: string | null; postcode: string | null; lat?: number | null; lng?: number | null; maps_url: string | null }

export function mapEmbedUrl(b: MapBusiness): string | null {
  const q = [b.name, b.address].filter(Boolean).join(', ') || (b.lat != null && b.lng != null ? `${b.lat},${b.lng}` : null);
  if (!q) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`;
}

export function MapEmbed({ business, className, facadeClassName, label = 'Show the map', height = 360, children }: {
  business: MapBusiness; className?: string; facadeClassName?: string; label?: string; height?: number; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const src = mapEmbedUrl(business);
  if (!src) return null;
  return (
    <div data-acta-map="" className={className} style={{ position: 'relative', minHeight: height }}>
      {open ? (
        <iframe
          title={`Map showing ${business.name}`}
          src={src}
          width="100%"
          height={height}
          style={{ border: 0, display: 'block', width: '100%', height }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={facadeClassName} style={{ width: '100%', minHeight: height, cursor: 'pointer' }} aria-label={`${label}: ${business.name}${business.address ? `, ${business.address}` : ''}`}>
          {children ?? label}
        </button>
      )}
      {business.maps_url ? (
        <a href={business.maps_url} target="_blank" rel="noopener noreferrer" data-acta-directions="" style={{ display: 'inline-block', marginTop: 8 }}>
          Open in Google Maps
        </a>
      ) : null}
    </div>
  );
}
