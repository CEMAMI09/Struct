# Struct multi-protocol research dataset v1.0.0

This workspace contains **executed local benchmarks**, real serializers and protocol stacks, retained byte observations, validation, and research for a future calculator. It contains no calculator, web page, or production deployment changes.

Start with [START-HERE.md](START-HERE.md) for the portable archive and review guide, then [the final report](reports/FINAL-REPORT.md), [coverage](results/summaries/coverage.json), and [calculation rules](reports/CALCULATION-RULES.md). Counts and runtime in the final report are generated from the completed run rather than a planned matrix.

## Reproduce on Windows

From the Struct repository root, with Python 3.11 and Node 24.18.1 or compatible Node TypeScript support:

```powershell
python -m venv work/multi-protocol/venv
& .\work\multi-protocol\venv\Scripts\python.exe -m pip install -r benchmarks/multi-protocol/config/requirements.lock.txt
& .\work\multi-protocol\venv\Scripts\python.exe benchmarks/multi-protocol/scripts/bootstrap.py
& .\work\multi-protocol\venv\Scripts\python.exe benchmarks/multi-protocol/scripts/run.py --fresh
```

The Struct runners also require the repository's existing root and gateway Node dependencies. On a fresh checkout install those using their lockfiles (`npm ci` and `npm --prefix tcp-server ci`). This benchmark does not require the website dev server. `bootstrap.py` extracts portable NanoMQ, Temurin JDK and Leshan jars under ignored `work/multi-protocol/tools`; it never installs a service or requests elevation. Download URLs and SHA256 hashes are pinned in [tool-downloads.json](references/tool-downloads.json).

To include the existing C/mbedTLS ESP32-schema pilot, set the two paths required by that existing benchmark and add `--esp32`:

```powershell
$env:STRUCT_ZIG_COMPILER='C:\path\to\zig.exe'
$env:STRUCT_MBEDTLS_SOURCE='C:\path\to\mbedtls-3.6.7'
& .\work\multi-protocol\venv\Scripts\python.exe benchmarks/multi-protocol/scripts/run.py --fresh --esp32
```

The recorded pilot used Zig0.16.0 and mbedTLS3.6.7. This uses generated C serializers and the real C SDK on WASI, bridged to local UDP and a disposable PostgreSQL-compatible database. It does not emulate ESP32 instructions, radio, timing, flash, or power. The original benchmark and its existing results are preserved. The new copy is `results/raw/struct-esp32-pilot.json`.

## Run selected phases and resume

```powershell
& .\work\multi-protocol\venv\Scripts\python.exe benchmarks/multi-protocol/scripts/run.py --phases serialization coap normalize
& .\work\multi-protocol\venv\Scripts\python.exe benchmarks/multi-protocol/analyzers/build_dataset.py
& .\work\multi-protocol\venv\Scripts\python.exe benchmarks/multi-protocol/validators/validate.py
& .\work\multi-protocol\venv\Scripts\python.exe benchmarks/multi-protocol/analyzers/report.py
```

Serialization, Struct, low-level CoAP, MQTT, and HTTPS checkpoint by stable test IDs and skip existing records unless `--fresh` is supplied. Other runners are bounded experiments and regenerate their own outputs. A resumed OSCORE run creates fresh security contexts: its sequence positions can differ from a clean run and are recorded. Serialization is deterministic; encrypted bytes, certificates, ports, timestamps, and host timings are intentionally not byte-identical across runs. Reproduce an OSCORE length from its recorded sequence/KID/options, not from its schema alone.

The orchestrator runs sequentially, limits each phase to ten minutes, and records wall time and sampled process-tree RSS/CPU. Phase logs are in ignored `work/multi-protocol/logs`. Runtime excludes dependency downloads and installation. `--phases` replaces the current runtime manifest with that invocation's phases; retain a copy if comparing runs.

## Dataset layout

| Path | Contents |
|---|---|
| `schemas/library.json` | Seeded schema/value library, explicit types and precision policy |
| `schemas/generate.py` | Reproducible generator, seed 20261010 |
| `config/manifest.json`, `test-matrix.json` | Axes, budgets, and actual sampling selectors |
| `config/compatibility.json` | Measured, library-limited, harness-limited, and untested settings |
| `config/data-contract.json`, `calculation-readiness.json` | Field/layer semantics and machine-readable exact/model/research readiness |
| `references/sources.json` | Primary source URLs, sections, retrieval dates, supported claims |
| `references/security-matrix.json` | Identity, encryption, replay, forward secrecy and rotation distinctions |
| `references/implementations.json` | Selected implementations, versions, licenses and integration boundaries |
| `references/environment.json`, `source-hashes.json` | Host/dependency inventory and source hashes |
| `references/roi-pricing.json` | Separate public pricing examples and unknown billing parameters |
| `results/raw/*.ndjson[.gz]` | Original observations, decoded values, errors, hex, host timings |
| `results/normalized/records.ndjson.gz` | Compact reference dataset, pointers to raw file and line |
| `results/summaries/*.csv[.gz]` | All configurations, reference cases, payload-size cases |
| `results/summaries/coverage.json` | Executed configuration and schema counts, covered axes |
| `results/summaries/failed-unsupported.json` | Explicit unsuccessful/unsupported mappings |
| `results/summaries/wire-validation.json` | Independent framing checks |
| `results/summaries/artifacts.json` | Raw/normalized artifact sizes and SHA256 hashes |
| `reports/` | Audit, methodology, limitations, calculation rules and final findings |

All raw observations are preserved in Git under `archive/`, compressed and split into chunks no larger than20MiB. After pulling, restore the original files with Python's standard library (no benchmark dependencies required):

```sh
python benchmarks/multi-protocol/scripts/archive_dataset.py verify
python benchmarks/multi-protocol/scripts/archive_dataset.py restore --expand
```

Restoring without `--expand` writes compressed copies only. The manifest verifies both compressed and original hashes; differing existing files are preserved with an error. Original raw files and large uncompressed summary duplicates remain gitignored to avoid storing the same observations twice. Normalized data, compressed CSV summaries and all reports are directly available without extraction. No production secrets occur in these generated observations; visible PSKs and root bytes are disposable local test values.

## Interpret bytes correctly

`serialized_payload_bytes` is actual serializer output. UDP `application_*` is actual datagram content, including DTLS when that is the stack. MQTT/HTTP `application_*` is plaintext protocol traffic; `stream_*` includes measured TLS records. These layer definitions are explicit in `measurement_provenance`.

UDP/IP totals add specification headers to observed datagrams: 8-byte UDP plus 20-byte IPv4 or 40-byte IPv6, with no options/extensions or fragmentation. They are **not captured IP traffic**. TCP packet counts, segmentation, ACKs, SYN/FIN, IP totals, DNS and radio framing are unavailable and remain null. No socket read is treated as a TCP packet. Large UDP cases carry MTU warnings; blockwise CoAP measurements are separate actual multi-datagram exchanges.

Steady-state exchanges exclude initialization unless a field explicitly includes it. Connection costs are recorded separately; they must not be multiplied once per message on a persistent connection. MQTT observer traffic is outside the measured publisher leg. Do not add per-row copies of one shared handshake repeatedly.

`passed` means the declared local test assertions passed, not that the configuration is equivalent to every other stack. Examine precision, authentication, delivery guarantee, comparison scope, response payload and initialization before comparing. `comparable` is deliberately conservative; it is not a universal ranking. Read [calculation rules](reports/CALCULATION-RULES.md) before using results in a public tool.

## Extend safely

Add deterministic cases in `schemas/generate.py`; preserve existing IDs when their meaning is unchanged, and bump the dataset version if semantics change. Add adapters using the actual library's encoder/decoder, not just a size formula. Preserve received bytes, verify decoded values and security, add a primary-source entry, and update compatibility/sampling manifests. Use a new raw output for materially different experiments. Include a regression pilot before expanding combinations.

Keep all listeners on loopback and all credentials disposable. Struct's test database comes from `tests/database.cjs`; no Supabase account or `.env` file is used. Runtime environment flags exist only in benchmark child processes. The production gateway, live devices, schemas and services are not modified.
