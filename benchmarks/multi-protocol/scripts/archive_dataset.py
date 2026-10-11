"""Package, verify and restore the retained research data using Python's stdlib.

The Git archive contains compressed observations in <=20 MiB chunks. Restoring
requires no benchmark dependencies, services, credentials, or network access.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ARCHIVE = BASE / "archive"
CHUNK_BYTES = 20 * 1024 * 1024
BUFFER_BYTES = 1024 * 1024


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(BUFFER_BYTES), b""):
            result.update(block)
    return result.hexdigest()


def safe_path(root, relative):
    root = root.resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError(f"Path outside destination: {relative}")
    return path


def pack():
    """Explicit maintainer command; does not silently replace an older release."""
    if ARCHIVE.exists():
        raise FileExistsError("Archive already exists; preserve it before packaging a new release.")
    artifacts = json.loads((BASE / "results/summaries/artifacts.json").read_text())
    entries = [entry for entry in artifacts["artifacts"] if entry["path"].startswith("results/raw/")]
    # Validate inputs before creating a partial archive.
    for entry in entries:
        path = safe_path(BASE, entry["path"])
        if path.stat().st_size != entry["bytes"] or digest(path) != entry["sha256"]:
            raise ValueError(f"Source artifact does not match recorded hash: {path}")
    ARCHIVE.mkdir()
    records = []
    for entry in entries:
        source = safe_path(BASE, entry["path"])
        chunks = []
        with source.open("rb") as stream:
            index = 1
            for block in iter(lambda: stream.read(CHUNK_BYTES), b""):
                name = f"{source.name}.part{index:03d}"
                (ARCHIVE / name).write_bytes(block)
                chunks.append({"path": name, "bytes": len(block), "sha256": hashlib.sha256(block).hexdigest()})
                index += 1
        raw_hash = hashlib.sha256()
        raw_bytes = 0
        with gzip.open(source, "rb") as stream:
            for block in iter(lambda: stream.read(BUFFER_BYTES), b""):
                raw_hash.update(block)
                raw_bytes += len(block)
        if raw_bytes != entry["uncompressed_bytes"]:
            raise ValueError(f"Uncompressed length mismatch: {source}")
        records.append({**entry, "uncompressed_path": entry["path"][:-3],
                        "uncompressed_sha256": raw_hash.hexdigest(), "chunks": chunks})
    manifest = {"format": "struct-benchmark-archive-v1", "dataset_version": "1.0.0",
                "max_chunk_bytes": CHUNK_BYTES,
                "compressed_bytes": sum(entry["bytes"] for entry in records),
                "uncompressed_bytes": sum(entry["uncompressed_bytes"] for entry in records),
                "artifacts": records}
    (ARCHIVE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print(f"Packaged {len(records)} raw artifacts, {manifest['compressed_bytes']:,} bytes.")


def verify_or_restore(restore, expand, destination):
    manifest = json.loads((ARCHIVE / "manifest.json").read_text(encoding="utf8"))
    if manifest.get("format") != "struct-benchmark-archive-v1":
        raise ValueError("Unsupported archive format")
    for entry in manifest["artifacts"]:
        target = safe_path(destination, entry["path"])
        expanded = safe_path(destination, entry["uncompressed_path"])
        if restore and target.exists() and digest(target) != entry["sha256"]:
            raise FileExistsError(f"Refusing to overwrite different data: {target}")
        if expand and expanded.exists() and digest(expanded) != entry["uncompressed_sha256"]:
            raise FileExistsError(f"Refusing to overwrite different data: {expanded}")
        temporary = target.with_name(target.name + ".restoring")
        writer = None
        needs_write = restore and not target.exists()
        if needs_write:
            target.parent.mkdir(parents=True, exist_ok=True)
            writer = temporary.open("xb")
        full_hash = hashlib.sha256()
        total = 0
        try:
            for chunk in entry["chunks"]:
                chunk_path = safe_path(ARCHIVE, chunk["path"])
                chunk_hash = hashlib.sha256()
                count = 0
                with chunk_path.open("rb") as stream:
                    for block in iter(lambda: stream.read(BUFFER_BYTES), b""):
                        chunk_hash.update(block)
                        full_hash.update(block)
                        count += len(block)
                        if writer:
                            writer.write(block)
                if count != chunk["bytes"] or chunk_hash.hexdigest() != chunk["sha256"]:
                    raise ValueError(f"Archive chunk failed checksum: {chunk_path}")
                total += count
            if total != entry["bytes"] or full_hash.hexdigest() != entry["sha256"]:
                raise ValueError(f"Combined artifact failed checksum: {entry['path']}")
            if writer:
                writer.close()
                writer = None
                temporary.replace(target)
        finally:
            if writer:
                writer.close()
            if needs_write and temporary.exists():
                temporary.unlink()
        if expand and not expanded.exists():
            expanded.parent.mkdir(parents=True, exist_ok=True)
            temporary_raw = expanded.with_name(expanded.name + ".restoring")
            raw_hash = hashlib.sha256()
            count = 0
            owns_temporary = False
            try:
                output = temporary_raw.open("xb")
                owns_temporary = True
                with gzip.open(target, "rb") as stream, output:
                    for block in iter(lambda: stream.read(BUFFER_BYTES), b""):
                        output.write(block)
                        raw_hash.update(block)
                        count += len(block)
                if count != entry["uncompressed_bytes"] or raw_hash.hexdigest() != entry["uncompressed_sha256"]:
                    raise ValueError(f"Expanded artifact failed checksum: {target}")
                temporary_raw.replace(expanded)
            finally:
                if owns_temporary and temporary_raw.exists():
                    temporary_raw.unlink()
    operation = "Restored" if restore else "Verified"
    print(f"{operation} {len(manifest['artifacts'])} artifacts ({manifest['compressed_bytes']:,} compressed bytes).")
    if expand:
        print(f"Expanded observations available under {destination.resolve() / 'results/raw'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["pack", "verify", "restore"])
    parser.add_argument("--expand", action="store_true", help="Also restore the original JSON/NDJSON files (455 MiB).")
    parser.add_argument("--destination", type=Path, default=BASE, help="Alternative workspace root for restoration.")
    args = parser.parse_args()
    if args.expand and args.command != "restore":
        parser.error("--expand requires restore")
    if args.command == "pack":
        pack()
    else:
        verify_or_restore(args.command == "restore", args.expand, args.destination)


if __name__ == "__main__":
    main()
