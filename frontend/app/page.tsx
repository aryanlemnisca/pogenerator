"use client";
import { useState } from "react";
import { POPayload } from "../lib/types";
import UploadStep from "../components/UploadStep";
import ReviewForm from "../components/ReviewForm";

type Stage = "upload" | "review" | "done";

export default function Home() {
  const [stage, setStage] = useState<Stage>("upload");
  const [payload, setPayload] = useState<POPayload | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");

  function handleExtracted(p: POPayload) {
    setPayload(p);
    setStage("review");
  }

  function handleGenerated(blob: Blob, fname: string) {
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setFilename(fname);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.click();
    setStage("done");
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {stage === "upload" && <UploadStep onExtracted={handleExtracted} />}
      {stage === "review" && payload && (
        <ReviewForm initialPayload={payload} onGenerated={handleGenerated} />
      )}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-4 py-16">
          <p className="text-green-700 font-medium text-lg">✓ PO generated!</p>
          <a href={downloadUrl ?? "#"} download={filename} className="text-sky-600 underline text-sm">
            Download again: {filename}
          </a>
          <button
            onClick={() => { setStage("upload"); setPayload(null); setDownloadUrl(null); }}
            className="mt-4 rounded-lg border border-gray-300 px-6 py-2 text-sm hover:bg-gray-100"
          >
            Generate another PO
          </button>
        </div>
      )}
    </main>
  );
}
