"""Build a release from a clean HEAD and a freshly built Vite dist directory."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tarfile

from release import ReleaseError, digest, safe_name, validate


def build(repo, dist, output):
    repo, dist, output = Path(repo), Path(dist), Path(output)
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=repo)
    if git('status', '--porcelain', '--untracked-files=no', '--', 'backend', 'front-codex').strip():
        raise ReleaseError('dirty tracked source; commit changes before packing')
    if not (dist / 'index.html').is_file():
        raise ReleaseError('built index.html is missing')
    sha = git('rev-parse', 'HEAD').decode().strip()
    files = {}
    # Read committed blobs, never a recursive copy of the live working directory.
    with tarfile.open(fileobj=io.BytesIO(git('archive', '--format=tar', 'HEAD', 'backend'))) as source:
        for member in source.getmembers():
            if member.isdir():
                continue
            safe_name(member.name)
            if not member.isfile():
                raise ReleaseError('tracked symlinks are not permitted')
            files[member.name] = source.extractfile(member).read()
    for path in sorted(dist.rglob('*')):
        if path.is_symlink():
            raise ReleaseError('build symlinks are not permitted')
        if path.is_file():
            name = 'frontend/' + path.relative_to(dist).as_posix()
            safe_name(name)
            files[name] = path.read_bytes()
    files['backend/.release-sha'] = sha.encode()
    files['frontend/deploy-version.json'] = json.dumps({'sha': sha}).encode()
    manifest = {
        'format': 1, 'sha': sha,
        'sources': {name: git('rev-parse', 'HEAD:' + path).decode().strip()
                    for name, path in [('frontend', 'front-codex'), ('backend', 'backend')]},
        'dependencies': digest(files['backend/requirements.txt']),
        'files': {name: digest(data) for name, data in files.items()},
    }
    files['manifest.json'] = json.dumps(manifest, sort_keys=True).encode()
    # Exclusive creation avoids overwriting an earlier artifact unexpectedly.
    with output.open('xb') as destination, tarfile.open(fileobj=destination, mode='w:gz') as archive:
        for name, data in sorted(files.items()):
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o644
            archive.addfile(info, io.BytesIO(data))
    validate(output)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--dist', type=Path, default=Path('front-codex/dist'))
    parser.add_argument('--output', type=Path, default=Path('release.tar.gz'))
    args = parser.parse_args()
    manifest = build(args.repo, args.dist, args.output)
    print('Packed and verified commit ' + manifest['sha'])
