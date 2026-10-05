"""Build a release from a clean HEAD and a freshly built Vite dist directory."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tarfile

from release import ReleaseError, digest, safe_name, validate
from source_plan import policy_digest


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
    # Git archive honors core.autocrlf. Hash-addressed catalogs and executable
    # scripts must retain committed bytes on Windows as well as Linux.
    with tarfile.open(fileobj=io.BytesIO(git('-c', 'core.autocrlf=false', 'archive', '--format=tar', 'HEAD', 'backend'))) as source:
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
        'policy': policy_digest(),
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


def delta(archive, plan, output):
    """Derive a verified component package without rebuilding either product."""
    manifest = validate(archive)
    if (manifest['format'] != 1 or not isinstance(plan, dict) or type(plan.get('format')) is not int
            or plan.get('format') != 1
            or plan.get('sha') != manifest['sha'] or plan.get('policy') != manifest.get('policy')
            or plan.get('policy') != policy_digest()
            or not isinstance(plan.get('base'), str) or len(plan['base']) != 64
            or any(char not in '0123456789abcdef' for char in plan['base'])
            or not isinstance(plan.get('components'), list)
            or not plan['components']
            or plan['components'] != [c for c in ('frontend', 'backend') if c in plan['components']]):
        raise ReleaseError('invalid delta plan')
    selected = {name: value for name, value in manifest['files'].items()
                if name.split('/')[0] in plan['components']}
    reuse = plan.get('reuse', {})
    if (not isinstance(reuse, dict) or any(name not in selected or value != selected[name]
                                         or name.startswith('backend/GameData/')
                                         for name, value in reuse.items())):
        raise ReleaseError('invalid delta reuse plan')
    result = {**manifest, 'format': 2, 'base': plan['base'], 'components': plan['components'],
              'candidate': manifest, 'files': selected, 'reuse': reuse}
    with tarfile.open(archive, 'r:*') as source, Path(output).open('xb') as destination:
        with tarfile.open(fileobj=destination, mode='w:gz') as target:
            data = json.dumps(result, sort_keys=True).encode()
            info = tarfile.TarInfo('manifest.json')
            info.size, info.mode = len(data), 0o644
            target.addfile(info, io.BytesIO(data))
            for name in sorted(selected):
                if name in reuse:
                    continue
                member = source.getmember(name)
                target.addfile(member, source.extractfile(member))
    validate(output)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--dist', type=Path, default=Path('front-codex/dist'))
    parser.add_argument('--output', type=Path, default=Path('release.tar.gz'))
    parser.add_argument('--manifest', type=Path, default=Path('release-manifest.json'))
    args = parser.parse_args()
    manifest = build(args.repo, args.dist, args.output)
    with args.manifest.open('x', encoding='utf-8') as output:
        json.dump(manifest, output, sort_keys=True)
    print('Packed and verified commit ' + manifest['sha'])
