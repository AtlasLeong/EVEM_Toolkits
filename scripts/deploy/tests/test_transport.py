"""Exercise the real transport shell and artifact code with local SSH/SCP fakes.

Only the deployment programs are copied into the disposable checkout. Credentials
are literal ``fixture`` strings, remote commands are never executed, and the fake
commands record every connection and transferred archive. Linux CI runs these
tests automatically; Windows uses Git Bash rather than the WSL launcher.
"""
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


DIRECTORY = Path(__file__).resolve().parents[1]
NEW_SHA = 'a' * 40
TARGET = 'evem-deploy@8.134.144.49'
REMOTE_COMMAND = '/usr/local/lib/evem-deploy/runtime/bin/python /usr/local/lib/evem-deploy/release.py '
REMOTE_ARCHIVE = '/EVEMTK/deploy/incoming/' + NEW_SHA + '-23-2.tar.gz'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def shell_path(path):
    """Use Git Bash paths in PATH/TMPDIR, and native paths in Python fixtures."""
    value = Path(path).resolve().as_posix()
    if os.name == 'nt':
        return '/' + value[0].lower() + value[2:]
    return value


def find_bash():
    if os.name != 'nt':
        return shutil.which('bash')
    # C:\\Windows\\System32\\bash.exe is WSL, not the host's Git Bash.
    candidates = []
    git = shutil.which('git')
    if git:
        candidates.append(Path(git).resolve().parent.parent / 'bin/bash.exe')
    for variable in ('ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'):
        directory = os.environ.get(variable)
        if directory:
            candidates.append(Path(directory) / 'Git/bin/bash.exe')
    return next((str(path) for path in candidates if path.is_file()), None)


BASH = find_bash()

# This program is used only by the temporary ssh/scp/python wrappers. In
# particular, no remote command string is passed to a shell or subprocess.
FAKE_RUNNER = r'''
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile

root = Path(os.environ['EVEM_FIXTURE_ROOT'])
tool, args = sys.argv[1], sys.argv[2:]

def native_path(value):
    if os.name == 'nt' and len(value) > 3 and value[0] == '/' and value[1].isalpha() and value[2] == '/':
        value = value[1] + ':' + value[2:]
    return Path(value)

def record(name, value):
    with (root / name).open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(value, sort_keys=True) + '\n')

if tool == 'python':
    record('python-events.jsonl', args)
    converted = [str(native_path(arg)) if arg.startswith('/') else arg for arg in args]
    raise SystemExit(subprocess.call([sys.executable, *converted]))

config = json.loads((root / 'scenario.json').read_text(encoding='utf-8'))
key = native_path(args[1])
assert args[0] == '-i' and key.name == 'key'
options = args[2:-2]
assert len(options) == 14 and options[::2] == ['-o'] * 7
settings = options[1::2]
assert settings[:3] == ['BatchMode=yes', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=yes']
assert settings[3].startswith('UserKnownHostsFile=')
known_hosts = native_path(settings[3].split('=', 1)[1])
assert settings[4:] == ['ConnectTimeout=15', 'ServerAliveInterval=15', 'ServerAliveCountMax=4']
assert known_hosts.parent == key.parent and known_hosts.name == 'known_hosts'
assert key.parent.parent.resolve() == (root / 'ssh-temporary').resolve()
assert key.read_bytes() == b'fixture\n' and known_hosts.read_bytes() == b'fixture\n'
assert 'EVEM_SSH_KEY' not in os.environ and 'EVEM_KNOWN_HOSTS' not in os.environ
if os.name != 'nt':
    assert stat.S_IMODE(key.stat().st_mode) == 0o600
    assert stat.S_IMODE(known_hosts.stat().st_mode) == 0o600
    assert stat.S_IMODE(key.parent.stat().st_mode) == 0o700
event = {'tool': tool, 'args': args, 'key': str(key), 'known_hosts': str(known_hosts)}
if tool == 'ssh':
    assert args[-2] == config['target']
    command = args[-1]
    assert command.startswith(config['remote_command'])
    action = command[len(config['remote_command']):]
    assert action in ('noop', 'plan', 'rollback', 'publish ' + config['remote_archive'])
    event['action'] = action.split()[0]
    event['stdin'] = sys.stdin.read()
    record('events.jsonl', event)
    if config.get('ssh_failure') == event['action']:
        print('synthetic SSH/authentication/planner failure', file=sys.stderr)
        raise SystemExit(config.get('ssh_status', 1))
    if action in ('noop', 'plan'):
        request = json.loads(event['stdin'])
        assert request == json.loads((root / 'expected-input.json').read_text(encoding='utf-8'))
        if action == 'noop':
            state = json.loads((root / 'state.json').read_text(encoding='utf-8'))
            if any(request['baseline'][component] != state[component]['sha'] for component in state):
                print('synthetic active versions changed', file=sys.stderr)
                raise SystemExit(1)
            assert request['action'] == 'noop' and request['policy'] == config['policy']
            assert all(item['head'] == item['baseline'] for item in request['inputs'].values())
        sys.stdout.write((root / 'remote-plan.json').read_text(encoding='utf-8'))
    elif action == 'rollback':
        shutil.copyfile(root / 'previous.json', root / 'state.json')
    else:
        assert (root / 'uploaded.tar.gz').is_file(), 'publish attempted before SCP completed'
        with tarfile.open(root / 'uploaded.tar.gz') as archive:
            manifest = json.load(archive.extractfile('manifest.json'))
        old = json.loads((root / 'state.json').read_text(encoding='utf-8'))
        base = hashlib.sha256(json.dumps(old, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        assert manifest['base'] == base, 'stale active state at publish'
        state = dict(old)
        for component in manifest['components']:
            state[component] = {**old[component], 'sha': manifest['sha'], 'source': manifest['sources'][component]}
        shutil.copyfile(root / 'state.json', root / 'previous.json')
        (root / 'state.json').write_text(json.dumps(state), encoding='utf-8')
elif tool == 'scp':
    assert args[-1] == config['target'] + ':' + config['remote_archive']
    upload = native_path(args[-2])
    assert upload.parent == key.parent and upload.name == 'upload.tar.gz'
    with tarfile.open(upload) as archive:
        event['members'] = archive.getnames()
        event['manifest'] = json.load(archive.extractfile('manifest.json'))
        event['hashes'] = {member.name: hashlib.sha256(archive.extractfile(member).read()).hexdigest()
                           for member in archive.getmembers() if member.name != 'manifest.json'}
    event['bytes'] = upload.stat().st_size
    record('events.jsonl', event)
    if config.get('scp_failure'):
        print('synthetic SCP failure', file=sys.stderr)
        raise SystemExit(23)
    shutil.copyfile(upload, root / 'uploaded.tar.gz')
else:
    raise AssertionError('unexpected fake command ' + tool)
'''


class TransportTests(unittest.TestCase):
    def setUp(self):
        if not BASH:
            if os.name == 'nt':
                self.skipTest('Git Bash is unavailable; these tests still run in Linux CI')
            self.fail('bash is required for the transport tests in Linux CI')
        self.tmp = tempfile.TemporaryDirectory(prefix='evem-transport-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.checkout = self.root / 'checkout'
        deploy = self.checkout / 'scripts/deploy'
        deploy.mkdir(parents=True)
        for name in ('transport.sh', 'transfer.py', 'pack.py', 'release.py', 'source_plan.py'):
            data = (DIRECTORY / name).read_bytes()
            # Bash must receive LF even when the host checked out with autocrlf.
            (deploy / name).write_bytes(data.replace(b'\r\n', b'\n') if name.endswith('.sh') else data)
        self.policy = digest((deploy / 'source_plan.py').read_bytes().replace(b'\r\n', b'\n'))
        self.commands = self.root / 'commands'
        self.commands.mkdir()
        self.ssh_temporary = self.root / 'ssh-temporary'
        self.ssh_temporary.mkdir()
        runner = self.root / 'fixture_runner.py'
        runner.write_text(FAKE_RUNNER, encoding='utf-8')
        for name in ('ssh', 'scp', 'python'):
            executable = self.commands / name
            executable.write_text('#!/usr/bin/env bash\n'
                                  f'exec "$EVEM_FIXTURE_PYTHON" "$EVEM_FIXTURE_RUNNER" {name} "$@"\n',
                                  encoding='utf-8', newline='\n')
            executable.chmod(0o755)
        self.state = {
            'frontend': {'sha': '1' * 40, 'source': '2' * 40, 'path': str(self.root / 'old/frontend')},
            'backend': {'sha': '3' * 40, 'source': '4' * 40, 'path': str(self.root / 'old/backend')},
        }
        self.previous = {component: {**entry, 'sha': '9' * 40} for component, entry in self.state.items()}
        self.write_json(self.root / 'state.json', self.state)
        self.write_json(self.root / 'previous.json', self.previous)
        self.base = digest(json.dumps(self.state, sort_keys=True, separators=(',', ':')).encode())
        self.scenario = {'target': TARGET, 'remote_command': REMOTE_COMMAND,
                         'remote_archive': REMOTE_ARCHIVE, 'policy': self.policy}
        self.source_plan = {
            'format': 1, 'action': 'release', 'sha': NEW_SHA, 'policy': self.policy,
            'baseline': {component: entry['sha'] for component, entry in self.state.items()},
            'inputs': {component: {'head': digest(component.encode()), 'baseline': digest(component.encode())}
                       for component in self.state}, 'reasons': [],
        }
        self.remote_plan = {'format': 1, 'sha': NEW_SHA, 'policy': self.policy,
                            'base': self.base, 'components': ['frontend'], 'reuse': {}}
        # Build synthetic product bytes, never application files or configuration.
        self.files = {
            'frontend/index.html': b'<html>new frontend</html>',
            'frontend/assets/app.js': b'console.log("new frontend")\n',
            'frontend/assets/unchanged-large.bin': random.Random(41).randbytes(512 * 1024),
            'frontend/deploy-version.json': json.dumps({'sha': NEW_SHA}).encode(),
            'backend/manage.py': b'# fixture application\n',
            'backend/requirements.txt': b'# fixture dependencies\n',
            'backend/App/views.py': b'VALUE = 1\n',
            'backend/.release-sha': NEW_SHA.encode(),
        }
        self.manifest = {'format': 1, 'sha': NEW_SHA, 'policy': self.policy,
                         'sources': {'frontend': 'b' * 40, 'backend': self.state['backend']['source']},
                         'dependencies': digest(self.files['backend/requirements.txt']),
                         'files': {name: digest(data) for name, data in self.files.items()}}
        self.env = {key: value for key, value in os.environ.items()
                    if key in {'PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
                               'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE'}}
        self.env.update(EVEM_SSH_KEY='fixture', EVEM_KNOWN_HOSTS='fixture', EVEM_RELEASE_SHA=NEW_SHA,
                        GITHUB_RUN_ID='23', GITHUB_RUN_ATTEMPT='2',
                        EVEM_FIXTURE_ROOT=str(self.root), EVEM_FIXTURE_COMMANDS=shell_path(self.commands),
                        EVEM_FIXTURE_TMP=shell_path(self.ssh_temporary), EVEM_FIXTURE_PYTHON=sys.executable,
                        EVEM_FIXTURE_RUNNER=str(runner), PYTHONDONTWRITEBYTECODE='1',
                        MSYS2_ARG_CONV_EXCL='*')

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value, sort_keys=True) + '\n', encoding='utf-8')

    def product(self):
        self.write_json(self.checkout / 'release-manifest.json', self.manifest)
        members = {**self.files, 'manifest.json': json.dumps(self.manifest, sort_keys=True).encode()}
        with tarfile.open(self.checkout / 'release.tar.gz', 'w:gz') as archive:
            for name, data in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.mode, info.size = 0o644, len(data)
                archive.addfile(info, io.BytesIO(data))

    def snapshot(self):
        return {name: (self.root / name).read_bytes() for name in ('state.json', 'previous.json')}

    def run_transport(self, action='publish', env=None, remote_text=None):
        for name in ('events.jsonl', 'python-events.jsonl', 'uploaded.tar.gz'):
            (self.root / name).unlink(missing_ok=True)
        if action == 'publish':
            self.write_json(self.checkout / 'release-plan.json', self.source_plan)
            self.write_json(self.root / 'expected-input.json',
                            self.source_plan if self.source_plan['action'] == 'noop' else self.manifest)
        self.write_json(self.root / 'scenario.json', self.scenario)
        if remote_text is None:
            self.write_json(self.root / 'remote-plan.json', self.remote_plan)
        else:
            (self.root / 'remote-plan.json').write_text(remote_text, encoding='utf-8')
        # Check resolution before the real script is allowed to run. No startup
        # files or inherited SSH agent are loaded, and every credential is fake.
        bootstrap = ('export PATH="$EVEM_FIXTURE_COMMANDS:/usr/bin:/bin"\n'
                     'export TMPDIR="$EVEM_FIXTURE_TMP"\n'
                     'for name in ssh scp python; do\n'
                     '  [[ "$(command -v "$name")" == "$EVEM_FIXTURE_COMMANDS/$name" ]] || exit 98\n'
                     'done\n'
                     'exec bash scripts/deploy/transport.sh "$1"\n')
        result = subprocess.run([BASH, '--noprofile', '--norc', '-c', bootstrap, 'fixture', action],
                                cwd=self.checkout, env={**self.env, **(env or {})}, input='',
                                text=True, capture_output=True, timeout=30)
        self.events = self.read_events('events.jsonl')
        self.python_events = self.read_events('python-events.jsonl')
        self.assertEqual(list(self.ssh_temporary.iterdir()), [], result.stderr)
        for event in self.events:
            self.assertFalse(Path(event['key']).exists(), result.stderr)
            self.assertFalse(Path(event['known_hosts']).exists(), result.stderr)
            self.assertFalse(Path(event['key']).parent.exists(), result.stderr)
        return result

    def read_events(self, name):
        path = self.root / name
        return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()] if path.exists() else []

    def actions(self):
        return [event['action'] if event['tool'] == 'ssh' else 'scp' for event in self.events]

    def assert_stopped(self, result, actions, snapshot):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.actions(), actions, result.stderr)
        self.assertEqual(self.snapshot(), snapshot)
        self.assertFalse((self.root / 'uploaded.tar.gz').exists())

    def test_source_noop_verifies_remote_without_product_artifacts_or_state_change(self):
        self.source_plan['action'] = 'noop'
        self.remote_plan['components'] = []
        before = self.snapshot()
        result = self.run_transport()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.actions(), ['noop'])
        self.assertEqual(json.loads(self.events[0]['stdin']), self.source_plan)
        self.assertEqual(self.snapshot(), before)
        self.assertIn('Verified unchanged production components', result.stdout)
        self.assertFalse((self.checkout / 'release.tar.gz').exists())
        self.assertFalse((self.checkout / 'release-manifest.json').exists())

    def test_identical_product_manifest_verifies_plan_without_scp_or_state_change(self):
        self.product()
        self.remote_plan['components'] = []
        before = self.snapshot()
        result = self.run_transport()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.actions(), ['plan'])
        self.assertEqual(json.loads(self.events[0]['stdin']), self.manifest)
        self.assertEqual(self.snapshot(), before)
        self.assertIn('Verified identical product bytes', result.stdout)
        self.assertFalse((self.root / 'uploaded.tar.gz').exists())

    def test_frontend_delta_uploads_only_changed_files_then_publishes(self):
        self.product()
        asset = 'frontend/assets/unchanged-large.bin'
        self.remote_plan['reuse'] = {asset: self.manifest['files'][asset]}
        result = self.run_transport()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.actions(), ['plan', 'scp', 'publish'])
        event = self.events[1]
        selected = {name: checksum for name, checksum in self.manifest['files'].items()
                    if name.startswith('frontend/')}
        payload = set(selected) - {asset}
        self.assertEqual(set(event['members']), payload | {'manifest.json'})
        self.assertEqual(event['hashes'], {name: selected[name] for name in payload})
        delta = event['manifest']
        self.assertEqual(delta['format'], 2)
        self.assertEqual(delta['components'], ['frontend'])
        self.assertEqual(delta['files'], selected)
        self.assertEqual(delta['reuse'], self.remote_plan['reuse'])
        self.assertEqual(delta['base'], self.base)
        self.assertEqual(delta['policy'], self.policy)
        self.assertEqual(delta['candidate'], self.manifest)
        self.assertLess(event['bytes'], (self.checkout / 'release.tar.gz').stat().st_size // 20)
        self.assertIn(f"Planned component package bytes: {event['bytes']}", result.stdout)
        self.assertEqual(self.events[2]['args'][-1], REMOTE_COMMAND + 'publish ' + REMOTE_ARCHIVE)
        state = json.loads((self.root / 'state.json').read_text(encoding='utf-8'))
        self.assertEqual(state['backend'], self.state['backend'])
        self.assertEqual(state['frontend']['sha'], NEW_SHA)

    def test_authentication_failure_stops_before_scp_and_publish(self):
        self.product()
        self.scenario.update(ssh_failure='plan', ssh_status=255)
        before = self.snapshot()
        result = self.run_transport()
        self.assertEqual(result.returncode, 255)
        self.assert_stopped(result, ['plan'], before)

    def test_remote_planner_failure_stops_before_scp_and_publish(self):
        self.product()
        self.scenario['ssh_failure'] = 'plan'
        before = self.snapshot()
        self.assert_stopped(self.run_transport(), ['plan'], before)

    def test_scp_failure_stops_before_publish_and_preserves_state(self):
        self.product()
        self.scenario['scp_failure'] = True
        before = self.snapshot()
        result = self.run_transport()
        self.assertEqual(result.returncode, 23)
        self.assert_stopped(result, ['plan', 'scp'], before)

    def test_publish_failure_propagates_and_cleans_credentials(self):
        self.product()
        self.scenario['ssh_failure'] = 'publish'
        before = self.snapshot()
        result = self.run_transport()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.actions(), ['plan', 'scp', 'publish'])
        self.assertEqual(self.snapshot(), before)

    def test_noop_authentication_failure_is_not_reported_as_success(self):
        self.source_plan['action'] = 'noop'
        self.remote_plan['components'] = []
        self.scenario.update(ssh_failure='noop', ssh_status=255)
        before = self.snapshot()
        result = self.run_transport()
        self.assert_stopped(result, ['noop'], before)
        self.assertNotIn('Verified unchanged', result.stdout)

    def test_stale_source_noop_baseline_is_rejected_by_remote(self):
        self.source_plan['action'] = 'noop'
        self.remote_plan['components'] = []
        changed = deepcopy(self.state)
        changed['frontend']['sha'] = '5' * 40
        self.write_json(self.root / 'state.json', changed)
        before = self.snapshot()
        self.assert_stopped(self.run_transport(), ['noop'], before)

    def test_malformed_remote_json_stops_before_scp_and_publish(self):
        self.product()
        before = self.snapshot()
        for value in ('not JSON', '[]', '{}'):
            with self.subTest(response=value):
                self.assert_stopped(self.run_transport(remote_text=value), ['plan'], before)

    def test_stale_identity_policy_and_malformed_remote_plans_stop_before_upload(self):
        self.product()
        before = self.snapshot()
        for field, value in (('sha', '1' * 40), ('policy', 'f' * 64), ('format', 2),
                             ('base', 'f' * 63), ('components', ['backend', 'frontend']),
                             ('components', ['frontend', 'frontend']), ('components', ['unknown']),
                             ('reuse', [])):
            with self.subTest(field=field, value=value):
                self.remote_plan = {'format': 1, 'sha': NEW_SHA, 'policy': self.policy,
                                    'base': self.base, 'components': ['frontend'], 'reuse': {}}
                self.remote_plan[field] = value
                self.assert_stopped(self.run_transport(), ['plan'], before)

    def test_noop_requires_bound_identity_policy_and_empty_remote_components(self):
        self.source_plan['action'] = 'noop'
        before = self.snapshot()
        for field, value in (('sha', '1' * 40), ('policy', 'f' * 64), ('components', ['frontend'])):
            with self.subTest(field=field):
                self.remote_plan = {'format': 1, 'sha': NEW_SHA, 'policy': self.policy,
                                    'base': self.base, 'components': []}
                self.remote_plan[field] = value
                self.assert_stopped(self.run_transport(), ['noop'], before)

    def test_invalid_source_identity_policy_or_noop_evidence_prevents_any_connection(self):
        valid = deepcopy(self.source_plan)
        valid['action'] = 'noop'
        cases = [dict(valid, sha='1' * 40), dict(valid, policy='f' * 64), dict(valid, inputs={})]
        unequal = deepcopy(valid)
        unequal['inputs']['frontend']['baseline'] = 'f' * 64
        cases.append(unequal)
        before = self.snapshot()
        for index, plan in enumerate(cases):
            with self.subTest(case=index):
                self.source_plan = plan
                self.assert_stopped(self.run_transport(), [], before)

    def test_invalid_release_sha_or_ci_identity_prevents_any_connection(self):
        before = self.snapshot()
        for env in ({'EVEM_RELEASE_SHA': 'A' * 40}, {'GITHUB_RUN_ID': 'invalid'},
                    {'GITHUB_RUN_ATTEMPT': ''}):
            with self.subTest(env=env):
                self.assert_stopped(self.run_transport(env=env), [], before)

    def test_manifest_identity_or_policy_mismatch_stops_before_upload(self):
        self.product()
        before = self.snapshot()
        original = deepcopy(self.manifest)
        for field, value in (('sha', '1' * 40), ('policy', 'f' * 64)):
            with self.subTest(field=field):
                self.manifest = {**original, field: value}
                self.write_json(self.checkout / 'release-manifest.json', self.manifest)
                self.assert_stopped(self.run_transport(), ['plan'], before)

    def test_archive_checksum_failure_stops_before_upload_even_for_product_noop(self):
        self.files['frontend/index.html'] = b'<html>tampered artifact</html>'
        self.product()  # manifest still records the original checksum
        before = self.snapshot()
        for components in ([], ['frontend']):
            with self.subTest(components=components):
                self.remote_plan['components'] = components
                self.assert_stopped(self.run_transport(), ['plan'], before)

    def test_invalid_reuse_checksum_stops_before_upload(self):
        self.product()
        self.remote_plan['reuse'] = {'frontend/assets/unchanged-large.bin': 'f' * 64}
        before = self.snapshot()
        self.assert_stopped(self.run_transport(), ['plan'], before)

    def test_rollback_uses_only_remote_rollback_without_new_ci_artifacts(self):
        # Rollback must keep working when no candidate release or local planner
        # exists, and its remote operation must not depend on a new CI run.
        for path in (self.checkout / 'scripts/deploy').glob('*.py'):
            path.unlink()
        result = self.run_transport('rollback', env={'EVEM_RELEASE_SHA': '', 'GITHUB_SHA': '',
                                                    'GITHUB_RUN_ID': '', 'GITHUB_RUN_ATTEMPT': ''})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.actions(), ['rollback'])
        self.assertEqual(self.python_events, [])
        self.assertEqual(self.events[0]['stdin'], '')
        self.assertEqual(json.loads((self.root / 'state.json').read_text(encoding='utf-8')), self.previous)
        self.assertFalse((self.checkout / 'release-plan.json').exists())


if __name__ == '__main__':
    unittest.main()
