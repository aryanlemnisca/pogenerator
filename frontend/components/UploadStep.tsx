"use client";
import { useState, useRef, DragEvent } from "react";
import { POPayload } from "../lib/types";

interface Props {
  onExtracted: (payload: POPayload) => void;
}

export default function UploadStep({ onExtracted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") setFile(f);
  }

  async function handleExtract() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const { extractFromPdf } = await import("../lib/api");
      const payload = await extractFromPdf(file);
      onExtracted(payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 py-16">
      <h1 className="text-2xl font-semibold text-gray-800">BIOAI PO Generator</h1>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          "w-full max-w-md cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition",
          dragging ? "border-sky-400 bg-sky-50" : "border-gray-300 hover:border-sky-300",
        ].join(" ")}
      >
        <p className="text-gray-500">
          {file ? (
            <span className="font-medium text-gray-800">
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </span>
          ) : (
            "Drag & drop a PDF quotation here, or click to browse"
          )}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && <p className="max-w-md text-sm text-red-600">{error}</p>}

      <button
        onClick={handleExtract}
        disabled={!file || loading}
        className="rounded-lg bg-sky-500 px-8 py-2.5 font-medium text-white hover:bg-sky-600 disabled:opacity-50"
      >
        {loading ? "Extracting…" : "Extract"}
      </button>
    </div>
  );
}
