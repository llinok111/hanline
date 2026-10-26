"""Build the distributable ZIP and verify it independently."""
import os
import sys
import zipfile
from pathlib import Path

EXCLUDE_DIRS = {'.git', 'node_modules', 'shots', '__pycache__'}
EXCLUDE_FILES = {'.DS_Store', 'Thumbs.db'}
ROOT = Path('.').resolve()
TARGET = ROOT.parent / 'hanline-0.1.0.zip'

CR = b'\r'
LF = b'\n'
CRLF = CR + LF

items = []
for root, dirs, files in os.walk(ROOT):
    dirs[:] = sorted(d for d in dirs if d not in EXCLUDE_DIRS)
    for f in sorted(files):
        if f in EXCLUDE_FILES:
            continue
        p = Path(root) / f
        items.append((p, p.relative_to(ROOT).as_posix()))

# Text entries are stored LF-normalised. The Windows working tree holds CRLF for
# the upstream files; shipping that inside the ZIP would make it look like
# upstream had been modified at the byte level.
TEXT_EXT = {
    '.mjs', '.js', '.json', '.md', '.yml', '.yaml', '.html', '.css',
    '.py', '.txt', '.gitattributes', '.gitignore', '.npmignore',
}


def is_text(p: Path) -> bool:
    return (p.suffix.lower() in TEXT_EXT
            or p.name in ('LICENSE', 'NOTICE', 'README', '.gitattributes', '.gitignore'))


with zipfile.ZipFile(TARGET, 'w', zipfile.ZIP_DEFLATED) as z:
    for p, rel in items:
        arc = 'hanline/' + rel
        if is_text(p):
            z.writestr(arc, p.read_bytes().replace(CRLF, LF))
        else:
            z.write(p, arc)

# testzip() must run on a fresh reader: a ZipFile opened in 'w' mode cannot read
# back its own entries, and doing so reports a bogus CRC failure.
with zipfile.ZipFile(TARGET) as z:
    bad = z.testzip()
    if bad:
        sys.exit(f'CRC failure: {bad}')

size = TARGET.stat().st_size
print(f'wrote {TARGET.name}: {len(items)} entries, {size / 1024:.1f} KiB')

required = [
    'hanline/package.json',
    'hanline/engine/index.mjs',
    'hanline/engine/_upstream.generated.mjs',
    'hanline/engine/nodes.mjs',
    'hanline/engine/chars.mjs',
    'hanline/bin/hanline.mjs',
    'hanline/demo/index.html',
    'hanline/LICENSE',
    'hanline/NOTICE',
    'hanline/README.md',
    'hanline/README.upstream.md',
    'hanline/test/upstream.test.mjs',
    'hanline/.gitattributes',
    'hanline/.github/workflows/ci.yml',
    'hanline/scripts/verify.mjs',
]

with zipfile.ZipFile(TARGET) as z:
    names = set(z.namelist())
    missing = [r for r in required if r not in names]
    for r in required:
        print(('  OK   ' if r in names else '  MISS '), r)
    if missing:
        sys.exit(f'missing {len(missing)} required entries')

    bad_paths = [n for n in names if '..' in n or n.startswith('/') or ':' in n]
    if bad_paths:
        sys.exit(f'unsafe entries: {bad_paths[:3]}')
    print('path safety: OK')

    cr = sum(1 for n in names if not n.endswith('.png') and CR in z.read(n))
    print(f'entries containing CR: {cr}')
    if cr:
        sys.exit('text normalisation failed')
