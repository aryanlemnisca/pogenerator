"use client";

interface Props {
  label: string;
  value: string;
  wasFound: boolean;
  onChange: (v: string, nowFound: boolean) => void;
  helpText?: string;
  multiline?: boolean;
}

export default function FieldWithFlag({
  label,
  value,
  wasFound,
  onChange,
  helpText,
  multiline = false,
}: Props) {
  const flagged = !wasFound;

  const inputClasses = [
    "w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400",
    flagged ? "border-yellow-400 bg-yellow-50" : "border-gray-300 bg-white",
  ].join(" ");

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {multiline ? (
        <textarea
          className={inputClasses}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value, true)}
        />
      ) : (
        <input
          type="text"
          className={inputClasses}
          value={value}
          onChange={(e) => onChange(e.target.value, true)}
        />
      )}
      {flagged && (
        <p className="text-xs text-yellow-700">
          ⚠ Not found in quotation — please fill manually
        </p>
      )}
      {helpText && !flagged && (
        <p className="text-xs text-gray-400">{helpText}</p>
      )}
    </div>
  );
}
