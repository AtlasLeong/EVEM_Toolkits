"""Compare committed runtime inputs with the two publicly active releases.

Run after the complete CI test suite. Only an exact fingerprint match for both
components permits a no-op; unavailable version proof always requires a release.
This module also supplies the backend artifact's test/document exclusion policy.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import urllib.request
from urllib.parse import urlsplit


COMPONENTS = ('frontend', 'backend')
SOURCE_ROOTS = {'frontend': 'front-codex/', 'backend': 'backend/'}
VERSION_URLS = {
    'frontend': 'https://evemtk.com/deploy-version.json',
    'backend': 'https://evemtk.com/api/deploy-version/',
}
SHA = re.compile(r'^[0-9a-f]{40}$')
VERSION_TIMEOUT = 10
MAX_VERSION_BYTES = 16 * 1024

# These are reviewed repository paths, not filename/suffix heuristics. New apps,
# root directories, test-like filenames, settings, migrations and build inputs
# remain runtime inputs until their non-runtime role is explicitly reviewed.
NON_RUNTIME_DIRECTORIES = (
    'docs/',
    'front-codex/tests/',
    'backend/GameData/tests/',
    'backend/GameSessions/tests/',
    'backend/Killboard/tests/',
    'backend/Market/tests/',
    'backend/TacticalCollaboration/tests/',
    'scripts/community/tests/',
    'scripts/deploy/tests/',
    'scripts/game_data/tests/',
    'scripts/game_data/client_assets/tests/',
    'scripts/killboard/tests/',
    'scripts/starsea/tests/',
    'scripts/tactical/tests/',
)
NON_RUNTIME_FILES = frozenset({
    'DEPLOY_PRODUCTION.md',
    'LOCAL_DEV.md',
    'README.md',
    'design-qa.md',
    'backend/CLAUDE.md',
    'backend/README.md',
    'backend/Community/README.md',
    'backend/Market/data/README.md',
    'front-codex/AUTOMATION_TESTS.md',
    'front-codex/README.md',
    'front-codex/RECOVERY_TASKS.md',
    'front-codex/TEST_CHECKLIST.md',
    'front-codex/TEST_CHECKLIST_MATRIX.md',
    'front-codex/playwright.config.js',
    'output/research/client-icons-2026-09-29/README.md',
    'scripts/community/README.md',
    'scripts/deploy/README.md',
    'scripts/game_data/README.md',
    'scripts/game_data/client_assets/README.md',
    'scripts/starsea/README.md',
    'scripts/tactical/README.md',
    'backend/ActivationCode/tests.py',
    'backend/Authentication/test_public_auth.py',
    'backend/Authentication/test_public_read_access.py',
    'backend/Authentication/test_viewer_access.py',
    'backend/Authentication/tests.py',
    'backend/Bazaar/tests.py',
    'backend/Community/tests.py',
    'backend/Community/tests_activity.py',
    'backend/Community/tests_identity_unicode.py',
    'backend/Community/tests_location.py',
    'backend/Community/tests_media_storage.py',
    'backend/Community/tests_preflight.py',
    'backend/Community/tests_query_bounds.py',
    'backend/Community/tests_request_boundaries.py',
    'backend/EVE_MDjango/tests_deployment.py',
    'backend/EVE_MDjango/tests_market_mysql_ci_settings.py',
    'backend/EVE_MDjango/tests_market_mysql_integration.py',
    'backend/EVE_MDjango/tests_market_rehearsal_settings.py',
    'backend/EVE_MDjango/tests_market_worker_settings.py',
    'backend/Feedback/tests.py',
    'backend/FraudList/tests.py',
    'backend/License/tests.py',
    'backend/License/tests_management.py',
    'backend/PlanetaryResource/tests.py',
    'backend/StarFieldSearch/tests.py',
    'backend/Starsea/tests.py',
    'backend/Starsea/tests_catalog.py',
    'backend/TacticalBoard/test_public_scope.py',
    'backend/TacticalBoard/test_routing.py',
    'backend/TacticalBoard/test_routing_api.py',
    'backend/TacticalBoard/test_routing_data.py',
    'backend/TacticalBoard/test_routing_oracle.py',
    'backend/TacticalBoard/tests.py',
    'backend/test_data',
    'backend/tests_starsea_local.py',
    'backend/tests_tactical_local.py',
    'backend/tests_tactical_transport.py',
    'backend/tests_tactical_universe.py',
})

# Delivery/verification controls do not enter either application payload. Keep
# this an explicit inventory: a new deployment script still fails closed until
# reviewed. The server separately verifies/installs its release.py and this
# policy module; policy_digest binds plans and artifacts to that installation.
CONTROL_FILES = frozenset({
    '.github/workflows/ci.yml',  # Frontend build semantics are added separately.
    '.github/workflows/deploy.yml',
    'scripts/deploy/.gitignore',
    'scripts/deploy/activate_tactical_ws.py',
    'scripts/deploy/config.example.json',
    'scripts/deploy/evem-backend.override.conf.example',
    'scripts/deploy/evem-killboard-collector.service.example',
    'scripts/deploy/evem-killboard-collector.timer.example',
    'scripts/deploy/evem-market-collector.service.example',
    'scripts/deploy/evem-market-collector.timer.example',
    'scripts/deploy/evem-tactical-asgi.service.example',
    'scripts/deploy/feedback_configure_server.py',
    'scripts/deploy/feedback_mysql_preflight.py',
    'scripts/deploy/killboard_mysql_worker_provision.py',
    'scripts/deploy/market_backup_offhost_encrypt.py',
    'scripts/deploy/market_mysql_backup.py',
    'scripts/deploy/market_mysql_qa_provision.py',
    'scripts/deploy/market_mysql_restore_rehearsal.py',
    'scripts/deploy/market_mysql_worker_provision.py',
    'scripts/deploy/migration_check.py',
    'scripts/deploy/nginx-locations.conf.example',
    'scripts/deploy/pack.py',
    'scripts/deploy/release.py',
    'scripts/deploy/requirements-ci.txt',
    'scripts/deploy/requirements-market.txt',
    'scripts/deploy/run-killboard-collector.sh',
    'scripts/deploy/source_plan.py',
    'scripts/deploy/tactical-nginx-location.example.conf',
    'scripts/deploy/tactical_multiboard_preflight.py',
    'scripts/deploy/transfer.py',
    'scripts/deploy/transport.sh',
})

# SHA256 of normalized, complete YAML blocks reviewed in the old/new CI. Names
# identify the review scope; they never authorize ignoring an altered command,
# step environment, action, or unknown property. Unrecognized blocks make the
# entire CI document an opaque frontend build input. These blocks are reviewed
# against production frontend commit 0f1a60a and the CI/package separation.
CI_CONTROL_TOP = {
    'name': ('06e1b32fa09079ae2f0001fff0eca27b4985957d4eb4857929b3cf058faae541',),
    'on': ('062ea3c77d9dabcf8d4987f6696d824f2a34b59aee1c7793683a6dda1af5fd6b',),
    'permissions': ('e8f2263b0413f25128aa11d16dd3ae0ef6b0c660fb5b1dc08fe71e0a7daabb4b',),
}
CI_CONTROL_JOBS = {
    'market_mysql': ('c1b22cd216ef0b85cce61aec364c950dda003ff5febb550dc8d1e7cf27c39021',),
    'package': ('e367b52def94454c1aab7017c779bf5273a983dba47812d2979c2d17ffb71bd2',),
}
CI_CONTROL_METADATA = {
    'outputs': ('8d059df492dced95f4ff36228b43dddef7847802d337bed910b70232a97c0840',),
}
CI_CONTROL_STEPS = {
    'Community QA tool safety tests (no database or credentials)':
        ('b59d580c62fc7363ac7623553ec877876701d602502704954a05e8a9f6b6f1c2',),
    'Enforce frontend bundle budget':
        ('a4ce14ff086ca7ad241a7c46948d35ea6540ca7cc8c03625a217e56e9856b758',),
    'Frontend dependencies ready':
        ('517b4b3ab278a65751cd3eb4fff3fe4eab5350cb2afef145dac5d832268689d1',),
    'Frontend unit and local preview contract tests':
        ('891a8ebff68fe6cdb20d38d0435a08d81f2b888f3a9eb9f5c48c2e58153c9b3b',),
    'Full frontend regression suite':
        ('2e472404d18108f8bbb48c8d3f3d3e39df1ba0ed15f2d8e290d2783d92515fc1',),
    'Install isolated backend test dependencies':
        ('f5b73172b948a4350168fa5db34922161d8bafb9b7aa8c76940738a7a8902c04',),
    'Install test browser':
        ('29b3c56e49a13d00a0aa9d6c08f6035750b03be4bcf763cc0426e86fadf49fb0',),
    'Interactive local preview workflow (independent configuration)':
        ('fbf436853a4cd3934e2aff340defdfb3f12f3d63525f40b60a5bc477db98fecc',),
    'Keep failure evidence':
        ('87f1fcb7244718830eb7e9b43d040f89d115fbbe65957f8e94045f1ff78e412b',),
    'Keep verified frontend build for packaging':
        ('2d98ea103faf65cf0ca1755541bc185ebb10769a036345e4b95c10b120d7c5d6',),
    'Keep verified release plan':
        ('70742618d894846e16525f5a0b7a4ca510dea8cbb96709d3969120b0511b076a',),
    'License, activation, feedback, community and deployment-version tests (isolated SQLite)':
        ('e7a5d2a3d78c725c84cad6b9542993d125a520ff717141e8cd3b6271b7ca5ca1',),
    'Market price and collection tests (isolated SQLite)':
        ('01e3233a7bb8344d8ff653281fb54497dbedb0339939199b0e0688f5d3d3271f',),
    'Package verified commit':
        ('326096ddb57371148e5006d7ae169079b6761bf5d14c1f71c1f8c1247dccf2a5',),
    'Plan publishable source changes':
        ('0e948b551aea2f0450ea52cd183e087fe81055c6df39ea26be0a0a2c61d1e917',),
    'Prepare isolated check evidence':
        ('bd8e68741a08f4c59f982d37170aac8d28f22eebe85b69f8fc7138d903706750',),
    'Private Killboard and shared game catalog regression':
        ('d0082cb7468f23f6187f835fbea0b3cf5efd405e7b1a9e8f3cbf8a0330934e3f',),
    'Private capture tooling and game data provenance tests':
        ('5364d623cc4a29e32580f7dcc1a68418b6649ec8d952396bab927fe4fbfaf217',),
    'Public access, account verification and refresh-token policy (isolated)':
        ('33794063ed6b9d5686c06be1c0d315ae455c0be6537bdc2ec5578f1c54f2a10c',),
    'Release safety tests':
        ('200288f623d622ecc8e13e7d4e59de5bd171a92a25a82349a31cd24b8283546b',),
    'Tactical authorization, presence and transport tests (isolated SQLite)':
        ('7a3e5c4975c7db09d0e0bf79a38be9636a1df8d827eabc573156bffc19e4fc41',),
    'Tactical fixture safety tests (no remote access)':
        ('f75c6a7142e387434e3c31da7f25969c9a8dcd155c243529a5850882726dab35',),
    'Tactical frontend workflow (mock API, not backend security proof)':
        ('2dc6f41118908b3d9694c2f3c9df322a8bc75aef8b6ce41f3411849d24e17bdb',),
    'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5':
        ('92b324f01e6101e2525576d89f10a0c87454d13b55fb43c80025e8f8c079b3cc',),
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4':
        ('e60124ee7a2ecbeaf82b3915eab25a3422ec78128312cf57b05a978d5370d0d7',),
}


class PlanError(RuntimeError):
    pass


def runtime_path(name):
    """Whether a repository-relative POSIX path is a runtime/build input.

    Backend manifests use the same function to exclude the reviewed test/docs
    paths. Built frontend dist files must not be filtered by this source policy.
    """
    if (not isinstance(name, str) or not name or '\\' in name or '\x00' in name
            or name.startswith('/') or ':' in name
            or any(part in ('', '.', '..') for part in name.split('/'))
            or str(PurePosixPath(name)) != name):
        raise PlanError('invalid repository input path')
    return (name not in NON_RUNTIME_FILES and name not in CONTROL_FILES
            and not name.startswith(NON_RUNTIME_DIRECTORIES))


def policy_digest():
    """Bind decisions to the installed policy, independent of checkout newlines."""
    return hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def _valid_sha(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def _git(repo, *args, timeout=30, config=()):
    # No credential helpers, interactive prompts or global credential/config
    # loading. Partial clones cannot silently contact a remote during ls-tree.
    environment = {key: value for key, value in os.environ.items()
                   if key in {'PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
                              'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE'}}
    environment.update({
        'GIT_CONFIG_GLOBAL': os.devnull,
        'GIT_CONFIG_NOSYSTEM': '1',
        'GIT_TERMINAL_PROMPT': '0',
        'GIT_NO_LAZY_FETCH': '1',
        'GIT_NO_REPLACE_OBJECTS': '1',
        'GIT_ASKPASS': '',
    })
    options = ('credential.helper=', 'credential.interactive=false',
               'core.askPass=', 'http.extraHeader=', 'http.cookieFile=',
               'http.saveCookies=false', 'http.proxy=', *config)
    command = ['git']
    for option in options:
        command.extend(['-c', option])
    try:
        return subprocess.run(command + list(args), cwd=repo, env=environment,
                              check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        # Remote errors/configured URLs can contain credentials. Never echo them.
        raise PlanError('git input unavailable') from None


def _fetch_commit(repo, sha):
    """Fetch only a validated commit from an anonymous public HTTPS origin."""
    if not _valid_sha(sha):
        raise PlanError('invalid active commit')
    try:
        origin = _git(repo, 'remote', 'get-url', 'origin').decode('utf-8').strip()
        parsed = urlsplit(origin)
        port = parsed.port
    except (UnicodeError, ValueError):
        raise PlanError('public origin unavailable') from None
    if (parsed.scheme != 'https' or parsed.hostname not in {
            'github.com', 'gitlab.com', 'gitcode.com', 'atomgit.com'}
            or parsed.username is not None or parsed.password is not None
            or port is not None or not parsed.path.startswith('/')
            or parsed.path == '/' or parsed.query or parsed.fragment):
        raise PlanError('anonymous public HTTPS origin required')
    # Use the validated origin URL directly, avoiding remote-specific transport
    # settings. URL-specific overrides suppress inherited auth headers/cookies.
    overrides = tuple(f'http.{origin}.{key}={value}' for key, value in (
        ('extraHeader', ''), ('cookieFile', ''), ('saveCookies', 'false'),
        ('proxy', ''), ('sslCert', ''), ('sslKey', ''),
    )) + (f'credential.{origin}.helper=', 'protocol.allow=never',
          'protocol.https.allow=always')
    _git(repo, 'fetch', '--depth=1', '--no-tags', '--no-write-fetch-head',
         origin, sha, timeout=60, config=overrides)


def _ensure_commit(repo, sha):
    if not _valid_sha(sha):
        raise PlanError('invalid active commit')
    try:
        _git(repo, 'cat-file', '-e', sha + '^{commit}')
    except PlanError:
        _fetch_commit(repo, sha)
        _git(repo, 'cat-file', '-e', sha + '^{commit}')


def _tree(repo, sha):
    if not _valid_sha(sha):
        raise PlanError('invalid source commit')
    records = []
    for record in _git(repo, 'ls-tree', '-r', '-z', '--full-tree', sha).split(b'\0'):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b'\t', 1)
            mode, kind, blob = metadata.split(b' ')
            name = raw_path.decode('utf-8')
            if not _valid_sha(blob.decode('ascii')):
                raise ValueError
        except (UnicodeError, ValueError):
            raise PlanError('invalid committed tree entry') from None
        records.append((name, mode, kind, blob, raw_path))
    return records


class _UnknownCI(ValueError):
    pass


def _block_text(lines):
    return '\n'.join(lines).strip('\n') + '\n'


def _block_digest(lines):
    return hashlib.sha256(_block_text(lines).encode('utf-8')).hexdigest()


def _mapping_blocks(lines, indentation):
    """Read only simple, unique mapping keys at one exact indentation level."""
    blocks = {}
    current = None
    for line in lines:
        if '\t' in line:
            raise _UnknownCI
        if not line.strip():
            if current is not None:
                blocks[current].append(line)
            continue
        actual = len(line) - len(line.lstrip(' '))
        if line.lstrip().startswith('#') and actual <= indentation:
            continue
        if actual < indentation:
            raise _UnknownCI
        if actual == indentation:
            match = re.fullmatch(r' *([A-Za-z_][A-Za-z_0-9-]*):(?: .*|)', line)
            if match is None or match[1] in blocks:
                raise _UnknownCI
            current = match[1]
            blocks[current] = [line]
        else:
            if current is None:
                raise _UnknownCI
            blocks[current].append(line)
    return blocks


def _children(block):
    if re.fullmatch(r' *[A-Za-z_][A-Za-z_0-9-]*:', block[0]) is None:
        raise _UnknownCI
    return block[1:]


def _step_blocks(lines):
    blocks = []
    for line in lines:
        if not line.strip():
            if blocks:
                blocks[-1].append(line)
            continue
        actual = len(line) - len(line.lstrip(' '))
        if line.lstrip().startswith('#') and actual <= 6:
            continue
        if actual < 6:
            raise _UnknownCI
        if actual == 6:
            if re.fullmatch(r'      - (?:name|uses): .+', line) is None:
                raise _UnknownCI
            blocks.append([line])
        else:
            if not blocks:
                raise _UnknownCI
            blocks[-1].append(line)
    return blocks


def _step_properties(block):
    return _mapping_blocks(['        ' + block[0][8:]] + block[1:], 8)


def _scalar(block):
    if len([line for line in block if line.strip()]) != 1:
        raise _UnknownCI
    return block[0].split(':', 1)[1].strip()


def _reviewed(inventory, key, block):
    return _block_digest(block) in inventory.get(key, ())


def frontend_build_context(content):
    """Extract only the reviewed CI subset; unknown syntax hashes the full file.

    This is deliberately not a general YAML parser. The selected blocks include
    the runner, checkout, Node setup, dependency installation, frontend build,
    and global/job env/defaults. Selected steps retain every property, including
    step env/shell/working-directory. Only exact reviewed control blocks can be
    discarded, so adding/changing a pre-build step cannot silently permit noop.
    """
    normalized = content.replace(b'\r\n', b'\n')
    try:
        text = normalized.decode('utf-8')
        if '\t' in text:
            raise _UnknownCI
        top = _mapping_blocks(text.splitlines(), 0)
        context = {'global': {}, 'validate': {}, 'steps': []}
        for key, block in top.items():
            if key in ('env', 'defaults'):
                context['global'][key] = _block_text(block)
            elif key != 'jobs' and not _reviewed(CI_CONTROL_TOP, key, block):
                raise _UnknownCI
        jobs = _mapping_blocks(_children(top['jobs']), 2)
        for name, block in jobs.items():
            if name != 'validate' and not _reviewed(CI_CONTROL_JOBS, name, block):
                raise _UnknownCI
        validate = _mapping_blocks(_children(jobs['validate']), 4)
        for key, block in validate.items():
            if key in ('runs-on', 'env', 'defaults'):
                context['validate'][key] = _block_text(block)
            elif key == 'timeout-minutes' and re.fullmatch(r'[0-9]+', _scalar(block)):
                continue  # A timeout aborts CI; it cannot produce a successful build.
            elif key != 'steps' and not _reviewed(CI_CONTROL_METADATA, key, block):
                raise _UnknownCI
        if 'runs-on' not in validate:
            raise _UnknownCI
        roles = []
        allowed = {'name', 'id', 'uses', 'with', 'run', 'working-directory',
                   'shell', 'env', 'if', 'timeout-minutes'}
        for block in _step_blocks(_children(validate['steps'])):
            properties = _step_properties(block)
            if set(properties) - allowed:
                raise _UnknownCI
            name = _scalar(properties['name']) if 'name' in properties else ''
            uses = _scalar(properties['uses']) if 'uses' in properties else ''
            if uses.startswith('actions/setup-node@'):
                role = 'node'
            elif uses.startswith('actions/checkout@'):
                role = 'checkout'
            elif name == 'Install frontend dependencies':
                role = 'install'
            elif name == 'Build frontend':
                role = 'build'
            elif _reviewed(CI_CONTROL_STEPS, name or uses, block):
                continue
            else:
                raise _UnknownCI
            roles.append(role)
            context['steps'].append(_block_text(block))
        if sorted(roles) != ['build', 'checkout', 'install', 'node']:
            raise _UnknownCI
        return b'reviewed-ci-build-v1\0' + json.dumps(
            context, sort_keys=True, separators=(',', ':')).encode('utf-8')
    except (UnicodeError, KeyError, _UnknownCI):
        return b'opaque-ci-build-v1\0' + hashlib.sha256(normalized).digest()


def _ci_context(repo, records):
    for name, mode, kind, blob, raw_path in records:
        if name != '.github/workflows/ci.yml':
            continue
        if kind != b'blob' or mode not in (b'100644', b'100755'):
            raise PlanError('unsupported CI build input')
        return mode + b'\0' + frontend_build_context(
            _git(repo, 'cat-file', 'blob', blob.decode('ascii')))
    return b'ci-build-not-defined-v1'


def _fingerprint(records, component, *, ci_context=None):
    if component not in COMPONENTS:
        raise PlanError('unknown component')
    fingerprint = hashlib.sha256(b'evem-runtime-inputs-v1\0' + component.encode() + b'\0')
    own_root = SOURCE_ROOTS[component]
    other_root = SOURCE_ROOTS[COMPONENTS[1 - COMPONENTS.index(component)]]
    own_files = 0
    for name, mode, kind, blob, raw_path in sorted(records, key=lambda item: item[4]):
        if not runtime_path(name) or name.startswith(other_root):
            continue
        if kind != b'blob' or mode not in (b'100644', b'100755'):
            raise PlanError('unsupported runtime tree entry')
        if name.startswith(own_root):
            own_files += 1
        # Path, executable mode and committed blob identity all affect the hash.
        # Unknown/shared paths outside either source root are included in both.
        fingerprint.update(mode + b' ' + kind + b' ' + blob + b'\t' + raw_path + b'\0')
    if not own_files:
        raise PlanError('component runtime inputs missing')
    if component == 'frontend':
        if ci_context is None:
            raise PlanError('frontend build context unavailable')
        fingerprint.update(b'virtual\0.github/workflows/ci.yml:build\0'
                           + hashlib.sha256(ci_context).digest() + b'\0')
    return fingerprint.hexdigest()


def component_fingerprint(repo, commit, component):
    """Hash committed ls-tree blob identities and modes, never working files."""
    repo = Path(repo)
    records = _tree(repo, commit)
    return _fingerprint(records, component, ci_context=(
        _ci_context(repo, records) if component == 'frontend' else None))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PlanError('active version redirect refused')


def read_active_versions(*, timeout=VERSION_TIMEOUT, open_url=None):
    """Read exactly the two public version endpoints without authentication.

    Return an empty baseline if either response is unavailable or malformed.
    Both GETs are attempted independently; a partial baseline never proves noop.
    """
    if not isinstance(timeout, (int, float)) or not 0 < timeout <= 60:
        raise PlanError('invalid version request timeout')
    if open_url is None:
        # Do not pick up authenticated proxies from the caller's environment.
        open_url = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), _NoRedirect()).open
    baseline = {}
    for component, url in VERSION_URLS.items():
        request = urllib.request.Request(url, method='GET', headers={
            'Accept': 'application/json', 'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        })
        try:
            with open_url(request, timeout=timeout) as response:
                if response.status != 200:
                    raise PlanError('active version HTTP failure')
                content = response.read(MAX_VERSION_BYTES + 1)
            if len(content) > MAX_VERSION_BYTES:
                raise PlanError('oversized active version response')
            value = json.loads(content)
            if not isinstance(value, dict) or not _valid_sha(value.get('sha')):
                raise PlanError('invalid active version response')
            baseline[component] = value['sha']
        except (OSError, ValueError, TypeError, PlanError, http.client.HTTPException):
            continue
    return baseline if set(baseline) == set(COMPONENTS) else {}


def build_plan(repo, baseline=None):
    """Make a fail-closed release/noop decision using each component's active SHA."""
    repo = Path(repo)
    try:
        sha = _git(repo, 'rev-parse', '--verify', 'HEAD^{commit}').decode('ascii').strip()
    except UnicodeError:
        raise PlanError('invalid HEAD commit') from None
    if not _valid_sha(sha):
        raise PlanError('invalid HEAD commit')
    if baseline is None:
        baseline = read_active_versions()
    if (not isinstance(baseline, dict) or set(baseline) != set(COMPONENTS)
            or not all(_valid_sha(value) for value in baseline.values())):
        baseline = {}
    else:
        baseline = dict(baseline)
    tree_cache = {sha: _tree(repo, sha)}
    inputs = {component: {'head': _fingerprint(tree_cache[sha], component, ci_context=(
        _ci_context(repo, tree_cache[sha]) if component == 'frontend' else None)),
                          'baseline': None} for component in COMPONENTS}
    reasons = []
    if not baseline:
        reasons.append('active-version-proof-unavailable')
    for component in COMPONENTS:
        if component not in baseline:
            continue
        active = baseline[component]
        try:
            if active not in tree_cache:
                _ensure_commit(repo, active)
                tree_cache[active] = _tree(repo, active)
            inputs[component]['baseline'] = _fingerprint(
                tree_cache[active], component, ci_context=(
                    _ci_context(repo, tree_cache[active]) if component == 'frontend' else None))
        except PlanError:
            reasons.append('active-commit-unavailable:' + component)
            continue
        if inputs[component]['head'] != inputs[component]['baseline']:
            reasons.append('runtime-inputs-changed:' + component)
    noop = (not reasons and all(inputs[c]['head'] == inputs[c]['baseline']
                               for c in COMPONENTS))
    return {'format': 1, 'policy': policy_digest(),
            'action': 'noop' if noop else 'release', 'sha': sha,
            'baseline': baseline, 'inputs': inputs, 'reasons': reasons}


def _write_plan(output, plan):
    output = Path(output)
    fd, temporary = tempfile.mkstemp(prefix='.' + output.name + '.', dir=output.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(plan, stream, sort_keys=True, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--output', type=Path, default=Path('release-plan.json'))
    args = parser.parse_args()
    try:
        plan = build_plan(args.repo)
        _write_plan(args.output, plan)
    except (OSError, PlanError):
        parser.exit(1, 'Unable to prove committed release inputs; planning failed closed.\n')
    print('Release plan: ' + plan['action'] + ' (' + plan['sha'] + ')')


if __name__ == '__main__':
    main()
