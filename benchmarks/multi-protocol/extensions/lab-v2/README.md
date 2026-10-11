# Protocol Lab coverage extension — dataset 2.0.0

This additive folder retains the root-cause audit, new observations, schemas,
coverage matrices, code generators, independent validation and reproduction
instructions for the October 11 Protocol Lab improvements. Original dataset
1.0.0 observations remain unchanged.

Read [REPORT.md](REPORT.md), [ROOT-CAUSES.md](ROOT-CAUSES.md),
[coverage-summary.json](coverage-summary.json), and
[the implementation guide](../../../../docs/PROTOCOL-LAB.md).

## Reproduce the new measurements

Use Node 24.18.1 or a compatible runtime with `module.registerHooks` and TypeScript
stripping. This extension uses the existing repository/gateway/web lockfiles:

```powershell
npm ci
npm --prefix tcp-server ci
npm --prefix web ci
python -m venv work/multi-protocol/venv
& ./work/multi-protocol/venv/Scripts/python.exe -m pip install -r benchmarks/multi-protocol/config/requirements.lock.txt
& ./work/multi-protocol/venv/Scripts/python.exe benchmarks/multi-protocol/scripts/bootstrap.py
```

The existing bootstrap installs portable pinned NanoMQ, Java and Leshan tools
inside ignored `work/`, never a system service. See the original
[README](../../README.md) and [tool hashes](../../references/tool-downloads.json).
The competitor runner uses these existing tools and temporary loopback listeners.

```powershell
& ./work/multi-protocol/venv/Scripts/python.exe benchmarks/multi-protocol/extensions/lab-v2/run-competitors.py mqtt coap
$env:STRUCT_ZIG_COMPILER='C:/path/to/zig.exe'
node benchmarks/multi-protocol/extensions/lab-v2/run-struct.cjs
python benchmarks/multi-protocol/extensions/lab-v2/normalize.py
npm --prefix web run lab:data
$env:LAB_COVERAGE_OUTPUT='coverage-after.json'
npm --prefix web run test:lab
python benchmarks/multi-protocol/extensions/lab-v2/report.py
```

The Struct runner requires Zig (recorded tool: 0.16.0) to compile the actual
generated C serializer as WASI. It compares its bytes with Node, sends identical
bytes over UDP IPv4/IPv6, and exercises the real gateway and migration/RPC logic
against a disposable PGlite database. It does not read `.env`, contact Supabase,
or emulate ESP32 instructions, flash, timing, radio or power. It requires local
IPv6 loopback. Runs regenerate **this extension's** observations; copy this folder
to a new versioned extension before recording a materially different experiment.
Do not regenerate `coverage-before.json`: it is the retained pre-change baseline.

The bounded runner generated 3,780 MQTT, 2,208 CoAP/OSCORE and 352 Struct cases.
Host wall-clock examples were about 17 seconds for competitors and 16 seconds for
Struct, excluding installation and subsequent tests/build. Exact encrypted bytes,
temporary ports, timestamps and timings change; lengths depend on recorded
configuration and OSCORE sequence values. Stable test IDs identify configurations.

## Independent SenML validation

The following runs the real Eclipse Leshan decoder against calculator-produced
SenML CBOR/JSON. Forty one-reading payloads cover all presets and precision modes.
This is independent **codec** validation, not new native Send/DTLS network capture.

```powershell
$env:LAB_SENML_OUTPUT='senml-input.json'
npm --prefix web run test:lab
$jdk = './work/multi-protocol/tools/jdk-21.0.12.1+1/bin'
$cp = './work/multi-protocol/tools/leshan-demo-client-2.0.0-M18-jar-with-dependencies.jar;./work/multi-protocol/classes'
New-Item -ItemType Directory -Force ./work/multi-protocol/classes | Out-Null
& "$jdk/javac.exe" -cp $cp -d ./work/multi-protocol/classes benchmarks/multi-protocol/implementations/lwm2m/BenchmarkLwm2m.java benchmarks/multi-protocol/extensions/lab-v2/ValidateSenml.java
& "$jdk/java.exe" -cp $cp ValidateSenml benchmarks/multi-protocol/extensions/lab-v2/senml-input.json benchmarks/multi-protocol/extensions/lab-v2/senml-leshan-validation.json
```

If the original Java source location differs in a future checkout, locate
`BenchmarkLwm2m.java` with `rg --files benchmarks/multi-protocol` and use that path.

## Artifact inventory

- `*-observations.ndjson.gz`: new raw observations, including bytes/directions,
  verification, implementation, environment and measurement boundaries.
- `records.ndjson.gz`, `schemas.json`, `measurement-summary.json`: additive
  normalized records; original raw artifacts/line numbers remain traceable.
- `generated-core-*.h`: actual generated C headers covering all new core types.
- `coverage-before.json`, `coverage-after.json`: 1,920-result normal-use matrices.
- `coverage-advanced.json`: targeted batches, reconnect accounting and protocol
  options; this is a finite sample, not an exhaustive cross-product.
- `coverage-matrix.csv.gz`, `coverage-summary.json`: portable completeness data.
- `senml-input.json`, `senml-leshan-validation.json`: independent decoder evidence.
- `sources.json`, `compatibility.json`, `security-matrix.json`: supplemental
  calculation/benchmark capability evidence. Production Secure V2 remains AEAD-only.
- `manifest.json`: actual working-tree source/artifact SHA256 hashes and environment.

The website builds a sanitized server-only index from original + extension
normalized data. Ordinary visitors do not download these raw observations.
