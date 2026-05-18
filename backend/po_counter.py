# backend/po_counter.py
import fcntl
import os
from pathlib import Path

COUNTER_FILE = Path(__file__).parent / "data" / "po_counter.txt"
_GCS_BUCKET = os.environ.get("GCS_BUCKET")
_GCS_OBJECT = "po_counter.txt"


def _gcs_client():
    from google.cloud import storage  # type: ignore
    return storage.Client()


def peek_next_po_number() -> str:
    if _GCS_BUCKET:
        bucket = _gcs_client().bucket(_GCS_BUCKET)
        blob = bucket.blob(_GCS_OBJECT)
        n = int(blob.download_as_text().strip()) if blob.exists() else 30
        return f"PO-{n:03d}"
    if not COUNTER_FILE.exists():
        COUNTER_FILE.parent.mkdir(parents=True, exist_ok=True)
        COUNTER_FILE.write_text("30")
    return f"PO-{int(COUNTER_FILE.read_text().strip()):03d}"


def consume_next_po_number() -> str:
    if _GCS_BUCKET:
        from google.cloud import storage  # type: ignore
        client = _gcs_client()
        bucket = client.bucket(_GCS_BUCKET)
        blob = bucket.blob(_GCS_OBJECT)
        n = int(blob.download_as_text().strip()) if blob.exists() else 30
        blob.upload_from_string(str(n + 1))
        return f"PO-{n:03d}"

    peek_next_po_number()  # ensure file exists
    with open(COUNTER_FILE, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        n = int(f.read().strip())
        f.seek(0)
        f.write(str(n + 1))
        f.truncate()
    return f"PO-{n:03d}"
