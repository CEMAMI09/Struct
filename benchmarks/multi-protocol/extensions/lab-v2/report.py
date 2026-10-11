"""Summarize calculator coverage; never relabel calculations as packet measurements."""
from pathlib import Path
import collections
import csv
import gzip
import hashlib
import json
import platform
import subprocess

BASE = Path(__file__).parent
ROOT = BASE.parents[3]


def read(name):
    return json.loads((BASE / name).read_text(encoding="utf-8"))


def count(rows):
    available = sum(r["value"] is not None for r in rows)
    comparable = sum(r.get("reduction") is not None for r in rows)
    return {"total": len(rows), "available": available,
            "available_percent": 100 * available / len(rows),
            "size_comparisons": comparable,
            "comparison_percent": 100 * comparable / len(rows),
            "missing": len(rows) - available}


before, after = read("coverage-before.json")["records"], read("coverage-after.json")["records"]
advanced = read("coverage-advanced.json")["records"]
for r in advanced:
    r["coverage_category"] = ("genuinely_unsupported" if r["value"] is None and (r.get("status") == "unsupported" or "MTU" in (r.get("reason") or "")) else
                              "missing_data" if r["value"] is None else
                              "supported_modeled" if r["protocol"] in ["protobuf","json","cbor"] or r.get("status") == "estimated" else "supported_specification_calculated")
axes = ["preset","security","delivery","precision","batch","network"]
key = lambda r: tuple(r[a] for a in axes)
old_baselines = {key(r): r for r in before if r["protocol"] == "struct"}
strict_rejections = sum(r["value"] is not None and r.get("reduction") is None and old_baselines[key(r)]["value"] is not None for r in before)
available_unranked = sum(r["value"] is not None and r.get("reduction") is None for r in before)
summary = {"strict_eligibility_rejections_fixed":strict_rejections,"previously_available_unranked_fixed":available_unranked,"version": "2.0.0-lab-coverage", "before": count(before), "after": count(after),
           "previously_missing_fixed": count(after)["available"] - count(before)["available"],
           "additional_numeric_comparisons": count(after)["size_comparisons"] - count(before)["size_comparisons"],
           "main_categories": dict(collections.Counter(r["coverage_category"] for r in after)),
           "comparison_categories": dict(collections.Counter(r.get("dimensions", {}).get("category", "baseline") for r in after)),
           "presets": {p: count([r for r in after if r["preset"] == p]) for p in sorted({r["preset"] for r in after})},
           "advanced": count(advanced),
           "advanced_categories": dict(collections.Counter(r["coverage_category"] for r in advanced)),
           "advanced_missing_reasons": dict(collections.Counter(r.get("reason", "Unspecified") for r in advanced if r["value"] is None)),
           "measurements": read("measurement-summary.json"),
           "scope": "Finite calculator matrix, not all possible custom schemas/options; UDP/IP specification calculations and explicit TCP/DTLS models are not packet captures."}
(BASE / "coverage-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
keys = ["preset", "protocol", "security", "delivery", "precision", "batch", "network", "axis", "variant", "connection", "includeSetup", "status", "coverage_category", "evidence", "value", "reduction", "reason"]
with gzip.open(BASE / "coverage-matrix.csv.gz", "wt", encoding="utf-8", newline="") as stream:
    writer = csv.DictWriter(stream, keys, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(after + advanced)

inputs = [p for p in BASE.iterdir() if p.suffix in [".cjs", ".py", ".java", ".h"] or p.name.endswith("ndjson.gz")]
source_files = ["protocol/schema/bitpacked.cjs", "protocol/schema/bitpacked.d.cts", "protocol/schema/lab-plaintext.cjs", "sdk/js/secure-v2.cjs", "sdk/js/secure-v2-client.cjs", "tcp-server/secure-v2.js", "web/server/protocol-lab/engine.ts", "web/server/protocol-lab/encoding.ts", "web/server/protocol-lab/network-model.ts", "web/server/protocol-lab/lwm2m.ts", "web/shared/protocol-lab/config.ts", "web/shared/protocol-lab/types.ts", "web/shared/protocol-lab/roi.ts", "web/scripts/build-protocol-lab.mjs", "web/package-lock.json", "package-lock.json"]
hashes = {str(p.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs + [ROOT / f for f in source_files]}
manifest = {"version": summary["version"], "source_git_base": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
            "source_state": "Working-tree extension; SHA256 identifies actual tested code rather than claiming the base commit contains these changes.",
            "python": platform.python_version(), "os": platform.platform(), "arch": platform.machine(),
            "node": subprocess.check_output(["node", "--version"], text=True).strip(),
            "packet_capture": False, "physical_device": False, "sha256": hashes,
            "original_dataset_preserved": True,
            "runtime_seconds": {"competitor_extension_observed": 16.52, "struct_extension_observed": 16.524},
            "runtime_note": "Host wall-clock examples, excluding installs/build/coverage/browser tests; reruns vary. Compiler/gateway assertions included. See README for dependencies."}
(BASE / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({k: summary[k] for k in ["before", "after", "previously_missing_fixed", "additional_numeric_comparisons", "main_categories", "advanced"]}, indent=2))
