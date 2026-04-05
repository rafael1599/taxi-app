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

interface ActiveRide {
  id: string;
  status: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  pickupAddress: string;
  dropoffAddress: string;
  driverId: string | null;
}

const RIDE_STATUS_COLORS: Record<string, string> = {
  requested: '#ea580c',
  searching_driver: '#d97706',
  accepted: '#2563eb',
  en_route: '#7c3aed',
  arrived: '#0891b2',
  picked_up: '#0891b2',
  in_progress: '#0891b2',
};

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);
  const markers = useRef<Record<string, unknown>>({});
  const rideMarkers = useRef<Record<string, unknown[]>>({});
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [rides, setRides] = useState<ActiveRide[]>([]);
  const [mapError, setMapError] = useState('');
  const [showRides, setShowRides] = useState(true);

  useEffect(() => {
    let L: typeof import('leaflet');
    let interval: ReturnType<typeof setInterval>;

    async function init() {
      try {
        L = (await import('leaflet')).default;

        delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });

        if (!mapRef.current || leafletMap.current) return;

        const map = L.map(mapRef.current).setView([41.15, -74.01], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '\u00a9 OpenStreetMap contributors',
        }).addTo(map);
        leafletMap.current = map;

        const createCircleIcon = (color: string, label: string) => {
          return L.divIcon({
            className: '',
            html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">${label}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });
        };

        const refresh = async () => {
          const [driversRes, ridesRes] = await Promise.all([
            api.get<LiveDriver[]>('/admin/drivers/live'),
            api
              .get('/admin/rides', { params: { status: 'requested' } })
              .then((r) => r.data as ActiveRide[])
              .catch(() => [] as ActiveRide[]),
          ]);

          // Also fetch active statuses
          const activeRides: ActiveRide[] = [];
          for (const st of [
            'searching_driver',
            'accepted',
            'en_route',
            'arrived',
            'picked_up',
            'in_progress',
          ]) {
            try {
              const { data } = await api.get('/admin/rides', { params: { status: st } });
              activeRides.push(...data);
            } catch {
              /* ignore */
            }
          }
          activeRides.push(...ridesRes);

          setDrivers(driversRes.data);
          setRides(activeRides);

          if (!leafletMap.current) return;
          const m = leafletMap.current as import('leaflet').Map;

          // Update driver markers
          const activeIds = new Set(driversRes.data.map((d) => d.id));
          for (const id of Object.keys(markers.current)) {
            if (!activeIds.has(id)) {
              (markers.current[id] as import('leaflet').Marker).remove();
              delete markers.current[id];
            }
          }

          for (const driver of driversRes.data) {
            if (driver.currentLat == null || driver.currentLng == null) continue;
            if (markers.current[driver.id]) {
              (markers.current[driver.id] as import('leaflet').Marker).setLatLng([
                driver.currentLat,
                driver.currentLng,
              ]);
            } else {
              const icon = createCircleIcon('#2563eb', driver.fullName.charAt(0));
              const popupContent = document.createElement('div');
              const nameEl = document.createElement('strong');
              nameEl.textContent = driver.fullName;
              const phoneEl = document.createElement('span');
              phoneEl.textContent = driver.phone;
              const statusEl = document.createElement('div');
              statusEl.style.fontSize = '12px';
              statusEl.style.color = '#64748b';
              statusEl.textContent = driver.isAvailable ? 'Available' : 'On trip';
              popupContent.appendChild(nameEl);
              popupContent.appendChild(document.createElement('br'));
              popupContent.appendChild(phoneEl);
              popupContent.appendChild(statusEl);
              markers.current[driver.id] = L.marker([driver.currentLat, driver.currentLng], {
                icon,
              })
                .bindPopup(popupContent)
                .addTo(m);
            }
          }

          // Update ride markers
          for (const markArr of Object.values(rideMarkers.current)) {
            for (const mk of markArr as import('leaflet').Marker[]) mk.remove();
          }
          rideMarkers.current = {};

          if (showRides) {
            for (const ride of activeRides) {
              const color = RIDE_STATUS_COLORS[ride.status] ?? '#94a3b8';
              const pickupIcon = L.divIcon({
                className: '',
                html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6],
              });
              const dropoffIcon = L.divIcon({
                className: '',
                html: `<div style="width:10px;height:10px;border-radius:2px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
                iconSize: [10, 10],
                iconAnchor: [5, 5],
              });

              const rideMarkersArr: import('leaflet').Marker[] = [];
              if (ride.pickupLat && ride.pickupLng) {
                const pm = L.marker([ride.pickupLat, ride.pickupLng], { icon: pickupIcon })
                  .bindPopup(
                    `<b>Pickup</b><br>${ride.pickupAddress}<br><small>${ride.status.replace('_', ' ')}</small>`,
                  )
                  .addTo(m);
                rideMarkersArr.push(pm);
              }
              if (ride.dropoffLat && ride.dropoffLng) {
                const dm = L.marker([ride.dropoffLat, ride.dropoffLng], { icon: dropoffIcon })
                  .bindPopup(`<b>Dropoff</b><br>${ride.dropoffAddress}`)
                  .addTo(m);
                rideMarkersArr.push(dm);
              }
              rideMarkers.current[ride.id] = rideMarkersArr;
            }
          }
        };

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
  }, [showRides]);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Live Dispatch Map</h1>
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 14, color: '#64748b' }}>
          {drivers.length} driver{drivers.length !== 1 ? 's' : ''} online
        </div>
        <div style={{ fontSize: 14, color: '#64748b' }}>
          {rides.length} active ride{rides.length !== 1 ? 's' : ''}
        </div>
        <label
          style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={showRides}
            onChange={(e) => setShowRides(e.target.checked)}
          />
          Show rides
        </label>
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#64748b' }}>
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#2563eb',
                marginRight: 4,
              }}
            />
            Drivers
          </span>
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#ea580c',
                marginRight: 4,
              }}
            />
            Pickup
          </span>
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                background: '#ea580c',
                marginRight: 4,
              }}
            />
            Dropoff
          </span>
        </div>
      </div>
      {mapError && <p style={{ color: '#ef4444', marginBottom: 12 }}>{mapError}</p>}
      <div
        ref={mapRef}
        style={{
          height: 550,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 1px 8px rgba(0,0,0,.1)',
        }}
      />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </div>
  );
}
