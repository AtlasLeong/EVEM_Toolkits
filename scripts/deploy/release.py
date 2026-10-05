"""Validated, component-aware releases. Requires Python 3.10+; publish runs on Linux.

No dependency installation, database mutation, automatic cleanup, or service configuration.
The server must be initialized by an operator before publish/rollback can be used.
"""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import importlib.util
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from urllib.error import HTTPError
from urllib.parse import urlsplit


COMPONENTS = ('frontend', 'backend')
SHA = re.compile(r'^[0-9a-f]{40}$')
HASH = re.compile(r'^[0-9a-f]{64}$')
MAX_BYTES = 1024 ** 3
MARKET_CAPABILITY_FILE = 'Market/management/commands/market_tick.py'
KILLBOARD_CAPABILITY_FILE = 'Killboard/run-collector.sh'
MARKET_MSGPACK_VERSION = '1.2.2'


def source_policy():
    # Load the operator-installed sibling, never a module from the application.
    spec = importlib.util.spec_from_file_location('evem_source_policy', Path(__file__).with_name('source_plan.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# Run only with the candidate interpreter and its real collector PYTHONPATH.
# No Django settings, session load, database, or game connection is needed.
# Capture output at the parent boundary; dependency tracebacks may contain paths.
MARKET_RUNTIME_PROBE = r'''
import importlib
import os
from pathlib import Path
import sys

backend = Path(sys.argv[1]).resolve()
expected = sys.argv[2]
runtime = Path(sys.argv[3]).resolve()
private = Path(sys.argv[4]).resolve()

def no_external_io(event, args):
    if event.startswith('socket.'):
        raise RuntimeError('Network access is forbidden in market preflight')
    if event == 'open' and args and isinstance(args[0], (str, bytes, os.PathLike)):
        path = Path(os.fsdecode(args[0])).resolve()
        if (path.is_relative_to(private) or path.name.startswith('.env')
                or path.name == 'session.json'
                or path.suffix.lower() in ('.dpapi', '.pcap', '.pcapng', '.pem', '.key')):
            raise RuntimeError('Credential access is forbidden in market preflight')

sys.addaudithook(no_external_io)
msgpack = importlib.import_module('msgpack')
if msgpack.__version__ != expected or not Path(msgpack.__file__).resolve().is_relative_to(runtime):
    raise RuntimeError('Market runtime dependency mismatch')
session = importlib.import_module('Market.session_bundle')
protocol = importlib.import_module('Market.collector_protocol')
for module in (session, protocol):
    if not Path(module.__file__).resolve().is_relative_to(backend / 'Market'):
        raise RuntimeError('Wrong market application module')
if not callable(session.load_session) or not callable(protocol.MarketSession):
    raise RuntimeError('Incomplete market runtime')
'''


class ReleaseError(RuntimeError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    parts = PurePosixPath(name).parts
    if (not parts or '\\' in name or '\x00' in name or ':' in name
            or name.startswith('/') or any(p in ('..', '.') for p in name.split('/'))
            or str(PurePosixPath(name)) != name):
        raise ReleaseError('unsafe archive path')
    if name == 'manifest.json':
        return
    if parts[0] not in COMPONENTS or len(parts) < 2:
        raise ReleaseError('unknown component')
    for part in parts[1:]:
        lower = part.lower()
        if (part in {'.git', '.venv', 'venv', 'node_modules', '__pycache__', 'logs', 'uploads'}
                or (part.startswith('.env') and part != '.env.example')
                or part.startswith(('id_rsa', 'id_ed25519'))
                or lower.endswith(('.pem', '.key', '.sqlite3', '.pyc', '.log', '.pcap', '.pcapng', '.dpapi'))
                or (lower.endswith(('.json', '.xlsx', '.xls', '.csv'))
                    and re.match(r'^(?:sessions?|accounts?)(?:[._-]|$)', lower))):
            raise ReleaseError('persistent or secret data in artifact')


def atomic_json(path, value):
    path = Path(path)
    # Same-directory temporary file makes replacement atomic on the same filesystem.
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(value, out, sort_keys=True, indent=2)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_game_catalog(source, files):
    """Verify immutable catalog hashes, not only the outer artifact manifest."""
    pointer_name = 'backend/GameData/data/current.json'
    if pointer_name not in files:
        return  # Older application releases do not contain the shared catalog.
    if source.getmember(pointer_name).size > 4 * 1024 ** 2:
        raise ReleaseError('oversized game catalog pointer')
    try:
        pointer = json.load(source.extractfile(pointer_name))
    except (ValueError, TypeError):
        raise ReleaseError('invalid game catalog pointer') from None
    if not isinstance(pointer, dict):
        raise ReleaseError('invalid game catalog pointer')
    revision, versions = pointer.get('revision'), pointer.get('versions')
    hashes, current_hash = pointer.get('version_hashes'), pointer.get('catalog_sha256')
    if (type(pointer.get('schema_version')) is not int or pointer['schema_version'] != 1
            or not isinstance(revision, str) or not HASH.fullmatch(revision)
            or not isinstance(versions, list) or not versions or len(versions) > len(files)
            or any(not isinstance(value, str) or not HASH.fullmatch(value) for value in versions)
            or len(set(versions)) != len(versions) or revision not in versions
            or not isinstance(hashes, dict) or not isinstance(current_hash, str)
            or not HASH.fullmatch(current_hash) or hashes.get(revision) != current_hash):
        raise ReleaseError('invalid game catalog pointer')
    for version in versions:
        # Only validated hexadecimal revisions may contribute to an archive path.
        name = f'backend/GameData/data/versions/{version}.json'
        expected = hashes.get(version)
        if name not in files or not isinstance(expected, str) or not HASH.fullmatch(expected):
            raise ReleaseError('game catalog revision or checksum missing')
        actual = hashlib.sha256()
        with source.extractfile(name) as stream:
            for chunk in iter(lambda: stream.read(1024 ** 2), b''):
                actual.update(chunk)
        if actual.hexdigest() != expected:
            raise ReleaseError('game catalog checksum mismatch')


def validate_manifest(manifest):
    """Validate small planning metadata with the same rules as release archives."""
    if (not isinstance(manifest, dict) or type(manifest.get('format')) is not int
            or manifest['format'] not in (1, 2)
            or not isinstance(manifest.get('sha'), str) or not SHA.fullmatch(manifest['sha'])
            or not isinstance(manifest.get('sources'), dict)
            or set(manifest['sources']) != set(COMPONENTS)
            or any(not isinstance(s, str) or not SHA.fullmatch(s) for s in manifest['sources'].values())
            or not isinstance(manifest.get('dependencies'), str) or not HASH.fullmatch(manifest['dependencies'])
            or not isinstance(manifest.get('files'), dict) or len(manifest['files']) > 20000):
        raise ReleaseError('invalid manifest metadata')
    components = list(COMPONENTS)
    if manifest['format'] == 1 and {'base', 'components', 'candidate', 'reuse'} & set(manifest):
        raise ReleaseError('delta metadata is forbidden in a full artifact')
    if manifest['format'] == 2:
        components = manifest.get('components')
        if (not isinstance(components, list) or not components
                or components != [c for c in COMPONENTS if c in components]
                or not isinstance(manifest.get('base'), str) or not HASH.fullmatch(manifest['base'])
                or not isinstance(manifest.get('candidate'), dict)
                or manifest['candidate'].get('format') != 1):
            raise ReleaseError('invalid delta metadata')
        candidate = validate_manifest(manifest['candidate'])
        for key in ('sha', 'sources', 'dependencies', 'policy'):
            if manifest.get(key) != candidate.get(key):
                raise ReleaseError('delta candidate metadata mismatch')
        expected = {name: value for name, value in candidate['files'].items()
                    if name.split('/')[0] in components}
        if manifest['files'] != expected:
            raise ReleaseError('delta candidate inventory mismatch')
        reuse = manifest.get('reuse', {})
        if (not isinstance(reuse, dict)
                or any(name not in expected or value != expected[name]
                       or name.startswith('backend/GameData/') for name, value in reuse.items())):
            raise ReleaseError('invalid delta reuse inventory')
    files = manifest['files']
    for name, expected in files.items():
        safe_name(name)
        if (name == 'manifest.json' or name.split('/')[0] not in components
                or not isinstance(expected, str) or not HASH.fullmatch(expected)):
            raise ReleaseError('invalid manifest inventory')
        if any(str(parent) in files for parent in PurePosixPath(name).parents):
            raise ReleaseError('archive path collision')
    required = {'frontend': {'frontend/index.html'},
                'backend': {'backend/manage.py', 'backend/requirements.txt'}}
    if any(not required[c] <= set(files) for c in components):
        raise ReleaseError('incomplete artifact')
    if 'backend' in components and manifest['dependencies'] != files['backend/requirements.txt']:
        raise ReleaseError('dependency checksum mismatch')
    if 'policy' in manifest and (not isinstance(manifest['policy'], str) or not HASH.fullmatch(manifest['policy'])):
        raise ReleaseError('invalid source policy')
    return manifest


def validate(archive):
    """Validate inventory, types and checksums BEFORE creating any release files."""
    with tarfile.open(archive, 'r:*') as source:
        members = source.getmembers()
        names = [m.name for m in members]
        if len(names) != len(set(names)):
            raise ReleaseError('duplicate archive member')
        if len(members) > 20000 or sum(m.size for m in members) > MAX_BYTES:
            raise ReleaseError('artifact too large')
        for member in members:
            safe_name(member.name)
            if not member.isfile() or member.size < 0:
                raise ReleaseError('only regular files are allowed')
        if 'manifest.json' not in names or source.getmember('manifest.json').size > 4 * 1024 ** 2:
            raise ReleaseError('missing or oversized manifest')
        manifest = validate_manifest(json.load(source.extractfile('manifest.json')))
        files = manifest['files']
        payload = {name: value for name, value in files.items()
                   if name not in manifest.get('reuse', {})}
        if set(payload) != set(names) - {'manifest.json'}:
            raise ReleaseError('artifact inventory mismatch')
        for name in names:
            if any(str(parent) in files for parent in PurePosixPath(name).parents):
                raise ReleaseError('archive path collision')
        for name, expected in payload.items():
            actual = hashlib.sha256()
            with source.extractfile(name) as stream:
                for chunk in iter(lambda: stream.read(1024 ** 2), b''):
                    actual.update(chunk)
            if not HASH.fullmatch(expected) or actual.hexdigest() != expected:
                raise ReleaseError('artifact checksum mismatch: ' + name)
        validate_game_catalog(source, files)
        return manifest


def stage(archive, releases, reuse_state=None):
    manifest = validate(archive)
    releases = Path(releases)
    reuse = manifest.get('reuse', {})
    if reuse and (reuse_state is None or state_token(reuse_state) != manifest['base']):
        raise ReleaseError('verified base state required for reused files')
    releases.mkdir(parents=True, exist_ok=True)
    identity = manifest['sha']
    if manifest['format'] == 2:
        # The same source may be replanned after a rollback or failed preflight.
        # Keep each verified delta inventory/base immutable and independently reusable.
        identity += '-' + digest(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode())
    target = releases / identity
    # An identical retry may reuse staged files, but never trust the directory name alone.
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_dir():
            raise ReleaseError('existing release is not a real directory')
        if json.loads((target / 'manifest.json').read_text()) != manifest:
            raise ReleaseError('existing release manifest differs')
        for name, expected in manifest['files'].items():
            path = target / name
            if (path.is_symlink() or not path.resolve().is_relative_to(target.resolve())
                    or not path.is_file() or digest(path.read_bytes()) != expected):
                raise ReleaseError('existing release checksum differs: ' + name)
        runtime_links = {'backend/.env', 'backend/.venv', 'backend/logs', 'backend/static/uploads'}
        for folder, directories, filenames in os.walk(target, followlinks=False):
            for leaf in directories + filenames:
                path = Path(folder) / leaf
                name = path.relative_to(target).as_posix()
                if path.is_symlink():
                    if name not in runtime_links:
                        raise ReleaseError('unlisted release symlink: ' + name)
                    # prepare_backend rebinds these to the checked registry/config.
                    continue
                if path.is_dir():
                    continue
                if name in manifest['files'] or name == 'manifest.json':
                    continue
                if '__pycache__' in path.relative_to(target).parts and path.suffix == '.pyc':
                    continue
                raise ReleaseError('unlisted file in existing release: ' + name)
        return target
    temporary = Path(tempfile.mkdtemp(prefix='.staging-', dir=releases))
    try:
        with tarfile.open(archive, 'r:*') as source:
            payload = set(manifest['files']) - set(reuse)
            if {member.name for member in source.getmembers()} != payload | {'manifest.json'}:
                raise ReleaseError('staging inventory changed after validation')
            for member in source.getmembers():
                safe_name(member.name)
                if not member.isfile():
                    raise ReleaseError('staging file type changed after validation')
                dest = temporary / member.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                actual = hashlib.sha256()
                with source.extractfile(member) as incoming, dest.open('xb') as out:
                    for chunk in iter(lambda: incoming.read(1024 ** 2), b''):
                        actual.update(chunk)
                        out.write(chunk)
                if member.name == 'manifest.json':
                    if json.loads(dest.read_text()) != manifest:
                        raise ReleaseError('staging manifest changed after validation')
                elif actual.hexdigest() != manifest['files'][member.name]:
                    raise ReleaseError('staging checksum changed after validation')
                dest.chmod(0o644)
        for name, expected in reuse.items():
            component, relative = name.split('/', 1)
            directory = Path(reuse_state[component]['path'])
            origin = directory / relative
            if (not directory.resolve().is_relative_to(releases.resolve())
                    or origin.is_symlink() or not origin.is_file()
                    or not origin.resolve().is_relative_to(directory.resolve())):
                raise ReleaseError('unsafe reused source: ' + name)
            dest = temporary / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            actual = hashlib.sha256()
            with origin.open('rb') as incoming, dest.open('xb') as out:
                for chunk in iter(lambda: incoming.read(1024 ** 2), b''):
                    actual.update(chunk)
                    out.write(chunk)
            if actual.hexdigest() != expected:
                raise ReleaseError('reused source checksum mismatch: ' + name)
            dest.chmod(0o644)
        temporary.chmod(0o755)
        for directory in temporary.rglob('*'):
            if directory.is_dir():
                directory.chmod(0o755)
        temporary.rename(target)
    except BaseException:
        # Only remove the exact temporary directory created by this invocation.
        shutil.rmtree(temporary)
        raise
    return target


def changed_components(state, manifest):
    return [c for c in COMPONENTS if state[c]['source'] != manifest['sources'][c]]


def requires_market_collector(backend, state=None):
    """Recognize deployed and candidate capability without trusting a false flag."""
    return ((state or {}).get('market_collector') is True
            or (Path(backend) / MARKET_CAPABILITY_FILE).is_file())


def requires_killboard_collector(backend, state=None):
    return ((state or {}).get('killboard_collector') is True
            or (Path(backend) / KILLBOARD_CAPABILITY_FILE).is_file())


@contextmanager
def market_collector_lock(root, required=False, component='market'):
    """Share the collector's pre-provisioned lock for the entire transaction.

    Never create/recreate this file: doing so could split the lock identity or
    grant incorrect ownership. Root provisions it for both service and deploy
    users; collector and publisher open the same regular inode without unlink.
    """
    if not required:
        yield
        return
    if component not in ('market', 'killboard'):
        raise ReleaseError('unknown collector lock')
    path = Path(root) / 'shared' / component / 'collector.lock'
    descriptor = None
    try:
        original = path.lstat()
        if not stat.S_ISREG(original.st_mode) or path.resolve() != path:
            raise ReleaseError('market collector lock must be a provisioned regular file')
        descriptor = os.open(path, os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)
                             | getattr(os, 'O_NONBLOCK', 0))
        opened = os.fstat(descriptor)
        if (not stat.S_ISREG(opened.st_mode)
                or (opened.st_dev, opened.st_ino) != (original.st_dev, original.st_ino)):
            raise ReleaseError('market collector lock identity changed')
    except (OSError, ValueError):
        if descriptor is not None:
            os.close(descriptor)
        raise ReleaseError('market collector lock unavailable; provision it before publishing') from None
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
        raise
    try:
        import fcntl
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReleaseError('market collector is busy; retry after the collection finishes') from None
        except OSError:
            raise ReleaseError('market collector lock could not be acquired') from None
        yield
    finally:
        os.close(descriptor)


def transact(root, old, new, changed, prepare, switch, restart, health, *, market_required=False):
    required = market_required or any(
        requires_market_collector(state['backend']['path'], state['backend'])
        for state in (old, new)
    )
    with market_collector_lock(root, required=required):
        if any(requires_killboard_collector(state['backend']['path'], state['backend']) for state in (old, new)):
            with market_collector_lock(root, required=True, component='killboard'):
                return _transact_locked(root, old, new, changed, prepare, switch, restart, health)
        return _transact_locked(root, old, new, changed, prepare, switch, restart, health)


def _transact_locked(root, old, new, changed, prepare, switch, restart, health):
    """Journal before switching; only commit state AFTER exact-version health succeeds.

    Hooks allow testing the transaction without running systemd or a production DB.
    Caller holds the server lock. SIGKILL leaves a journal requiring operator recovery.
    """
    root = Path(root)
    journal = root / 'transaction.json'
    if journal.exists():
        raise ReleaseError('unfinished transaction: operator recovery required')
    previous_file = root / 'previous.json'
    previous_before = json.loads(previous_file.read_text()) if previous_file.exists() else None
    prepare()
    atomic_json(journal, {'old': old, 'new': new, 'previous_before': previous_before,
                          'changed': changed, 'started': time.time()})
    try:
        for component in changed:
            switch(component, new[component]['path'])
        if 'backend' in changed:
            restart()
        health(new)
        atomic_json(root / 'previous.json', old)
        atomic_json(root / 'state.json', new)
    except BaseException as cause:
        try:
            for component in changed:
                switch(component, old[component]['path'])
            if 'backend' in changed:
                restart()
            health(old)
            # A signal can arrive immediately after os.replace(state.json), not just
            # during switching. Restore metadata too, or links/state will disagree.
            atomic_json(root / 'state.json', old)
            if previous_before is not None:
                atomic_json(previous_file, previous_before)
            elif previous_file.exists():
                previous_file.unlink()
        except BaseException as recovery:
            raise ReleaseError('release failed and recovery failed; inspect transaction.json') from recovery
        journal.unlink()
        raise ReleaseError('release failed; rolled back and recovery verified') from cause
    journal.unlink()


def command(args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, timeout=120)


def link(path, target):
    path = Path(path)
    if path.exists() and not path.is_symlink():
        raise ReleaseError('refusing to replace a real directory or file: ' + str(path))
    temporary = path.with_name(path.name + '.next')
    if temporary.exists() or temporary.is_symlink():
        raise ReleaseError('stale next link requires inspection: ' + str(temporary))
    try:
        temporary.symlink_to(target, target_is_directory=Path(target).is_dir())
        os.replace(temporary, path)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def prepare_backend(root, staged, manifest, config):
    registry = Path(root) / 'shared' / 'environments.json'
    environments = json.loads(registry.read_text()) if registry.exists() else {}
    environment = environments.get(manifest['dependencies'])
    if not environment or not (Path(environment) / 'bin/python').is_file():
        raise ReleaseError('dependency environment not registered; prepare and verify it first')
    backend = Path(staged) / 'backend'
    link(backend / '.venv', environment)
    for local, key in [('.env', 'env_file'), ('logs', 'logs'), ('static/uploads', 'uploads')]:
        target = Path(config[key])
        if not target.exists():
            raise ReleaseError('persistent path missing: ' + key)
        (backend / local).parent.mkdir(parents=True, exist_ok=True)
        link(backend / local, target)
    python = str(backend / '.venv/bin/python')
    command([python, 'manage.py', 'check'], cwd=backend)
    # Read-only gate. Version 1 NEVER migrates or installs packages on the live server.
    for database in ('default', 'license'):
        command([python, str(Path(__file__).with_name('migration_check.py')),
                 '--database', database], cwd=backend)
    prepare_community(root, backend, config,
                      required='backend/Community/health.py' in manifest['files'])
    prepare_market(root, backend,
                   required=('backend/' + MARKET_CAPABILITY_FILE) in manifest['files'])


def prepare_market(root, backend, required=False):
    """Check isolated collector dependencies without loading any private session."""
    backend = Path(backend).resolve()
    if not required and not requires_market_collector(backend):
        return
    runtime = (Path(root) / 'shared/market-python').resolve()
    if not runtime.is_dir():
        raise ReleaseError('market runtime unavailable; provision pinned dependencies before publishing')
    environment = dict(os.environ, PYTHONPATH=str(runtime), PYTHONDONTWRITEBYTECODE='1')
    # Importing these modules must not depend on Django or a provisioned account.
    environment.pop('DJANGO_SETTINGS_MODULE', None)
    environment.pop('MARKET_SESSION_FILE', None)
    try:
        subprocess.run(
            [str(backend / '.venv/bin/python'), '-B', '-c', MARKET_RUNTIME_PROBE,
             str(backend), MARKET_MSGPACK_VERSION, str(runtime),
             str((Path(root) / 'shared/market').resolve())],
            cwd=backend, env=environment, check=True, capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        raise ReleaseError('market runtime preflight failed; verify the pinned dependency environment') from None


def requires_community_readiness(backend, state=None):
    # The flag is derived from the validated artifact inventory. Checking the
    # target's module too preserves compatibility with state files made before
    # this publisher upgrade; a missing flag never disables a new target's gate.
    return (state or {}).get('community_ready') is True or (Path(backend) / 'Community/health.py').is_file()


def prepare_community(root, backend, config, required=False):
    if not required and not requires_community_readiness(backend):
        return  # A historical target predating this capability has no command.
    args = [str(Path(backend) / '.venv/bin/python'), 'manage.py', 'community_preflight']
    for forbidden in (Path(root) / 'releases', Path(root) / 'current',
                      Path(root) / 'shared/assets', Path(config['uploads'])):
        args.extend(['--forbidden-root', str(forbidden)])
    # Validates candidate settings/path only. The running service, not this
    # deploy account, checks its own effective filesystem access after restart.
    command(args, cwd=backend)


def prepare_assets(root, frontend):
    """Retain old hashed assets; Nginx /assets/ points at this additive shared cache."""
    assets = Path(root) / 'shared/assets'
    assets.mkdir(parents=True, exist_ok=True)
    assets.chmod(0o755)
    source = Path(frontend) / 'assets'
    for path in source.rglob('*'):
        if path.is_symlink():
            raise ReleaseError('asset symlink not permitted')
        if not path.is_file():
            continue
        dest = assets / path.relative_to(source)
        if dest.exists():
            if dest.is_symlink() or digest(dest.read_bytes()) != digest(path.read_bytes()):
                raise ReleaseError('asset collision; old content preserved')
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.asset-', dir=dest.parent)
        try:
            with os.fdopen(fd, 'wb') as out, path.open('rb') as incoming:
                shutil.copyfileobj(incoming, out)
            Path(temporary).chmod(0o644)
            os.replace(temporary, dest)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def restart_services(config):
    command(['sudo', '-n', '/bin/systemctl', 'restart', 'evem-backend.service'])
    if config.get('tactical_ws') is True:
        command(['sudo', '-n', '/bin/systemctl', 'restart', 'evem-tactical-asgi.service'])


def probe_tactical_websocket(origin):
    """Require a real HTTP 101 through the public TLS proxy, without credentials."""
    parsed = urlsplit(origin)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.path not in ('', '/'):
        raise ReleaseError('invalid tactical WebSocket health origin')
    connection_type = http.client.HTTPSConnection if parsed.scheme == 'https' else http.client.HTTPConnection
    connection = connection_type(parsed.hostname, parsed.port, timeout=5)
    try:
        connection.request('GET', '/ws/tactical/0/', headers={
            'Host': parsed.netloc,
            'Origin': origin.rstrip('/'),
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Key': base64.b64encode(os.urandom(16)).decode('ascii'),
            'Sec-WebSocket-Version': '13',
        })
        response = connection.getresponse()
        if response.status != 101 or response.getheader('Upgrade', '').lower() != 'websocket':
            raise ReleaseError('tactical WebSocket upgrade failed')
    finally:
        connection.close()


def health(config, state):
    def get(url, *, viewer_gate=False):
        request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
        try:
            response = urllib.request.urlopen(request, timeout=10)
        except HTTPError as error:
            # Data APIs deliberately deny anonymous access in a gated release.
            # Accept only the exact installed middleware contract, never an
            # arbitrary 401/403 or a denied asset/version/readiness endpoint.
            if (not viewer_gate or error.code != 401 or error.fp is None
                    or (error.headers or {}).get('WWW-Authenticate', '') != 'Bearer'):
                raise
            with error:
                if json.loads(error.read(2048)) == {
                        'detail': 'Authentication credentials were not provided.'}:
                    return b''
            raise
        with response:
            if response.status != 200:
                raise ReleaseError('health HTTP status failed')
            return response.read(2 * 1024 ** 2)
    failure = None
    for attempt in range(6):
        try:
            command(['systemctl', 'is-active', '--quiet', 'evem-backend.service'])
            origin = config['origin'].rstrip('/')
            html = get(origin + '/').decode('utf-8')
            for asset in re.findall(r'''(?:src|href)=["'](/assets/[^"']+)["']''', html):
                get(origin + asset)
            gate = Path(state['backend']['path']) / 'Authentication/middleware.py'
            get(origin + '/api/boardregions', viewer_gate=gate.is_file())
            for component, route in [('frontend', '/deploy-version.json'), ('backend', '/api/deploy-version/')]:
                expected = state[component]['sha']
                # Only bootstrap entries with explicit legacy=True can omit version proof.
                if state[component].get('legacy') is True:
                    continue
                actual = json.loads(get(origin + route + '?expected=' + expected))
                if actual.get('sha') != expected:
                    raise ReleaseError('wrong live version: ' + component)
            if requires_community_readiness(state['backend']['path'], state['backend']):
                ready = json.loads(get(origin + '/api/community/ready/?expected=' + state['backend']['sha']))
                if ready != {'status': 'ok'}:
                    raise ReleaseError('Community readiness failed')
            if config.get('tactical_ws') is True:
                command(['systemctl', 'is-active', '--quiet', 'evem-tactical-asgi.service'])
                probe_tactical_websocket(origin)
            return
        except (OSError, ValueError, ReleaseError, http.client.HTTPException, subprocess.SubprocessError) as exc:
            failure = exc
            if attempt < 5:
                time.sleep(2)
    raise ReleaseError('health checks failed') from failure


@contextmanager
def server_lock(root):
    import fcntl  # Linux only; imported lazily so pure tests and packing work on Windows.
    with (Path(root) / 'publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def state_token(state):
    return digest(json.dumps(state, sort_keys=True, separators=(',', ':')).encode())


def read_active_state(root):
    root = Path(root).resolve()
    if root == Path('/') or not (root / 'initialized.json').is_file():
        raise ReleaseError('server not initialized by an operator')
    if (root / 'transaction.json').exists():
        raise ReleaseError('unfinished transaction: operator recovery required')
    state = json.loads((root / 'state.json').read_text())
    if not isinstance(state, dict) or set(state) != set(COMPONENTS):
        raise ReleaseError('invalid recorded state')
    for component in COMPONENTS:
        entry = state[component]
        if (not isinstance(entry, dict) or not isinstance(entry.get('sha'), str)
                or not SHA.fullmatch(entry['sha']) or not isinstance(entry.get('source'), str)
                or not SHA.fullmatch(entry['source']) or not isinstance(entry.get('path'), str)):
            raise ReleaseError('invalid recorded component')
        recorded = Path(entry['path'])
        active = root / 'current' / component
        if (not recorded.is_absolute() or not recorded.resolve().is_relative_to(root / 'releases')
                or not recorded.is_dir() or not active.is_symlink()
                or active.resolve() != recorded.resolve()):
            raise ReleaseError('current links disagree with recorded state')
    return state


def verify_runtime_links(root, directory, manifest):
    """Verify link identity without reading configuration or persistent contents."""
    config = json.loads((Path(root) / 'config.json').read_text())
    environments = json.loads((Path(root) / 'shared/environments.json').read_text())
    environment = environments.get(manifest['dependencies'])
    if not isinstance(environment, str) or not (Path(environment) / 'bin/python').is_file():
        raise ReleaseError('active dependency environment unavailable')
    targets = {'.venv': environment, '.env': config.get('env_file'),
               'logs': config.get('logs'), 'static/uploads': config.get('uploads')}
    for local, target in targets.items():
        if not isinstance(target, str) or not Path(target).is_absolute() or not Path(target).exists():
            raise ReleaseError('active runtime target unavailable')
        item = Path(directory) / local
        if not item.is_symlink() or item.resolve() != Path(target).resolve():
            raise ReleaseError('active runtime link disagrees with configuration')


def active_inventory(root, state, component):
    """Check the recorded artifact against actual bytes before claiming reuse."""
    if state[component].get('legacy') is True:
        return None
    directory = Path(state[component]['path'])
    path = directory.parent / 'manifest.json'
    if not path.exists():
        return None  # Legacy initialization has no trustworthy inventory.
    if path.is_symlink() or path.stat().st_size > 4 * 1024 ** 2:
        raise ReleaseError('invalid active manifest')
    manifest = validate_manifest(json.loads(path.read_text()))
    if (manifest['sha'] != state[component]['sha']
            or manifest['sources'][component] != state[component]['source']):
        raise ReleaseError('active manifest disagrees with recorded state')
    if component == 'backend':
        verify_runtime_links(root, directory, manifest)
    files = {name: value for name, value in manifest['files'].items()
             if name.startswith(component + '/')}
    if not files:
        raise ReleaseError('active component inventory missing')
    for name, expected in files.items():
        item = directory / name.removeprefix(component + '/')
        if (item.is_symlink() or not item.resolve().is_relative_to(directory.resolve())
                or not item.is_file()):
            raise ReleaseError('unsafe active file: ' + name)
        actual = hashlib.sha256()
        with item.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 ** 2), b''):
                actual.update(chunk)
        if actual.hexdigest() != expected:
            raise ReleaseError('active checksum mismatch: ' + name)
    allowed_links = {'backend/.env', 'backend/.venv', 'backend/logs', 'backend/static/uploads'}
    for folder, directories, filenames in os.walk(directory, followlinks=False):
        for leaf in directories + filenames:
            item = Path(folder) / leaf
            name = component + '/' + item.relative_to(directory).as_posix()
            if item.is_symlink():
                if name not in allowed_links:
                    raise ReleaseError('unlisted active symlink: ' + name)
            elif item.is_dir() or name in files:
                continue
            elif '__pycache__' in item.relative_to(directory).parts and item.suffix == '.pyc':
                continue
            else:
                raise ReleaseError('unlisted active file: ' + name)
    return files


def product_inventory(files, component):
    policy = source_policy()
    return {name: value for name, value in files.items()
            if name.startswith(component + '/')
            and name not in {'backend/.release-sha', 'frontend/deploy-version.json'}
            and (component != 'backend' or policy.runtime_path(name))}


def _release_plan(root, old, manifest):
    validate_manifest(manifest)
    if manifest['format'] != 1 or manifest.get('policy') != source_policy().policy_digest():
        raise ReleaseError('incompatible planning source policy')
    changed, reuse = [], {}
    for component in COMPONENTS:
        current = active_inventory(root, old, component)
        if (current is None or product_inventory(current, component)
                != product_inventory(manifest['files'], component)):
            changed.append(component)
            if current is not None:
                reuse.update({name: value for name, value in manifest['files'].items()
                              if name.startswith(component + '/') and current.get(name) == value
                              and not name.startswith('backend/GameData/')})
    return {'format': 1, 'sha': manifest['sha'], 'policy': manifest['policy'],
            'base': state_token(old), 'components': changed, 'reuse': reuse}


def plan_release(root, manifest):
    root = Path(root).resolve()
    if root == Path('/') or not (root / 'initialized.json').is_file():
        raise ReleaseError('server not initialized by an operator')
    with server_lock(root):
        old = read_active_state(root)
        plan = _release_plan(root, old, manifest)
        if not plan['components']:
            health(json.loads((root / 'config.json').read_text()), old)
        return plan


def confirm_noop(root, plan):
    """Confirm trusted CI source evidence against the exact locked active pair."""
    if (not isinstance(plan, dict) or type(plan.get('format')) is not int
            or plan.get('format') != 1 or plan.get('action') != 'noop'
            or not isinstance(plan.get('sha'), str) or not SHA.fullmatch(plan['sha'])
            or plan.get('policy') != source_policy().policy_digest()
            or not isinstance(plan.get('baseline'), dict) or set(plan['baseline']) != set(COMPONENTS)
            or not isinstance(plan.get('inputs'), dict) or set(plan['inputs']) != set(COMPONENTS)):
        raise ReleaseError('invalid no-op source evidence')
    for component in COMPONENTS:
        inputs = plan['inputs'][component]
        if (not isinstance(inputs, dict) or not isinstance(inputs.get('head'), str)
                or not HASH.fullmatch(inputs['head']) or inputs.get('baseline') != inputs['head']):
            raise ReleaseError('unequal no-op source inputs')
    root = Path(root).resolve()
    if root == Path('/') or not (root / 'initialized.json').is_file():
        raise ReleaseError('server not initialized by an operator')
    with server_lock(root):
        old = read_active_state(root)
        if any(old[c]['sha'] != plan['baseline'][c] for c in COMPONENTS):
            raise ReleaseError('active versions changed; rerun complete CI')
        for component in COMPONENTS:
            if active_inventory(root, old, component) is None:
                raise ReleaseError('no verified active inventory; rerun with a product package')
        health(json.loads((root / 'config.json').read_text()), old)
        return {'format': 1, 'sha': plan['sha'], 'policy': plan['policy'],
                'base': state_token(old), 'components': []}


def check_delta_plan(root, old, manifest):
    if manifest['base'] != state_token(old):
        raise ReleaseError('active state changed after planning; rerun complete CI')
    plan = _release_plan(root, old, manifest['candidate'])
    if manifest['components'] != plan['components']:
        raise ReleaseError('delta does not match required components')
    if manifest.get('reuse', {}) != plan['reuse']:
        raise ReleaseError('delta does not match verified reuse inventory')
    return plan['components']


def publish(root, archive=None, rollback=False):
    root = Path(root).resolve()
    if root == Path('/') or not (root / 'initialized.json').is_file():
        raise ReleaseError('server not initialized by an operator')
    with server_lock(root):
        old = read_active_state(root)
        config = json.loads((root / 'config.json').read_text())
        if rollback:
            new = json.loads((root / 'previous.json').read_text())
            changed = [c for c in COMPONENTS if new[c]['path'] != old[c]['path']]
            def prepare():
                for c in COMPONENTS:
                    if not Path(new[c]['path']).is_dir():
                        raise ReleaseError('rollback release missing')
                if 'backend' in changed:
                    backend = Path(new['backend']['path'])
                    for database in ('default', 'license'):
                        command([str(backend / '.venv/bin/python'),
                                 str(Path(__file__).with_name('migration_check.py')),
                                 '--database', database], cwd=backend)
                    prepare_community(root, backend, config,
                                      required=new['backend'].get('community_ready') is True)
                    prepare_market(root, backend,
                                   required=new['backend'].get('market_collector') is True)
        else:
            manifest = validate(archive)
            changed = (check_delta_plan(root, old, manifest) if manifest['format'] == 2
                       else changed_components(old, manifest))
            if not changed:
                print('No component changes since last successful release.')
                return
            staged = stage(archive, root / 'releases', old)
            new = {**old}
            for component in changed:
                new[component] = {'source': manifest['sources'][component], 'sha': manifest['sha'],
                                  'path': str(staged / component)}
                if component == 'backend' and 'backend/Community/health.py' in manifest['files']:
                    new[component]['community_ready'] = True
                if component == 'backend' and ('backend/' + MARKET_CAPABILITY_FILE) in manifest['files']:
                    new[component]['market_collector'] = True
                if component == 'backend' and ('backend/' + KILLBOARD_CAPABILITY_FILE) in manifest['files']:
                    new[component]['killboard_collector'] = True
            def prepare():
                if 'backend' in changed:
                    prepare_backend(root, staged, manifest, config)
                if 'frontend' in changed:
                    prepare_assets(root, staged / 'frontend')
        transact(root, old, new, changed, prepare,
                 lambda c, dest: link(root / 'current' / c, dest),
                 lambda: restart_services(config),
                 lambda state: health(config, state),
                 market_required=config.get('market_collector') is True)
        print('Release verified: ' + ', '.join(changed))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    verify = sub.add_parser('verify')
    verify.add_argument('archive', type=Path)
    deploy = sub.add_parser('publish')
    deploy.add_argument('archive', type=Path)
    deploy.add_argument('--root', type=Path, default=Path('/EVEMTK/deploy'))
    rollback = sub.add_parser('rollback')
    rollback.add_argument('--root', type=Path, default=Path('/EVEMTK/deploy'))
    for action in ('plan', 'noop'):
        command_parser = sub.add_parser(action)
        command_parser.add_argument('--root', type=Path, default=Path('/EVEMTK/deploy'))
    args = parser.parse_args()
    if args.action == 'verify':
        print(json.dumps(validate(args.archive), sort_keys=True))
    elif args.action in ('plan', 'noop'):
        data = sys.stdin.buffer.read(4 * 1024 ** 2 + 1)
        if len(data) > 4 * 1024 ** 2:
            raise ReleaseError('oversized planning request')
        request = json.loads(data)
        result = plan_release(args.root, request) if args.action == 'plan' else confirm_noop(args.root, request)
        print(json.dumps(result, sort_keys=True))
    else:
        def interrupted(signum, frame):
            raise ReleaseError('interrupted; attempting safe rollback')
        signal.signal(signal.SIGTERM, interrupted)
        publish(args.root, getattr(args, 'archive', None), args.action == 'rollback')


if __name__ == '__main__':
    main()
