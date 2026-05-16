// frontend/lib/types.ts

export interface FlaggableStr {
  value: string;
  was_found: boolean;
}

export interface FlaggableFloat {
  value: number | null;
  was_found: boolean;
}

export interface LineItem {
  catalog_number: FlaggableStr;
  brand: FlaggableStr;
  description: FlaggableStr;
  qty: FlaggableFloat;
  rate: FlaggableFloat;
  discount_percent: FlaggableFloat;
  gst_percent: FlaggableFloat;
}

export interface VendorBlock {
  name: FlaggableStr;
  address_lines: FlaggableStr[];
  gst: FlaggableStr;
  contact_line: FlaggableStr;
}

export interface POMeta {
  po_number: FlaggableStr;
  date: FlaggableStr;
  payment_terms: FlaggableStr;
  delivery_date: FlaggableStr;
  ref_number: FlaggableStr;
  place_of_supply: FlaggableStr;
  po_revision: FlaggableStr;
  po_type: FlaggableStr;
  inco_terms: FlaggableStr;
  dispatch_instructions: FlaggableStr;
}

export interface POPayload {
  meta: POMeta;
  vendor: VendorBlock;
  items: LineItem[];
  prepared_by: string;
  authorized_signature: string;
}
