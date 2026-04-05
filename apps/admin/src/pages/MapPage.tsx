import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

interface LiveDriver {
  id: string;
  fullName: string;
  phone: string;
  currentLat: number | null;
  currentLng: number | null;
  locationAt: string | null;
  isAvailable: boolean;
}

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);
  const markers = useRef<Record<string, unknown>>({});
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [mapError, setMapError] = useState('');

  useEffect(() => {
    let L: typeof import('leaflet');
    let interval: ReturnType<typeof setInterval>;

    async function init() {
      try {
        L = (await import('leaflet')).default;

        // Fix default icon paths for bundlers
        delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });

        if (!mapRef.current || leafletMap.current) return;

        // Rockland County, NY center
        const map = L.map(mapRef.current).setView([41.15, -74.01], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '\u00a9 OpenStreetMap contributors',
        }).addTo(map);
        leafletMap.current = map;

        async function refresh() {
          const { data } = await api.get<LiveDriver[]>('/admin/drivers/live');
          setDrivers(data);

          if (!leafletMap.current) return;
          const map = leafletMap.current as import('leaflet').Map;

          // Remove stale markers
          const activeIds = new Set(data.map((d) => d.id));
          for (const id of Object.keys(markers.current)) {
            if (!activeIds.has(id)) {
              (markers.current[id] as import('leaflet').Marker).remove();
              delete markers.current[id];
            }
          }

          // Add/update markers
          for (const driver of data) {
            if (driver.currentLat == null || driver.currentLng == null) continue;
            if (markers.current[driver.id]) {
              (markers.current[driver.id] as import('leaflet').Marker).setLatLng([driver.currentLat, driver.currentLng]);
            } else {
              const popupContent = document.createElement('div');
              const nameEl = document.createElement('strong');
              nameEl.textContent = driver.fullName;
              const phoneEl = document.createElement('span');
              phoneEl.textContent = driver.phone;
              popupContent.appendChild(nameEl);
              popupContent.appendChild(document.createElement('br'));
              popupContent.appendChild(phoneEl);
              markers.current[driver.id] = L.marker([driver.currentLat, driver.currentLng])
                .bindPopup(popupContent)
                .addTo(map);
            }
          }
        }

        await refresh();
        interval = setInterval(refresh, 10_000);
      } catch {
        setMapError('Failed to load map');
      }
    }

    init();
    return () => {
      clearInterval(interval);
      if (leafletMap.current) {
        (leafletMap.current as import('leaflet').Map).remove();
        leafletMap.current = null;
      }
    };
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Live Driver Map</h1>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 14, color: '#64748b' }}>
          {drivers.length} active driver{drivers.length !== 1 ? 's' : ''} online
        </div>
      </div>
      {mapError && <p style={{ color: '#ef4444', marginBottom: 12 }}>{mapError}</p>}
      <div
        ref={mapRef}
        style={{ height: 500, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,.1)' }}
      />
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />
    </div>
  );
}
