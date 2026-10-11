"""Download portable benchmark tools only. Never installs Windows services."""
import hashlib, json, pathlib, subprocess, urllib.request, zipfile, sys

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
TOOLS = ROOT / 'work/multi-protocol/tools'
REGISTRY = BASE / 'references/tool-downloads.json'
TOOLS.mkdir(parents=True, exist_ok=True)
REGISTRY.parent.mkdir(parents=True, exist_ok=True)
entries = json.loads(REGISTRY.read_text()) if REGISTRY.exists() else []

def fetch(url, name):
    destination = TOOLS / name
    if not destination.exists():
        print('Downloading', name, flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, destination.open('wb') as out:
            while chunk := response.read(1024 * 1024): out.write(chunk)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    old = next((r for r in entries if r['name'] == name), None)
    if old and old['sha256'] != digest: raise ValueError('Downloaded hash changed: ' + name)
    if not old:
        entries.append(dict(name=name, url=url, sha256=digest, bytes=destination.stat().st_size))
        REGISTRY.write_text(json.dumps(entries, indent=2) + '\n')
    return destination

def main():
    seven = TOOLS / '7zip/7z.exe'
    if not seven.exists():
        unpacker = fetch('https://github.com/ip7z/7zip/releases/download/26.04/7zr.exe', '7zr.exe')
        installer = fetch('https://github.com/ip7z/7zip/releases/download/26.04/7z2604-x64.exe', '7z2604-x64.exe')
        # Extract the official archive; do not launch its installer or elevate.
        subprocess.run([str(unpacker), 'x', str(installer), '-o' + str(seven.parent), '-y'], check=True, stdout=subprocess.DEVNULL)
    broker = TOOLS / 'nanomq/bin/nanomq.exe'
    if not broker.exists():
        archive = fetch('https://github.com/nanomq/nanomq/releases/download/0.25.6/nanomq-0.25.6-windows-x86_64.zip', 'nanomq-0.25.6-windows-x86_64.zip')
        with zipfile.ZipFile(archive) as z: z.extractall(TOOLS / 'nanomq')
    if not list(TOOLS.glob('jdk*/bin/java.exe')):
        # Reproduction uses the checked-in URL/hash, never a moving "latest" JDK.
        package = next(r for r in entries if r['name'].startswith('OpenJDK21U-jdk_x64_windows_hotspot_'))
        archive = fetch(package['url'], package['name'])
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == package['sha256']
        with zipfile.ZipFile(archive) as z: z.extractall(TOOLS)
    for kind in ('client', 'server'):
        name = f'leshan-demo-{kind}-2.0.0-M18-jar-with-dependencies.jar'
        url = f'https://repo.maven.apache.org/maven2/org/eclipse/leshan/leshan-demo-{kind}/2.0.0-M18/{name}'
        jar = fetch(url, name)
        with urllib.request.urlopen(url + '.sha256', timeout=30) as r:
            assert hashlib.sha256(jar.read_bytes()).hexdigest() == r.read().decode().strip()
    print('Portable tools ready:', TOOLS)

if __name__ == '__main__': main()
