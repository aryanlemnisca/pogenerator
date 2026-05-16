"use client";
import { useState } from "react";
import { POPayload } from "../lib/types";
import FieldWithFlag from "./FieldWithFlag";
import ItemsTable from "./ItemsTable";

interface Props {
  initialPayload: POPayload;
  onGenerated: (blob: Blob, filename: string) => void;
}

const META_KEYS = [
  "po_number", "date", "payment_terms", "delivery_date", "ref_number",
  "place_of_supply", "po_revision", "po_type", "inco_terms", "dispatch_instructions",
] as const;

export default function ReviewForm({ initialPayload, onGenerated }: Props) {
  const [payload, setPayload] = useState<POPayload>(initialPayload);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setMeta(key: typeof META_KEYS[number], value: string, wasFound: boolean) {
    setPayload((prev) => ({
      ...prev,
      meta: { ...prev.meta, [key]: { value, was_found: wasFound } },
    }));
  }

  function setVendorField(key: "name" | "gst" | "contact_line", value: string) {
    setPayload((prev) => ({
      ...prev,
      vendor: { ...prev.vendor, [key]: { value, was_found: true } },
    }));
  }

  function setAddressLine(idx: number, value: string) {
    setPayload((prev) => {
      const lines = [...prev.vendor.address_lines];
      lines[idx] = { value, was_found: true };
      return { ...prev, vendor: { ...prev.vendor, address_lines: lines } };
    });
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const { generatePo } = await import("../lib/api");
      const blob = await generatePo(payload);
      const vendorSlug = payload.vendor.name.value
        .toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 30);
      onGenerated(blob, `${payload.meta.po_number.value}_${vendorSlug}.xlsx`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const m = payload.meta;
  const v = payload.vendor;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-gray-800">Review & Edit Purchase Order</h2>

      {/* PO Metadata */}
      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">PO Metadata</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {META_KEYS.map((key) => (
            <FieldWithFlag
              key={key}
              label={key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              value={m[key].value}
              wasFound={m[key].was_found}
              onChange={(val, found) => setMeta(key, val, found)}
            />
          ))}
        </div>
      </section>

      {/* Vendor */}
      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Vendor</h3>
        <div className="grid grid-cols-2 gap-4">
          <FieldWithFlag label="Name" value={v.name.value} wasFound={v.name.was_found} onChange={(val) => setVendorField("name", val)} />
          <FieldWithFlag label="GST" value={v.gst.value} wasFound={v.gst.was_found} onChange={(val) => setVendorField("gst", val)} />
          <FieldWithFlag label="Contact" value={v.contact_line.value} wasFound={v.contact_line.was_found} onChange={(val) => setVendorField("contact_line", val)} />
          {v.address_lines.map((line, i) => (
            <FieldWithFlag key={i} label={`Address Line ${i + 1}`} value={line.value} wasFound={line.was_found} onChange={(val) => setAddressLine(i, val)} />
          ))}
        </div>
      </section>

      {/* Items */}
      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Line Items</h3>
        <ItemsTable items={payload.items} onChange={(items) => setPayload((prev) => ({ ...prev, items }))} />
      </section>

      {/* Signatories */}
      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Signatories</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-gray-600">Prepared By</label>
            <input className="w-full rounded border border-gray-300 px-2 py-1 text-sm" value={payload.prepared_by}
              onChange={(e) => setPayload((prev) => ({ ...prev, prepared_by: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-gray-600">Authorized Signature</label>
            <input className="w-full rounded border border-gray-300 px-2 py-1 text-sm" value={payload.authorized_signature}
              onChange={(e) => setPayload((prev) => ({ ...prev, authorized_signature: e.target.value }))} />
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="self-start rounded-lg bg-sky-500 px-8 py-2.5 font-medium text-white hover:bg-sky-600 disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate PO"}
      </button>
    </div>
  );
}
