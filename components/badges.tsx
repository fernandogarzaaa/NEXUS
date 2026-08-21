import type {
  AgentRunStatus,
  ApprovalStatus,
  AutonomyLevel,
  ExceptionSeverity,
  ExceptionStatus,
  ShipmentStatus,
} from "@/lib/domain/types";

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span className="badge" style={{ color, background: bg }}>
      {text}
    </span>
  );
}

const SEVERITY_STYLE: Record<ExceptionSeverity, [string, string]> = {
  LOW: ["#4b5563", "#eef0f3"],
  MEDIUM: ["var(--warn)", "var(--warn-soft)"],
  HIGH: ["var(--danger)", "var(--danger-soft)"],
  CRITICAL: ["var(--critical)", "var(--critical-soft)"],
};

export function SeverityBadge({ severity }: { severity: ExceptionSeverity }) {
  const [color, bg] = SEVERITY_STYLE[severity];
  return <Badge text={severity} color={color} bg={bg} />;
}

const EXCEPTION_STATUS_STYLE: Record<ExceptionStatus, [string, string]> = {
  OPEN: ["var(--danger)", "var(--danger-soft)"],
  IN_PROGRESS: ["var(--accent)", "var(--accent-soft)"],
  RESOLVED: ["var(--ok)", "var(--ok-soft)"],
  ESCALATED: ["var(--critical)", "var(--critical-soft)"],
};

export function ExceptionStatusBadge({ status }: { status: ExceptionStatus }) {
  const [color, bg] = EXCEPTION_STATUS_STYLE[status];
  return <Badge text={status.replace(/_/g, " ")} color={color} bg={bg} />;
}

const SHIPMENT_STATUS_STYLE: Record<ShipmentStatus, [string, string]> = {
  SCHEDULED: ["#4b5563", "#eef0f3"],
  IN_TRANSIT: ["var(--accent)", "var(--accent-soft)"],
  AT_FACILITY: ["var(--accent)", "var(--accent-soft)"],
  EXCEPTION: ["var(--danger)", "var(--danger-soft)"],
  DELIVERED: ["var(--ok)", "var(--ok-soft)"],
  CANCELLED: ["#4b5563", "#eef0f3"],
};

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const [color, bg] = SHIPMENT_STATUS_STYLE[status];
  return <Badge text={status.replace(/_/g, " ")} color={color} bg={bg} />;
}

const RUN_STATUS_STYLE: Record<AgentRunStatus, [string, string]> = {
  RUNNING: ["var(--accent)", "var(--accent-soft)"],
  COMPLETED: ["var(--ok)", "var(--ok-soft)"],
  AWAITING_APPROVAL: ["var(--warn)", "var(--warn-soft)"],
  ESCALATED: ["var(--critical)", "var(--critical-soft)"],
  FAILED: ["var(--danger)", "var(--danger-soft)"],
};

export function AgentRunStatusBadge({ status }: { status: AgentRunStatus }) {
  const [color, bg] = RUN_STATUS_STYLE[status];
  return <Badge text={status.replace(/_/g, " ")} color={color} bg={bg} />;
}

const APPROVAL_STATUS_STYLE: Record<ApprovalStatus, [string, string]> = {
  PENDING: ["var(--warn)", "var(--warn-soft)"],
  APPROVED: ["var(--ok)", "var(--ok-soft)"],
  REJECTED: ["var(--danger)", "var(--danger-soft)"],
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const [color, bg] = APPROVAL_STATUS_STYLE[status];
  return <Badge text={status} color={color} bg={bg} />;
}

const AUTONOMY_STYLE: Record<AutonomyLevel, [string, string]> = {
  OBSERVE: ["#4b5563", "#eef0f3"],
  RECOMMEND: ["var(--accent)", "var(--accent-soft)"],
  LOW_RISK_AUTONOMOUS: ["var(--ok)", "var(--ok-soft)"],
  OPERATIONAL_AUTONOMOUS: ["var(--ok)", "var(--ok-soft)"],
  HIGH_IMPACT_APPROVAL: ["var(--warn)", "var(--warn-soft)"],
};

export function AutonomyBadge({ level }: { level: AutonomyLevel }) {
  const [color, bg] = AUTONOMY_STYLE[level];
  return <Badge text={level.replace(/_/g, " ")} color={color} bg={bg} />;
}

export function PriorityBadge({ priority }: { priority: "STANDARD" | "HIGH" | "CRITICAL" }) {
  const style: [string, string] =
    priority === "CRITICAL" ? ["var(--critical)", "var(--critical-soft)"] : priority === "HIGH" ? ["var(--warn)", "var(--warn-soft)"] : ["#4b5563", "#eef0f3"];
  return <Badge text={priority} color={style[0]} bg={style[1]} />;
}
