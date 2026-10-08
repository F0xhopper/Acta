import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import type { Device } from '../../../../src/ui/api-types';
import { ButtonA } from '../../components/ui/button';

export const DEVICE_SIZE: Record<Device, { w: number; h: number; label: string }> = {
  mobile: { w: 390, h: 844, label: 'Phone' },
  tablet: { w: 820, h: 1180, label: 'Tablet' },
  desktop: { w: 1440, h: 900, label: 'Desktop' },
};

/** How much to shrink a frame of `frameWidth` to fit `available` pixels. Never enlarges. */
export function fitScale(available: number, frameWidth: number): number {
  if (available <= 0 || frameWidth <= 0) return 1;
  return Math.min(1, available / frameWidth);
}

/** The live preview in a sandboxed frame at the device's width, scaled down to fit. */
export function LiveFrame({ url, device, path }: { url: string; device: Device; path: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = DEVICE_SIZE[device];
  const scale = fitScale(avail, size.w);
  const src = url.replace(/\/$/, '') + (path === '/' ? '/' : path);

  return (
    <div className="flex flex-col gap-4">
      <div ref={wrap} className="w-full">
        <div className="glass mx-auto overflow-hidden rounded-[22px] p-2" style={{ width: size.w * scale + 16 }}>
          <div className="overflow-hidden rounded-[16px] bg-white" style={{ width: size.w * scale, height: size.h * scale }}>
            <iframe key={`${device}-${src}`} title={`Live preview, ${size.label.toLowerCase()}`} src={src}
              sandbox="allow-scripts allow-same-origin allow-forms" loading="lazy"
              style={{ width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: 'top left', border: 0 }} />
          </div>
        </div>
      </div>
      <div className="glass flex flex-wrap items-center gap-4 rounded-card p-4">
        <div className="rounded-[10px] bg-white p-2"><QRCode value={src} size={88} aria-label="QR code for the preview" /></div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="text-fg">Open it on your phone</p>
          <p className="mt-0.5 text-fg-3">Scan the code, or open it in a new tab. If the frame stays blank, the site refuses to be framed: use the new tab.</p>
          <p className="mt-1 truncate font-mono text-xs text-fg-3">{src}</p>
        </div>
        <ButtonA href={src} variant="secondary" size="sm"><ExternalLink className="size-3.5" aria-hidden />Open in new tab</ButtonA>
      </div>
    </div>
  );
}
