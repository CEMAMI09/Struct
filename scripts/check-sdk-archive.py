"""Check the downloadable SDK archive's layout and credential hygiene."""

from pathlib import Path
import zipfile


root = Path(__file__).resolve().parents[1]
archive = root / "web" / "public" / "sdk" / "struct-sdk.zip"

required = {
    "struct-sdk/compatibility.json",
    "struct-sdk/python/pyproject.toml",
    "struct-sdk/js/index.cjs",
    "struct-sdk/c/CMakeLists.txt",
    "docs/SDK-SUPPORT.md",
    "docs/PROTOCOL.md",
    "docs/CONTRACT.md",
    "docs/protocol-secure-v2.md",
    "docs/SECURE-V2-ROLLOUT.md",
    "struct-sdk/c/src/struct_secure_v2.c",
    "struct-sdk/c/src/StructSecureV2Esp32.h",
    "struct-sdk/c/src/third_party/mbedtls/provenance.json",
    "struct-sdk/c/src/third_party/mbedtls/LICENSE.txt",
    "struct-sdk/c/src/third_party/mbedtls3/provenance.json",
    "struct-sdk/c/src/third_party/mbedtls3/LICENSE.txt",
    "struct-sdk/js/secure-v2.cjs",
    "struct-sdk/tests/secure-v2-vectors.json",
}

with zipfile.ZipFile(archive) as sdk_zip:
    names = sdk_zip.namelist()
    missing = sorted(required - set(names))
    if missing:
        raise SystemExit(f"SDK archive is missing: {', '.join(missing)}")
    if len(names) != len(set(names)):
        raise SystemExit("SDK archive contains duplicate paths")
    for name in names:
        path = Path(name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"Unsafe SDK archive path: {name}")
        if path.name in {".env", "credentials.h", "service-role-key.json"}:
            raise SystemExit(f"Credential-bearing file in SDK archive: {name}")

print(f"SDK archive layout and credential-file checks passed ({len(names)} files)")
