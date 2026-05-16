// frontend/lib/api.ts
import { POPayload } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function getNextPoNumber(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/next-po-number`);
  if (!res.ok) throw new Error("Failed to fetch PO number");
  const data = await res.json();
  return data.po_number as string;
}

export async function extractFromPdf(file: File): Promise<POPayload> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/api/extract`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Extraction failed");
  }
  return res.json() as Promise<POPayload>;
}

export async function generatePo(payload: POPayload): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/api/generate-po`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Generation failed");
  }
  return res.blob();
}
