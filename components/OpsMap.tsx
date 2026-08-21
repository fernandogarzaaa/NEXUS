import type { Facility, Shipment } from "@/lib/domain/types";

const LAT_MIN = 29.2;
const LAT_MAX = 33.0;
const LNG_MIN = -98.7;
const LNG_MAX = -95.1;
const W = 640;
const H = 360;
const PAD = 40;

function project(lat: number, lng: number): [number, number] {
  const x = PAD + ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * (W - PAD * 2);
  const y = PAD + (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * (H - PAD * 2);
  return [x, y];
}

export default function OpsMap({ facilities, shipments }: { facilities: Facility[]; shipments: Shipment[] }) {
  const facilityMap = new Map(facilities.map((f) => [f.id, f]));
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
            <text x={x} y={y - r - 6 + 12} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
              {count} shipments
            </text>
          </g>
        );
      })}
    </svg>
  );
}
