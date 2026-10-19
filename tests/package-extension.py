"""Package only production runtime files; no tests, notes or control records."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
# The old in-page panel is retained for historical tests, not shipped.
files = ['manifest.json', 'worker.js', 'core.js', 'dom.js', 'tracker.js',
         'drafts.js', 'draft-writer.js', 'secure-agent.js', 'secure.html',
         'secure.css', 'secure.js']
manifest = json.loads((root / 'extension/manifest.json').read_text())
assert manifest['permissions'] == ['activeTab', 'scripting', 'storage']
assert not manifest.get('host_permissions')
(root / 'dist').mkdir(exist_ok=True)
target = root / 'dist/conversation-margin-notes.zip'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        data = (root / 'extension' / name).read_bytes()
        assert len(data) <= 10 * 1024 * 1024
        archive.writestr('extension/' + name, data)
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(files)
print(f'{target.relative_to(root)}: {len(files)} runtime files, {target.stat().st_size} bytes')
