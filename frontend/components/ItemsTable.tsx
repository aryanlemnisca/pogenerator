"use client";
import { LineItem } from "../lib/types";

interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}

function disRate(item: LineItem): number {
  const rate = item.rate.value ?? 0;
  const dis = item.discount_percent.value ?? 0;
  const qty = item.qty.value ?? 0;
  return rate * (1 - dis / 100) * qty;
}

function amtIncGst(item: LineItem): number {
  return disRate(item) * (1 + (item.gst_percent.value ?? 0) / 100);
}

function cellCls(wasFound: boolean) {
  return wasFound
    ? "border border-gray-200 px-1 py-0.5"
    : "border border-yellow-400 bg-yellow-50 px-1 py-0.5";
}

export default function ItemsTable({ items, onChange }: Props) {
  function updateStr(idx: number, field: keyof LineItem, value: string) {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: { value, was_found: true } };
    onChange(next);
  }

  function updateFloat(idx: number, field: keyof LineItem, value: string) {
    const next = [...items];
    next[idx] = {
      ...next[idx],
      [field]: { value: value === "" ? null : parseFloat(value), was_found: true },
    };
    onChange(next);
  }

  const total = items.reduce((sum, item) => sum + amtIncGst(item), 0);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 text-gray-600 text-xs">
            {["#", "Catalog #", "Brand", "Description", "Qty", "Rate", "Dis %", "GST %", "Dis Rate", "Amt inc GST"].map((h) => (
              <th key={h} className="border border-gray-200 px-2 py-1 text-left whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx} className="hover:bg-gray-50">
              <td className="border border-gray-200 px-2 py-1 text-center">{idx + 1}</td>
              <td className="border border-gray-200 p-0">
                <input className={`w-24 ${cellCls(item.catalog_number.was_found)}`} value={item.catalog_number.value}
                  onChange={(e) => updateStr(idx, "catalog_number", e.target.value)} />
              </td>
              <td className="border border-gray-200 p-0">
                <input className={`w-24 ${cellCls(item.brand.was_found)}`} value={item.brand.value}
                  onChange={(e) => updateStr(idx, "brand", e.target.value)} />
              </td>
              <td className="border border-gray-200 p-0">
                <input className={`w-64 ${cellCls(item.description.was_found)}`} value={item.description.value}
                  onChange={(e) => updateStr(idx, "description", e.target.value)} />
              </td>
              <td className="border border-gray-200 p-0">
                <input type="number" className={`w-16 ${cellCls(item.qty.was_found)}`} value={item.qty.value ?? ""}
                  onChange={(e) => updateFloat(idx, "qty", e.target.value)} />
              </td>
              <td className="border border-gray-200 p-0">
                <input type="number" className={`w-20 ${cellCls(item.rate.was_found)}`} value={item.rate.value ?? ""}
                  onChange={(e) => updateFloat(idx, "rate", e.target.value)} />
              </td>
              <td className="border border-gray-200 p-0">
                <input type="number" className={`w-16 ${cellCls(item.discount_percent.was_found)}`} value={item.discount_percent.value ?? ""}
                  onChange={(e) => updateFloat(idx, "discount_percent", e.target.value)} />
              </td>
              <td className="border border-gray-200 p-0">
                <input type="number" className={`w-16 ${cellCls(item.gst_percent.was_found)}`} value={item.gst_percent.value ?? ""}
                  onChange={(e) => updateFloat(idx, "gst_percent", e.target.value)} />
              </td>
              <td className="border border-gray-200 px-2 py-1 text-right font-mono">
                {disRate(item).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </td>
              <td className="border border-gray-200 px-2 py-1 text-right font-mono">
                {amtIncGst(item).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-semibold">
            <td colSpan={9} className="border border-gray-200 px-2 py-1 text-right">Total</td>
            <td className="border border-gray-200 px-2 py-1 text-right font-mono">
              ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
