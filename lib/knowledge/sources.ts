import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NexusState } from "../domain/state";
import { currencyCode, operatingTimezone } from "../domain/locale";

// ---------------------------------------------------------------------------
// Knowledge sources: canonical records rendered as plain text, and supplied
// ops documents split into sections. Every document carries where it came
// from (sourceType + sourceId), an `asOf` timestamp and a content hash, so
// a retrieved passage can always be cited and re-verified against the live
// source before it is used in an answer.
// ---------------------------------------------------------------------------

export type KnowledgeSourceType =
  | "shipment"
  | "driver"
  | "vehicle"
  | "facility"
  | "exception"
  | "approval"
  | "agentRun"
  | "policy"
  | "opsDoc";

export interface KnowledgeDoc {
  /** Unique within an index: `${sourceType}:${sourceId}` (ops docs add `#section`). */
  key: string;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  title: string;
  text: string;
  /** When the cited fact was last true at the source. */
  asOf: string;
  /** What asOf is: the record's own timestamp, or the snapshot time for records without one. */
  asOfBasis: "record" | "snapshot" | "file";
  hash: string;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function nameOf<T extends { name: string }>(map: Map<string, T>, id: string | null): string {
  if (!id) return "unassigned";
  const v = map.get(id);
  return v ? `${v.name} (${id})` : id;
}

type Rendered = Omit<KnowledgeDoc, "key" | "hash" | "sourceType" | "sourceId">;

const RENDERERS: Record<Exclude<KnowledgeSourceType, "opsDoc">, {
  ids: (s: NexusState) => string[];
  render: (s: NexusState, id: string, snapshotAt: string) => Rendered | null;
}> = {
  shipment: {
    ids: (s) => Array.from(s.shipments.keys()),
    render: (s, id) => {
      const x = s.shipments.get(id);
      if (!x) return null;
      const appt = x.appointment
        ? `Appointment at ${nameOf(s.facilities, x.appointment.facilityId)} from ${x.appointment.start} to ${x.appointment.end}, status ${x.appointment.status}.`
        : "No facility appointment.";
      return {
        title: `Shipment ${x.id} (${x.referenceCode})`,
        text:
          `Shipment ${x.id}, reference ${x.referenceCode}, for customer ${x.customerName}. Status ${x.status}, priority ${x.priority}. ` +
          `From ${nameOf(s.facilities, x.originFacilityId)} to ${nameOf(s.facilities, x.destinationFacilityId)}, ${x.distanceKm} km, ${x.weightKg} kg. ` +
          `Driver ${nameOf(s.drivers, x.driverId)}, vehicle ${x.vehicleId ?? "unassigned"}. ` +
          `Delivery window ${x.deliveryWindowStart} to ${x.deliveryWindowEnd}. Scheduled ETA ${x.scheduledEta}, current ETA ${x.currentEta}. ${appt}`,
        asOf: x.updatedAt,
        asOfBasis: "record",
      };
    },
  },
  driver: {
    ids: (s) => Array.from(s.drivers.keys()),
    render: (s, id, snapshotAt) => {
      const d = s.drivers.get(id);
      if (!d) return null;
      return {
        title: `Driver ${d.id} (${d.name})`,
        text:
          `Driver ${d.id} ${d.name}, home facility ${nameOf(s.facilities, d.homeFacilityId)}. Status ${d.status}. ` +
          `Hours of service remaining ${d.hoursOfServiceRemaining}. On-time rating ${Math.round(d.onTimeRating * 100)} percent. ` +
          `Vehicle ${d.vehicleId ?? "none"}. Assigned shipments: ${d.assignedShipmentIds.length ? d.assignedShipmentIds.join(", ") : "none"}.`,
        asOf: snapshotAt,
        asOfBasis: "snapshot",
      };
    },
  },
  vehicle: {
    ids: (s) => Array.from(s.vehicles.keys()),
    render: (s, id, snapshotAt) => {
      const v = s.vehicles.get(id);
      if (!v) return null;
      return {
        title: `Vehicle ${v.id}`,
        text: `Vehicle ${v.id}, type ${v.type}, capacity ${v.capacityKg} kg, status ${v.status}, current driver ${nameOf(s.drivers, v.currentDriverId)}.`,
        asOf: snapshotAt,
        asOfBasis: "snapshot",
      };
    },
  },
  facility: {
    ids: (s) => Array.from(s.facilities.keys()),
    render: (s, id, snapshotAt) => {
      const f = s.facilities.get(id);
      if (!f) return null;
      return {
        title: `Facility ${f.id} (${f.name})`,
        text:
          `Facility ${f.id} ${f.name}, a ${f.type.replace(/_/g, " ").toLowerCase()} in ${f.city}, ${f.state}. ` +
          `Operating hours ${f.operatingHoursStart}:00 to ${f.operatingHoursEnd}:00 local time (${operatingTimezone()}).`,
        asOf: snapshotAt,
        asOfBasis: "snapshot",
      };
    },
  },
  exception: {
    ids: (s) => Array.from(s.exceptions.keys()),
    render: (s, id) => {
      const e = s.exceptions.get(id);
      if (!e) return null;
      return {
        title: `Exception ${e.id} on ${e.shipmentId}`,
        text:
          `Exception ${e.id} on shipment ${e.shipmentId}: ${e.type.replace(/_/g, " ").toLowerCase()} delay, severity ${e.severity}, status ${e.status}, ETA impact ${e.etaImpactMin} minutes. ` +
          `${e.description} Detected ${e.detectedAt}.` +
          (e.resolutionSummary ? ` Resolution: ${e.resolutionSummary}` : "") +
          (e.agentRunId ? ` Handled by agent run ${e.agentRunId}.` : ""),
        asOf: e.resolvedAt ?? e.detectedAt,
        asOfBasis: "record",
      };
    },
  },
  approval: {
    ids: (s) => Array.from(s.approvals.keys()),
    render: (s, id) => {
      const a = s.approvals.get(id);
      if (!a) return null;
      return {
        title: `Approval ${a.id} (${a.status})`,
        text:
          `Approval ${a.id} for ${a.actionType.replace(/_/g, " ").toLowerCase()} on shipment ${a.shipmentId}, status ${a.status}. ${a.summary}. ` +
          `What will happen: ${a.whatWillHappen} Why: ${a.why} Estimated cost ${a.estimatedCost} ${currencyCode()}.` +
          (a.resolvedBy ? ` Decided by ${a.resolvedBy} at ${a.resolvedAt}.` : " Awaiting a human decision."),
        asOf: a.resolvedAt ?? a.createdAt,
        asOfBasis: "record",
      };
    },
  },
  agentRun: {
    ids: (s) => Array.from(s.agentRuns.keys()),
    render: (s, id) => {
      const r = s.agentRuns.get(id);
      if (!r) return null;
      return {
        title: `Agent run ${r.id} (${r.agentType})`,
        text:
          `Agent run ${r.id}, ${r.agentType.replace(/_/g, " ").toLowerCase()} agent, triggered by ${r.triggerEventType} on shipment ${r.shipmentId ?? "none"}. ` +
          `Status ${r.status}. Selected action ${r.selectedActionType ?? "none"} at autonomy level ${r.autonomyLevel ?? "n/a"}.` +
          (r.outcomeSummary ? ` Outcome: ${r.outcomeSummary}` : ""),
        asOf: r.completedAt ?? r.startedAt,
        asOfBasis: "record",
      };
    },
  },
  policy: {
    ids: (s) => Array.from(s.policies.keys()),
    render: (s, id, snapshotAt) => {
      const p = s.policies.get(id);
      if (!p) return null;
      return {
        title: `Policy ${p.label}`,
        text:
          `Policy ${p.id} for ${p.actionType.replace(/_/g, " ").toLowerCase()} (${p.label}): autonomy level ${p.autonomyLevel}, ` +
          `${p.maxCost === null ? "no cost threshold" : `cost threshold ${p.maxCost} ${currencyCode()}`}. ${p.description}`,
        asOf: snapshotAt,
        asOfBasis: "snapshot",
      };
    },
  },
};

export const RECORD_SOURCE_TYPES = Object.keys(RENDERERS) as Array<Exclude<KnowledgeSourceType, "opsDoc">>;

function finish(sourceType: KnowledgeSourceType, sourceId: string, r: Rendered, keySuffix = ""): KnowledgeDoc {
  return { key: `${sourceType}:${sourceId}${keySuffix}`, sourceType, sourceId, ...r, hash: hashText(r.text) };
}

/** Render every canonical record in the working set. */
export function recordDocs(state: NexusState, snapshotAt: string): KnowledgeDoc[] {
  const out: KnowledgeDoc[] = [];
  for (const type of RECORD_SOURCE_TYPES) {
    for (const id of RENDERERS[type].ids(state)) {
      const r = RENDERERS[type].render(state, id, snapshotAt);
      if (r) out.push(finish(type, id, r));
    }
  }
  return out;
}

/** Re-render one record from the live working set; null when it no longer exists. */
export function renderLiveRecord(state: NexusState, type: Exclude<KnowledgeSourceType, "opsDoc">, id: string): string | null {
  return RENDERERS[type].render(state, id, "")?.text ?? null;
}

// -- Ops documents ------------------------------------------------------------

/** Split markdown into sections at headings; each section becomes one passage. */
export function splitMarkdown(markdown: string): Array<{ heading: string; body: string }> {
  const lines = markdown.split(/\r?\n/);
  const sections: Array<{ heading: string; body: string }> = [];
  let heading = "Introduction";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };
  for (const line of lines) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

export function opsDocFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => (f.endsWith(".md") || f.endsWith(".txt")) && f.toLowerCase() !== "readme.md")
    .sort()
    .map((f) => path.join(dir, f));
}

function sectionSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function opsDocsFrom(dir: string): KnowledgeDoc[] {
  const out: KnowledgeDoc[] = [];
  for (const file of opsDocFiles(dir)) {
    const name = path.basename(file);
    const asOf = fs.statSync(file).mtime.toISOString();
    const content = fs.readFileSync(file, "utf8");
    for (const { heading, body } of splitMarkdown(content)) {
      const slug = sectionSlug(heading);
      out.push(finish("opsDoc", name, { title: `${name} § ${heading}`, text: `${heading}. ${body}`, asOf, asOfBasis: "file" }, `#${slug}`));
    }
  }
  return out;
}

/** Re-read an ops-doc section from disk; null when the file or section is gone. */
export function renderLiveOpsSection(dir: string, fileName: string, key: string): string | null {
  const file = path.join(dir, fileName);
  if (!fs.existsSync(file)) return null;
  const slug = key.split("#")[1] ?? "";
  for (const { heading, body } of splitMarkdown(fs.readFileSync(file, "utf8"))) {
    if (sectionSlug(heading) === slug) return `${heading}. ${body}`;
  }
  return null;
}
