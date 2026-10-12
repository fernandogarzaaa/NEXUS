import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-4 md:p-8">
      <div className="panel p-6 max-w-xl">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          That shipment or page does not exist in the current demo world. Resetting the demo re-seeds shipment IDs.
        </p>
        <Link href="/shipments" className="mt-4 inline-block text-[13px] font-medium" style={{ color: "var(--accent)" }}>
          Back to shipments
        </Link>
      </div>
    </div>
  );
}
