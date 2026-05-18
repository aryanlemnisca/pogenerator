"use client";
import { useState, useEffect, useRef, DragEvent } from "react";
import { POPayload } from "../lib/types";

interface Props {
  onExtracted: (payload: POPayload) => void;
}

const STAGES = [
  "Reading PDF…",
  "Identifying vendor…",
  "Extracting line items…",
  "Calculating totals…",
  "Finalising PO data…",
];

const MOCK_ROWS = [
  ["CAT-10291", "Tarsons", "Microcentrifuge Tubes 1.5mL (Pk/500)", "5", "1,200.00"],
  ["S-2877",   "Sigma",   "DMSO Anhydrous 100mL",                  "2", "3,450.00"],
  ["M-1054",   "HiMedia", "LB Broth Powder 500g",                  "3",   "890.00"],
  ["96-WT",    "Thermo",  "PCR Plates 96-well (10/pk)",            "4", "5,600.00"],
  ["EtOH-2.5", "Merck",   "Ethanol Absolute 2.5L",                 "6", "1,100.00"],
];

type CellState = { charIdx: number; dir: 1 | -1; pause: number };

function SpreadsheetAnimation({ filename }: { filename: string }) {
  const stateRef = useRef<Map<string, CellState>>(new Map());
  const [chars, setChars] = useState<Record<string, number>>({});
  const [scanRow, setScanRow] = useState(-1);
  const [stageIdx, setStageIdx] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    // Init each cell with staggered start pause
    MOCK_ROWS.forEach((row, r) =>
      row.forEach((cell, c) => {
        stateRef.current.set(`${r}-${c}`, {
          charIdx: 0,
          dir: 1,
          pause: Math.round((r * 5 + c) * 3.1), // spread out starts
        });
      })
    );

    // Main typing ticker — 55ms per tick
    const typingTimer = setInterval(() => {
      const updates: Record<string, number> = {};
      stateRef.current.forEach((s, key) => {
        const [rStr, cStr] = key.split("-");
        const text = MOCK_ROWS[+rStr][+cStr];
        if (s.pause > 0) { s.pause--; updates[key] = s.charIdx; return; }
        if (s.dir === 1) {
          s.charIdx = Math.min(s.charIdx + 1, text.length);
          if (s.charIdx === text.length) { s.pause = 30; s.dir = -1; }
        } else {
          s.charIdx = Math.max(s.charIdx - 2, 0);
          if (s.charIdx === 0) { s.pause = 8; s.dir = 1; }
        }
        updates[key] = s.charIdx;
      });
      setChars(prev => ({ ...prev, ...updates }));
    }, 55);

    // Scanning row highlight
    const scanTimer = setInterval(() => setScanRow(r => (r + 1) % MOCK_ROWS.length), 650);

    // Stage label cycling
    const stageTimer = setInterval(() => setStageIdx(i => (i + 1) % STAGES.length), 2600);

    // Cursor blink
    const cursorTimer = setInterval(() => setCursorVisible(v => !v), 500);

    return () => {
      clearInterval(typingTimer);
      clearInterval(scanTimer);
      clearInterval(stageTimer);
      clearInterval(cursorTimer);
    };
  }, []);

  const headers = ["Catalog #", "Brand", "Description", "Qty", "Rate (₹)"];

  return (
    <div className="w-full max-w-2xl flex flex-col items-center gap-5">
      {/* Status pill */}
      <div className="flex items-center gap-2.5 bg-white border border-sky-200 rounded-full px-4 py-1.5 shadow-sm">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500" />
        </span>
        <span className="text-sm font-medium text-sky-700">{STAGES[stageIdx]}</span>
      </div>

      {/* Sheet */}
      <div className="w-full rounded-xl border border-gray-200 bg-white shadow-md overflow-hidden">

        {/* PO header bar */}
        <div className="bg-sky-600 px-4 py-2.5 flex items-center justify-between">
          <div className="flex gap-5">
            {["PO Number", "Date", "Vendor"].map((h, i) => (
              <div key={h} className="flex flex-col gap-1">
                <span className="text-sky-300 text-[9px] uppercase tracking-widest">{h}</span>
                <div
                  className="h-2 rounded bg-sky-400"
                  style={{
                    width: [64, 56, 80][i],
                    animation: `pulse 1.${i + 4}s ease-in-out infinite`,
                  }}
                />
              </div>
            ))}
          </div>
          <span className="text-sky-200 text-[11px] font-semibold tracking-wider">PURCHASE ORDER</span>
        </div>

        {/* Table */}
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 text-left text-gray-400 font-medium w-6">#</th>
              {headers.map(h => (
                <th key={h} className="px-3 py-2 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_ROWS.map((row, r) => {
              const isScanned = scanRow === r;
              return (
                <tr
                  key={r}
                  className="border-b border-gray-100 transition-colors duration-300"
                  style={{ backgroundColor: isScanned ? "rgba(14,165,233,0.06)" : "transparent" }}
                >
                  <td className="px-3 py-2 text-gray-300 font-mono">{r + 1}</td>
                  {row.map((cell, c) => {
                    const n = chars[`${r}-${c}`] ?? 0;
                    const isTyping = n > 0 && n < cell.length;
                    const isErasing = stateRef.current.get(`${r}-${c}`)?.dir === -1;
                    const showCursor = (isTyping || (isErasing && n > 0)) && cursorVisible;
                    return (
                      <td
                        key={c}
                        className="px-3 py-2 font-mono"
                        style={{ minWidth: c === 2 ? 160 : c === 4 ? 72 : 64 }}
                      >
                        <span className={c === 4 ? "text-gray-700" : "text-gray-600"}>
                          {cell.slice(0, n)}
                        </span>
                        {showCursor && (
                          <span className="text-sky-500 font-bold">|</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t border-gray-200">
              <td colSpan={5} className="px-3 py-2 text-right text-gray-400 text-xs font-medium">
                Total (incl. GST)
              </td>
              <td className="px-3 py-2">
                <div className="h-2.5 w-20 rounded bg-gray-200 animate-pulse ml-auto" />
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Bottom strip */}
        <div className="bg-gray-50 border-t border-gray-100 px-4 py-2 flex items-center gap-2">
          <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-[10px] text-gray-400 truncate max-w-xs">{filename}</span>
          <span className="ml-auto text-[10px] text-sky-400 animate-pulse">Gemini AI processing…</span>
        </div>
      </div>

      <p className="text-xs text-gray-400">Usually takes 10–20 seconds</p>
    </div>
  );
}

export default function UploadStep({ onExtracted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") { setFile(f); setError(null); }
    else if (f) setError("Please upload a PDF file.");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Extraction failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Analysing Quotation</h1>
          <p className="mt-1 text-sm text-gray-500">Reading {file?.name}</p>
        </div>
        <SpreadsheetAnimation filename={file?.name ?? ""} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">BIOAI PO Generator</h1>
        <p className="mt-1 text-sm text-gray-500">Upload a vendor quotation PDF to generate a Purchase Order</p>
      </div>

      <label
        htmlFor="pdf-upload"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={[
          "w-full max-w-lg rounded-2xl border-2 border-dashed p-14 text-center transition-all cursor-pointer",
          dragging
            ? "border-sky-400 bg-sky-50 scale-[1.01]"
            : "border-gray-300 bg-white hover:border-sky-400 hover:bg-sky-50",
        ].join(" ")}
      >
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <svg className="h-10 w-10 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="font-semibold text-gray-800">{file.name}</p>
            <p className="text-sm text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
            <p className="text-xs text-sky-500 mt-1">Click to change file</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-gray-500 text-sm">Drag & drop a PDF quotation here</p>
            <p className="text-gray-400 text-xs">or click to browse</p>
          </div>
        )}
        <input id="pdf-upload" type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
      </label>

      {error && (
        <div className="w-full max-w-lg rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-700">⚠ {error}</p>
        </div>
      )}

      <button
        onClick={handleExtract}
        disabled={!file}
        className={[
          "flex items-center justify-center rounded-xl px-10 py-3 font-semibold text-white transition-all",
          !file ? "bg-gray-300 cursor-not-allowed" : "bg-sky-500 hover:bg-sky-600 shadow-sm hover:shadow-md active:scale-95",
        ].join(" ")}
      >
        Extract from PDF
      </button>
    </div>
  );
}
