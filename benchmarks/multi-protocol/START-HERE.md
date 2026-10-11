# Struct benchmark research — start here

This folder is the portable record of the multi-protocol research: implementation,
executed tests, retained observations, findings, references, limitations, and
instructions to reproduce or extend the work. It does not contain a calculator or
website changes.

## Calculator coverage extension (October 11)

The original dataset below is preserved. The additive [Protocol Lab v2 extension](extensions/lab-v2/README.md)
adds 6,340 successful local configurations, a before/after calculator matrix,
expanded schema and security validation, and implementation findings. Read its
[report](extensions/lab-v2/REPORT.md) and [coverage summary](extensions/lab-v2/coverage-summary.json).
The website now indexes 71,359 original + extension records; calculated and modeled
network values are distinguished from actual observations.

## Read the findings

1. [Complete findings and comparison tables](reports/FINAL-REPORT.md).
2. [Repository audit and investigated problems](reports/REPOSITORY-AUDIT.md).
3. [Calculation rules and remaining research](reports/CALCULATION-RULES.md).
4. [Developer experience](reports/DEVELOPER-EXPERIENCE.md) and
   [actual generated C packet bytes](reports/STRUCT-C-PACKET-BYTES.md).
5. [Reproduction instructions and folder map](README.md).

The retained run contains **65,019 configurations: 63,944 passed and 1,075
unsupported**, covering **367 schema/value cases and 150 distinct field
definitions**. The final report explains development failures and untested
features; zero retained failures does not mean complete coverage.

The original ESP32 example reproduced a 9-byte original payload or a 3-byte
explicitly precision-optimized payload. Secure V2 application uplinks were 34 and
28 bytes, including its measured 25-byte fixed overhead. Optimized humidity
decodes to 61.3 rather than 61.25. The V1 baseline was unencrypted. Other formats
can win: positional CBOR encodes these original values losslessly in 8 bytes.
See the full report before treating any sizes as equivalent-security comparisons.

## Get the complete observations on another device

After pulling the repository, all reports, code, matrices, normalized records,
compressed CSV summaries, and the complete compressed raw archive are already
present. Reading the reports requires no benchmark setup.

From the repository root, using Python 3.11 or newer:

```sh
python benchmarks/multi-protocol/scripts/archive_dataset.py verify
python benchmarks/multi-protocol/scripts/archive_dataset.py restore --expand
```

`verify` checks every archive chunk and reconstructed compressed-file hash.
`restore --expand` reconstructs the original `results/raw/*.gz` and JSON/NDJSON
files and checks their hashes. It works with Python's standard library on Windows,
macOS, or Linux, requires no network access, preserves differing existing files,
and is safe to repeat. Use `restore` without `--expand` for compressed copies only.

The archive contains about **87.7 MiB** of compressed raw observations, split into
files no larger than 20 MiB. Expanded originals require about **455 MiB** more disk
space. The normalized reference dataset is another approximately 4 MiB. Exact
sizes and SHA256 hashes are in [archive/manifest.json](archive/manifest.json) and
[results/summaries/artifacts.json](results/summaries/artifacts.json).

## Inspect the data and methodology

* [Coverage](results/summaries/coverage.json),
  [unsupported configurations](results/summaries/failed-unsupported.json), and
  [independent wire validation](results/summaries/wire-validation.json).
* [Normalized records](results/normalized/records.ndjson.gz) and
  [all configurations as CSV](results/summaries/all.csv.gz).
* [Schema library](schemas/library.json), [test matrix](config/test-matrix.json),
  [compatibility](config/compatibility.json), and
  [security capabilities](references/security-matrix.json).
* [Sources and supported claims](references/sources.json),
  [versions/licenses](references/implementations.json),
  [environment](references/environment.json), and
  [source hashes](references/source-hashes.json).
* [Execution logs](reports/execution-logs/) preserve warnings and run output;
  historical progress counts in logs are not the final coverage totals.

Measurements distinguish encoded bytes, plaintext protocol bytes, TLS stream
bytes, and calculated IP/UDP headers. There are no actual IP packet captures or
physical ESP32 power measurements. TCP/IP traffic, DTLS 1.3, broader LwM2M 1.2
coverage, and other gaps remain explicit in the final report.

All benchmark services and credentials were local and disposable. Production
devices, Supabase, gateway configuration, and the website were not changed.
Downloaded tools, virtual environments, node_modules, and generated binaries
are intentionally excluded from Git; pinned installation instructions are in
the README. Existing ESP32 benchmark dependencies are preserved at their original
repository paths (`scripts/benchmark-secure-v2-esp32.cjs` and
`sdk/c/benchmarks/first_esp32_secure_v2.c`).
