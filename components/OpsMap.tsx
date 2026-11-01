import type { Facility, Shipment } from "@/lib/domain/types";

const W = 640;
const H = 360;
const PAD = 48;

/**
 * Fit the facilities into the frame, whatever region the network is in.
 * Longitude is scaled by cos(latitude) so distances keep their proportions.
 */
function makeProjection(facilities: Facility[]): (lat: number, lng: number) => [number, number] {
  if (facilities.length === 0) return () => [W / 2, H / 2];
  const lats = facilities.map((f) => f.location.lat);
  const lngs = facilities.map((f) => f.location.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = lngs.map((l) => l * k);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const scale = Math.min((W - PAD * 2) / Math.max(maxX - minX, 1e-6), (H - PAD * 2) / Math.max(maxY - minY, 1e-6));
  const offX = (W - (maxX - minX) * scale) / 2;
  const offY = (H - (maxY - minY) * scale) / 2;
  return (lat, lng) => [offX + (lng * k - minX) * scale, offY + (maxY - lat) * scale];
}

export default function OpsMap({ facilities, shipments }: { facilities: Facility[]; shipments: Shipment[] }) {
  const facilityMap = new Map(facilities.map((f) => [f.id, f]));
  const project = makeProjection(facilities);
  const routeShipments = shipments.filter(
    (s) => s.status === "IN_TRANSIT" || s.status === "EXCEPTION"
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Operational route map">
      <rect x={0} y={0} width={W} height={H} rx={10} fill="var(--bg-panel-alt)" />
      {routeShipments.map((s) => {
        const o = facilityMap.get(s.originFacilityId);
        const d = facilityMap.get(s.destinationFacilityId);
        if (!o || !d) return null;
        const [x1, y1] = project(o.location.lat, o.location.lng);
        const [x2, y2] = project(d.location.lat, d.location.lng);
        const exception = s.status === "EXCEPTION";
        return (
          <line
            key={s.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={exception ? "var(--danger)" : "var(--accent)"}
            strokeWidth={exception ? 2.25 : 1.25}
            strokeOpacity={exception ? 0.85 : 0.35}
            strokeDasharray={exception ? "5 3" : undefined}
          />
        );
      })}
      {facilities.map((f) => {
        const [x, y] = project(f.location.lat, f.location.lng);
        const count = shipments.filter((s) => s.originFacilityId === f.id || s.destinationFacilityId === f.id).length;
        const r = 5 + Math.min(10, count / 6);
        return (
          <g key={f.id}>
            <circle cx={x} cy={y} r={r} fill="var(--bg-panel)" stroke="var(--accent)" strokeWidth={2} />
            <text x={x} y={y - r - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">
              {f.city}
            </text>
            <text x={x} y={y + r + 14} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {count} shipments
            </text>
          </g>
        );
      })}
    </svg>
  );
}
