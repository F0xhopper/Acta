import { describe, expect, it } from 'vitest';
import { mapEmbedUrl } from '../src/kit/map';

describe('map embed', () => {
  it('pins by name and address, falls back to coordinates, else nothing', () => {
    expect(mapEmbedUrl({ name: "Oslo's Barbers", address: '286 Stratford Rd, Birmingham B11 1AA', postcode: 'B11 1AA', maps_url: null }))
      .toBe("https://maps.google.com/maps?q=Oslo's%20Barbers%2C%20286%20Stratford%20Rd%2C%20Birmingham%20B11%201AA&z=16&output=embed");
    expect(mapEmbedUrl({ name: '', address: null, postcode: null, lat: 52.45, lng: -1.88, maps_url: null })).toContain('q=52.45%2C-1.88');
    expect(mapEmbedUrl({ name: '', address: null, postcode: null, maps_url: null })).toBeNull();
  });
});
