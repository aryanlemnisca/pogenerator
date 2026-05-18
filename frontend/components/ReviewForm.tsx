"use client";
import { useState } from "react";
import { POPayload } from "../lib/types";
import FieldWithFlag from "./FieldWithFlag";
import ItemsTable from "./ItemsTable";

interface Props {
  initialPayload: POPayload;
  onGenerated: (blob: Blob, filename: string) => void;
  onBack: () => void;
}

const META_KEYS = [
  "po_number", "date", "payment_terms", "delivery_date", "ref_number", "place_of_supply",
] as const;

const META_LABELS: Record<typeof META_KEYS[number], string> = {
  po_number: "PO Number",
  date: "Date",
  payment_terms: "Payment Terms",
  delivery_date: "Delivery Date",
  ref_number: "Ref #",
  place_of_supply: "Place of Supply",
};

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white inline-block mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function ReviewForm({ initialPayload, onGenerated, onBack }: Props) {
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
      setError(err instanceof Error ? err.message : "Generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const m = payload.meta;
  const v = payload.vendor;

  const flaggedCount = [
    ...META_KEYS.map((k) => !m[k].was_found),
    !v.name.was_found, !v.gst.was_found, !v.contact_line.was_found,
    ...v.address_lines.map((l) => !l.was_found),
    ...payload.items.flatMap((item) => [
      !item.catalog_number.was_found, !item.brand.was_found,
      !item.description.was_found, !item.qty.was_found,
      !item.rate.was_found, !item.gst_percent.was_found,
    ]),
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-40"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <span className="text-gray-300">|</span>
            <h2 className="text-base font-semibold text-gray-800">Review Purchase Order</h2>
          </div>
          <div className="flex items-center gap-3">
            {flaggedCount > 0 && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">
                {flaggedCount} field{flaggedCount !== 1 ? "s" : ""} need attention
              </span>
            )}
            <button
              onClick={handleGenerate}
              disabled={loading}
              className={[
                "flex items-center rounded-lg px-5 py-2 text-sm font-semibold text-white transition-all",
                loading
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-sky-500 hover:bg-sky-600 shadow-sm active:scale-95",
              ].join(" ")}
            >
              {loading && <Spinner />}
              {loading ? "Generating…" : "Generate PO"}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col gap-5">

        {/* PO Metadata */}
        <section className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">PO Metadata</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {META_KEYS.map((key) => (
              <FieldWithFlag
                key={key}
                label={META_LABELS[key]}
                value={m[key].value}
                wasFound={m[key].was_found}
                onChange={(val, found) => setMeta(key, val, found)}
              />
            ))}
          </div>
        </section>

        {/* Vendor */}
        <section className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Vendor</h3>
          <div className="grid grid-cols-2 gap-4">
            <FieldWithFlag label="Vendor Name" value={v.name.value} wasFound={v.name.was_found} onChange={(val) => setVendorField("name", val)} />
            <FieldWithFlag label="GST Number" value={v.gst.value} wasFound={v.gst.was_found} onChange={(val) => setVendorField("gst", val)} />
            {v.address_lines.map((line, i) => (
              <FieldWithFlag
                key={i}
                label={`Address Line ${i + 1}`}
                value={line.value}
                wasFound={line.was_found}
                onChange={(val) => setAddressLine(i, val)}
              />
            ))}
            <FieldWithFlag
              label="Contact"
              value={v.contact_line.value}
              wasFound={v.contact_line.was_found}
              onChange={(val) => setVendorField("contact_line", val)}
            />
          </div>
        </section>

        {/* Items */}
        <section className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Line Items ({payload.items.length})
          </h3>
          <ItemsTable items={payload.items} onChange={(items) => setPayload((prev) => ({ ...prev, items }))} />
        </section>

        {/* Signatories */}
        <section className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Signatories</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">Prepared By</label>
              <input
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={payload.prepared_by}
                onChange={(e) => setPayload((prev) => ({ ...prev, prepared_by: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">Authorized Signature</label>
              <input
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={payload.authorized_signature}
                onChange={(e) => setPayload((prev) => ({ ...prev, authorized_signature: e.target.value }))}
              />
            </div>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">⚠ {error}</p>
          </div>
        )}

        {/* Bottom generate button (convenience duplicate) */}
        <div className="flex justify-end pb-6">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className={[
              "flex items-center rounded-xl px-8 py-3 font-semibold text-white transition-all",
              loading
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-sky-500 hover:bg-sky-600 shadow-sm hover:shadow-md active:scale-95",
            ].join(" ")}
          >
            {loading && <Spinner />}
            {loading ? "Generating…" : "Generate PO"}
          </button>
        </div>
      </div>
    </div>
  );
}
