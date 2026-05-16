# backend/po_counter.py
import fcntl
from pathlib import Path

COUNTER_FILE = Path(__file__).parent / "data" / "po_counter.txt"


def peek_next_po_number() -> str:
    if not COUNTER_FILE.exists():
        COUNTER_FILE.parent.mkdir(parents=True, exist_ok=True)
        COUNTER_FILE.write_text("30")
    n = int(COUNTER_FILE.read_text().strip())
    return f"PO-{n:03d}"


def consume_next_po_number() -> str:
    peek_next_po_number()  # ensures file exists with seed "30" if missing
    with open(COUNTER_FILE, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        n = int(f.read().strip())
        f.seek(0)
        f.write(str(n + 1))
        f.truncate()
    return f"PO-{n:03d}"
