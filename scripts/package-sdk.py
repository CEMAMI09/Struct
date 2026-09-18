"""Build deterministic, credential-free SDK ZIPs for the web download."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
sdk = root / 'sdk'
target = root / 'web/public/sdk'
target.mkdir(parents=True, exist_ok=True)
allowed = {'.h', '.c', '.ino', '.md', '.cjs', '.json', '.py', '.properties', '.txt'}
def archive(path, entries):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as output:
        for source, name in sorted(entries, key=lambda pair: pair[1]):
            info = zipfile.ZipInfo(name, (2026, 9, 9, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            content = source.read_bytes()
            if name.startswith('docs/'):
                content = content.replace(b'../sdk/', b'../struct-sdk/')
            output.writestr(info, content)
files = [p for p in sdk.rglob('*') if p.is_file() and p.suffix in allowed
         and not any(part in {'node_modules', '__pycache__'} for part in p.parts)]
docs = [(p, 'docs/' + p.name) for p in (root / 'docs').glob('*.md')]
archive(target / 'struct-sdk.zip', [(p, 'struct-sdk/' + p.relative_to(sdk).as_posix()) for p in files] + docs)
arduino = [p for p in files if p.is_relative_to(sdk / 'c') and not p.is_relative_to(sdk / 'c/ports')]
archive(target / 'struct-arduino.zip', [(p, 'Struct/' + p.relative_to(sdk / 'c').as_posix()) for p in arduino])
print('Built web/public/sdk/struct-sdk.zip and struct-arduino.zip')
