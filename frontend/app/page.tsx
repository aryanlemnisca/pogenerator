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
        <ReviewForm
          initialPayload={payload}
          onGenerated={handleGenerated}
          onBack={() => setStage("upload")}
        />
      )}
      {stage === "done" && (
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gray-50 px-4">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-10 flex flex-col items-center gap-5 max-w-sm w-full">
            <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-gray-900">PO Generated!</h2>
              <p className="mt-1 text-sm text-gray-500">Your file downloaded automatically.</p>
            </div>
            <a
              href={downloadUrl ?? "#"}
              download={filename}
              className="w-full text-center rounded-lg border border-sky-300 px-4 py-2 text-sm text-sky-600 hover:bg-sky-50 transition-colors"
            >
              Download again
            </a>
            <button
              onClick={() => { setStage("upload"); setPayload(null); setDownloadUrl(null); }}
              className="w-full rounded-lg bg-sky-500 hover:bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              Generate another PO
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
