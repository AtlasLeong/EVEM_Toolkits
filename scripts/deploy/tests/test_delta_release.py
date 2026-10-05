"""Content-based delta/noop contracts, with no services or remote dependencies.

The fixture contains real manifests, archives and release bytes. Linux also uses
real symlinks and flock. Windows cannot create unprivileged symlinks, so only its
current/runtime links and Linux-only lock are modeled; state and manifest
validation, archive validation, staging and transaction metadata remain real.
"""
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DIRECTORY))
import release
import pack


OLD_SHA = '1' * 40
NEW_SHA = 'a' * 40
OLD_SOURCES = {'frontend': '2' * 40, 'backend': '3' * 40}
NEW_SOURCES = {'frontend': 'b' * 40, 'backend': 'c' * 40}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def policy_digest():
    import source_plan
    return source_plan.policy_digest()


@contextmanager
def unlocked(root):
    yield


class DeltaFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='evem-delta-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'current').mkdir()
        self.files = {
            'frontend/index.html': b'<html><script src="/assets/app.js"></script></html>',
            'frontend/assets/app.js': b'console.log("stable")\n',
            'backend/manage.py': b'# synthetic application entry point\n',
            'backend/requirements.txt': b'Django==4.2.5\n',
            'backend/App/views.py': b'VALUE = 1\n',
            'backend/App/migrations/0001_initial.py': b'# synthetic migration\n',
            'backend/Market/tests/test_collector.py': b'# original unit tests\n',
            'backend/README.md': b'# application documentation\n',
        }
        old_files = self.candidate_files(sha=OLD_SHA)
        self.old_manifest = self.manifest(old_files, sha=OLD_SHA, sources=OLD_SOURCES)
        old_release = self.materialize(self.old_manifest, old_files)
        self.state = {
            component: {'source': OLD_SOURCES[component], 'sha': OLD_SHA,
                        'path': str(old_release / component)}
            for component in release.COMPONENTS
        }
        self.links = {}
        if os.name == 'nt':
            original_resolve = Path.resolve
            original_is_symlink = Path.is_symlink
            links = self.links

            def resolve(path, *args, **kwargs):
                if path in links:
                    return original_resolve(links[path], *args, **kwargs)
                return original_resolve(path, *args, **kwargs)

            def is_symlink(path):
                return path in links or original_is_symlink(path)

            resolve_patch = patch.object(Path, 'resolve', resolve)
            link_patch = patch.object(Path, 'is_symlink', is_symlink)
            lock_patch = patch.object(release, 'server_lock', unlocked)
            for replacement in (resolve_patch, link_patch, lock_patch):
                replacement.start()
                self.addCleanup(replacement.stop)
        for component in release.COMPONENTS:
            self.set_current(component, Path(self.state[component]['path']))
        for name in ('env/bin', 'data/logs', 'data/uploads'):
            (self.root / name).mkdir(parents=True)
        (self.root / 'data/.env').write_bytes(b'SYNTHETIC_CONFIGURATION=1\n')
        (self.root / 'env/bin/python').write_bytes(b'# synthetic interpreter marker\n')
        self.runtime_targets = {'.venv': self.root / 'env', '.env': self.root / 'data/.env',
                                'logs': self.root / 'data/logs', 'static/uploads': self.root / 'data/uploads'}
        self.provision_runtime(Path(self.state['backend']['path']))
        self.write_json('initialized.json', {'fixture': True})
        self.write_json('state.json', self.state)
        self.write_json('previous.json', {'preserved': 'previous successful deployment'})
        self.write_json('config.json', {'origin': 'http://fixture.invalid',
                                        'env_file': str(self.runtime_targets['.env']),
                                        'logs': str(self.runtime_targets['logs']),
                                        'uploads': str(self.runtime_targets['static/uploads'])})
        self.write_json('shared/environments.json', {self.old_manifest['dependencies']: str(self.root / 'env')})
        # A test must explicitly mock health/preflight rather than accidentally
        # reaching a real service or endpoint when an implementation regresses.
        command_patch = patch.object(release, 'command', side_effect=AssertionError('unexpected service command'))
        network_patch = patch.object(release.urllib.request, 'urlopen',
                                     side_effect=AssertionError('unexpected HTTP request'))
        health_patch = patch.object(release, 'health')
        for replacement in (command_patch, network_patch, health_patch):
            mock = replacement.start()
            self.addCleanup(replacement.stop)
            if replacement is health_patch:
                self.health_mock = mock
        self.sequence = 0

    def write_json(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n', encoding='utf-8')

    def set_current(self, component, target):
        self.set_link(self.root / 'current' / component, target)

    def set_link(self, current, target):
        current.parent.mkdir(parents=True, exist_ok=True)
        if os.name == 'nt':
            self.links[current] = target
        else:
            if current.is_symlink():
                current.unlink()
            current.symlink_to(target, target_is_directory=target.is_dir())

    def remove_link(self, path):
        if os.name == 'nt':
            self.links.pop(path)
        else:
            path.unlink()

    def provision_runtime(self, backend):
        for local, target in self.runtime_targets.items():
            self.set_link(backend / local, target)

    def candidate_files(self, changes=None, removed=(), sha=NEW_SHA):
        files = dict(self.files)
        files.update(changes or {})
        for name in removed:
            files.pop(name)
        files['backend/.release-sha'] = sha.encode()
        files['frontend/deploy-version.json'] = json.dumps({'sha': sha}).encode()
        return files

    def manifest(self, files, sha=NEW_SHA, sources=None):
        return {
            'format': 1, 'sha': sha, 'sources': deepcopy(sources or NEW_SOURCES),
            'dependencies': digest(files['backend/requirements.txt']),
            'policy': policy_digest(),
            'files': {name: digest(data) for name, data in files.items()},
        }

    def materialize(self, manifest, files):
        target = self.root / 'releases' / manifest['sha']
        for name, data in files.items():
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        path = target / 'manifest.json'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        return target

    def archive(self, files, manifest, extra=None, symlinks=None):
        self.sequence += 1
        output = self.root / f'artifact-{self.sequence}.tar.gz'
        members = {**files, **(extra or {}), 'manifest.json': json.dumps(manifest).encode()}
        with tarfile.open(output, 'w:gz') as destination:
            for name, data in members.items():
                info = tarfile.TarInfo(name)
                info.mode, info.size = 0o644, len(data)
                destination.addfile(info, io.BytesIO(data))
            for name, target in (symlinks or {}).items():
                info = tarfile.TarInfo(name)
                info.type, info.linkname = tarfile.SYMTYPE, target
                destination.addfile(info)
        return output

    def delta_manifest(self, candidate, components, base=None):
        return {
            'format': 2, 'sha': candidate['sha'], 'sources': deepcopy(candidate['sources']),
            'dependencies': candidate['dependencies'], 'policy': candidate['policy'],
            'components': list(components), 'base': base or release.state_token(self.state),
            'candidate': deepcopy(candidate),
            'files': {name: value for name, value in candidate['files'].items()
                      if name.split('/')[0] in components},
        }

    def noop_plan(self):
        return {
            'format': 1, 'action': 'noop', 'sha': NEW_SHA, 'policy': policy_digest(),
            'baseline': {component: self.state[component]['sha'] for component in release.COMPONENTS},
            'inputs': {component: {'head': digest(component.encode()),
                                   'baseline': digest(component.encode())}
                       for component in release.COMPONENTS},
        }

    def metadata_snapshot(self):
        return {name: (self.root / name).read_bytes() for name in ('state.json', 'previous.json')}

    def assert_metadata_unchanged(self, snapshot):
        self.assertEqual(self.metadata_snapshot(), snapshot)
        self.assertFalse((self.root / 'transaction.json').exists())

    @contextmanager
    def publish_hooks(self):
        def switch(path, target):
            path, target = Path(path), Path(target)
            self.assertTrue(path.is_relative_to(self.root))
            self.assertTrue(target.is_relative_to(self.root))
            self.set_link(path, target)

        with patch.object(release, 'prepare_backend') as backend, \
                patch.object(release, 'prepare_assets') as frontend, \
                patch.object(release, 'restart_services') as restart, \
                patch.object(release, 'health') as health:
            if os.name == 'nt':
                with patch.object(release, 'link', side_effect=switch):
                    yield backend, frontend, restart, health
            else:
                yield backend, frontend, restart, health


class ManifestAndArchiveTests(DeltaFixture):
    def test_full_and_selected_component_archives_validate(self):
        files = self.candidate_files()
        full = self.manifest(files)
        release.validate_manifest(full)
        self.assertEqual(release.validate(self.archive(files, full)), full)
        for components in (['frontend'], ['backend'], ['frontend', 'backend']):
            with self.subTest(components=components):
                manifest = self.delta_manifest(full, components)
                selected = {name: data for name, data in files.items() if name in manifest['files']}
                release.validate_manifest(manifest)
                self.assertEqual(release.validate(self.archive(selected, manifest)), manifest)

    def test_malformed_metadata_is_a_release_error(self):
        full = self.manifest(self.candidate_files())
        invalid = [
            ('format', True), ('format', 3), ('sha', 40), ('sha', 'A' * 40),
            ('sources', []), ('sources', {'frontend': 'b' * 40}),
            ('sources', {'frontend': 'b' * 40, 'backend': 40}),
            ('dependencies', None), ('dependencies', 'f' * 63),
            ('files', []), ('files', {'frontend/index.html': None}),
        ]
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                manifest = deepcopy(full)
                manifest[key] = value
                with self.assertRaises(release.ReleaseError):
                    release.validate_manifest(manifest)

    def test_delta_components_must_be_nonempty_unique_and_canonical(self):
        full = self.manifest(self.candidate_files())
        for components in ([], ['backend', 'frontend'], ['frontend', 'frontend'], ['other'], 'frontend', None):
            with self.subTest(components=components):
                manifest = self.delta_manifest(full, ['frontend'])
                manifest['components'] = components
                with self.assertRaises(release.ReleaseError):
                    release.validate_manifest(manifest)

    def test_full_artifact_cannot_smuggle_delta_or_reuse_metadata(self):
        files = self.candidate_files()
        original = self.manifest(files)
        for key, value in [('base', release.state_token(self.state)), ('components', ['frontend']),
                           ('candidate', original), ('reuse', {}),
                           ('reuse', {'frontend/index.html': digest(files['frontend/index.html'])})]:
            with self.subTest(key=key, value=value):
                manifest = deepcopy(original)
                manifest[key] = value
                with self.assertRaises(release.ReleaseError):
                    release.stage(self.archive(files, manifest), self.root / 'releases')
                self.assertEqual(set((self.root / 'releases').iterdir()), {self.root / 'releases' / OLD_SHA})

    def test_delta_required_files_are_checked_for_each_selected_component(self):
        files = self.candidate_files()
        full = self.manifest(files)
        for component, required in [('frontend', 'frontend/index.html'),
                                    ('backend', 'backend/manage.py'),
                                    ('backend', 'backend/requirements.txt')]:
            with self.subTest(required=required):
                manifest = self.delta_manifest(full, [component])
                del manifest['files'][required]
                selected = {name: data for name, data in files.items() if name in manifest['files']}
                with self.assertRaises(release.ReleaseError):
                    release.validate(self.archive(selected, manifest))

    def test_delta_cannot_omit_a_nonentry_file_in_selected_component(self):
        files = self.candidate_files()
        manifest = self.delta_manifest(self.manifest(files), ['frontend'])
        del manifest['files']['frontend/assets/app.js']
        selected = {name: data for name, data in files.items() if name in manifest['files']}
        with self.assertRaises(release.ReleaseError):
            release.validate(self.archive(selected, manifest))

    def test_delta_metadata_is_bound_to_its_complete_candidate(self):
        full = self.manifest(self.candidate_files())
        changes = [('sha', 'd' * 40), ('sources', OLD_SOURCES),
                   ('dependencies', 'd' * 64), ('policy', 'd' * 64),
                   ('base', 'not-a-state-digest')]
        for key, value in changes:
            with self.subTest(key=key):
                manifest = self.delta_manifest(full, ['frontend'])
                manifest[key] = value
                with self.assertRaises(release.ReleaseError):
                    release.validate_manifest(manifest)
        manifest = self.delta_manifest(full, ['frontend'])
        manifest['candidate']['format'] = 2
        with self.assertRaises(release.ReleaseError):
            release.validate_manifest(manifest)

    def test_delta_rejects_files_from_omitted_component(self):
        files = self.candidate_files()
        manifest = self.delta_manifest(self.manifest(files), ['frontend'])
        manifest['files']['backend/manage.py'] = digest(files['backend/manage.py'])
        selected = {name: data for name, data in files.items() if name in manifest['files']}
        with self.assertRaises(release.ReleaseError):
            release.validate(self.archive(selected, manifest))

    def test_delta_tampering_is_rejected_before_staging(self):
        files = self.candidate_files()
        manifest = self.delta_manifest(self.manifest(files), ['frontend'])
        selected = {name: data for name, data in files.items() if name in manifest['files']}
        selected['frontend/assets/app.js'] = b'tampered build\n'
        with self.assertRaises(release.ReleaseError):
            release.stage(self.archive(selected, manifest), self.root / 'releases')
        self.assertFalse((self.root / 'releases' / NEW_SHA).exists())

    def test_delta_unlisted_file_and_symlink_are_rejected(self):
        files = self.candidate_files()
        manifest = self.delta_manifest(self.manifest(files), ['frontend'])
        selected = {name: data for name, data in files.items() if name in manifest['files']}
        for options in ({'extra': {'frontend/extra.js': b'unlisted'}},
                        {'symlinks': {'frontend/escape': '../../outside'}}):
            with self.subTest(options=options):
                with self.assertRaises(release.ReleaseError):
                    release.validate(self.archive(selected, manifest, **options))


class ContentPlanTests(DeltaFixture):
    def test_component_matrix_uses_products_and_runtime_bytes(self):
        cases = [
            ('only version markers and raw tree identifiers change', {}, (), []),
            ('backend tests change', {'backend/Market/tests/test_collector.py': b'# new tests\n'}, (), []),
            ('backend documentation changes', {'backend/README.md': b'# new docs\n'}, (), []),
            ('backend test removed', {}, ('backend/Market/tests/test_collector.py',), []),
            ('frontend entry changes', {'frontend/index.html': b'<html>new UI</html>'}, (), ['frontend']),
            ('frontend asset changes', {'frontend/assets/app.js': b'console.log("new")'}, (), ['frontend']),
            ('frontend asset removed', {}, ('frontend/assets/app.js',), ['frontend']),
            ('frontend unknown product added', {'frontend/manual.txt': b'built public file'}, (), ['frontend']),
            ('backend runtime changes', {'backend/App/views.py': b'VALUE = 2\n'}, (), ['backend']),
            ('backend runtime removed', {}, ('backend/App/views.py',), ['backend']),
            ('migration changes', {'backend/App/migrations/0001_initial.py': b'# migration v2\n'}, (), ['backend']),
            ('dependencies change', {'backend/requirements.txt': b'Django==4.2.6\n'}, (), ['backend']),
            ('unknown backend file added', {'backend/App/unknown.data': b'runtime data'}, (), ['backend']),
            ('unreviewed test folder remains runtime', {'backend/NewApp/tests/test_views.py': b'new file'}, (), ['backend']),
            ('test substring remains runtime', {'backend/App/contest.py': b'VALUE = 2'}, (), ['backend']),
            ('both components change', {'frontend/index.html': b'new UI', 'backend/App/views.py': b'VALUE = 2'},
             (), ['frontend', 'backend']),
        ]
        before = self.metadata_snapshot()
        for description, changes, removed, components in cases:
            with self.subTest(description=description):
                candidate = self.manifest(self.candidate_files(changes, removed))
                self.health_mock.reset_mock()
                result = release.plan_release(self.root, candidate)
                expected_reuse = {name: value for name, value in self.old_manifest['files'].items()
                                  if name.split('/')[0] in components and candidate['files'].get(name) == value}
                self.assertEqual(result, {'format': 1, 'sha': NEW_SHA,
                                          'base': release.state_token(self.state),
                                          'components': components, 'policy': policy_digest(),
                                          'reuse': expected_reuse})
                if components:
                    self.health_mock.assert_not_called()
                else:
                    self.health_mock.assert_called_once()
                self.assert_metadata_unchanged(before)

    def test_equal_source_identifiers_do_not_hide_changed_bytes(self):
        files = self.candidate_files({'backend/App/views.py': b'VALUE = 99\n'})
        candidate = self.manifest(files, sources=OLD_SOURCES)
        self.assertEqual(release.plan_release(self.root, candidate)['components'], ['backend'])

    def test_missing_manifest_conservatively_selects_both_components(self):
        (self.root / 'releases' / OLD_SHA / 'manifest.json').unlink()
        result = release.plan_release(self.root, self.manifest(self.candidate_files()))
        self.assertEqual(result['components'], ['frontend', 'backend'])

    def test_explicit_legacy_component_is_conservatively_selected(self):
        self.state['backend']['legacy'] = True
        self.write_json('state.json', self.state)
        result = release.plan_release(self.root, self.manifest(self.candidate_files()))
        self.assertEqual(result['components'], ['backend'])

    def test_verified_old_format_one_manifest_without_policy_remains_comparable(self):
        old = deepcopy(self.old_manifest)
        del old['policy']
        self.write_json(f'releases/{OLD_SHA}/manifest.json', old)
        self.assertEqual(release.plan_release(self.root, self.manifest(self.candidate_files()))['components'], [])

    def test_corrupted_old_declared_file_is_rejected_even_if_candidate_matches(self):
        path = Path(self.state['backend']['path']) / 'App/views.py'
        path.write_bytes(b'VALUE = compromised\n')
        candidate = self.manifest(self.candidate_files({'backend/App/views.py': path.read_bytes()}))
        before = self.metadata_snapshot()
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, candidate)
        self.assert_metadata_unchanged(before)

    def test_missing_old_declared_file_is_rejected(self):
        (Path(self.state['frontend']['path']) / 'assets/app.js').unlink()
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, self.manifest(self.candidate_files()))

    def test_old_manifest_sha_and_component_sources_must_match_state(self):
        for key in ('sha', 'sources'):
            with self.subTest(key=key):
                old = deepcopy(self.old_manifest)
                old[key] = 'd' * 40 if key == 'sha' else {'frontend': 'd' * 40, 'backend': 'e' * 40}
                self.write_json(f'releases/{OLD_SHA}/manifest.json', old)
                with self.assertRaises(release.ReleaseError):
                    release.plan_release(self.root, self.manifest(self.candidate_files()))
        self.write_json(f'releases/{OLD_SHA}/manifest.json', self.old_manifest)

    def test_split_active_pair_reads_each_components_own_release_manifest(self):
        backend_sha = '4' * 40
        sources = {'frontend': '5' * 40, 'backend': '6' * 40}
        files = self.candidate_files({'frontend/index.html': b'unused frontend'}, sha=backend_sha)
        manifest = self.manifest(files, sha=backend_sha, sources=sources)
        target = self.materialize(manifest, files)
        self.provision_runtime(target / 'backend')
        self.state['backend'] = {'source': sources['backend'], 'sha': backend_sha,
                                 'path': str(target / 'backend')}
        self.set_current('backend', target / 'backend')
        self.write_json('state.json', self.state)
        self.assertEqual(release.plan_release(self.root, self.manifest(self.candidate_files()))['components'], [])

    def test_read_active_state_rejects_current_link_disagreement(self):
        wrong = self.root / 'releases' / 'wrong' / 'frontend'
        wrong.mkdir(parents=True)
        self.set_current('frontend', wrong)
        with self.assertRaises(release.ReleaseError):
            release.read_active_state(self.root)
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, self.manifest(self.candidate_files()))

    def test_unfinished_transaction_blocks_planning(self):
        self.write_json('transaction.json', {'unfinished': True})
        before = self.metadata_snapshot()
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, self.manifest(self.candidate_files()))
        self.assertEqual(self.metadata_snapshot(), before)
        self.assertTrue((self.root / 'transaction.json').exists())

    def test_new_candidate_requires_current_policy(self):
        full = self.manifest(self.candidate_files())
        for policy in (None, 'd' * 64):
            with self.subTest(policy=policy):
                candidate = deepcopy(full)
                if policy is None:
                    del candidate['policy']
                else:
                    candidate['policy'] = policy
                with self.assertRaises(release.ReleaseError):
                    release.plan_release(self.root, candidate)

    def test_state_token_is_order_independent_and_binds_the_complete_pair(self):
        token = release.state_token(self.state)
        self.assertRegex(token, r'^[0-9a-f]{64}$')
        reversed_state = {name: dict(reversed(list(self.state[name].items())))
                          for name in reversed(release.COMPONENTS)}
        self.assertEqual(release.state_token(reversed_state), token)
        for component in release.COMPONENTS:
            for key, value in [('source', 'd' * 40), ('sha', 'd' * 40),
                               ('path', str(self.root / 'another')), ('legacy', True)]:
                with self.subTest(component=component, key=key):
                    changed = deepcopy(self.state)
                    changed[component][key] = value
                    self.assertNotEqual(release.state_token(changed), token)

    def test_old_unlisted_runtime_file_is_rejected(self):
        (Path(self.state['backend']['path']) / 'App/unlisted.py').write_bytes(b'# unexpected runtime module')
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, self.manifest(self.candidate_files()))

    def test_old_nonruntime_file_checksum_is_still_verified(self):
        (Path(self.state['backend']['path']) / 'README.md').write_bytes(b'# modified outside deployment')
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, self.manifest(self.candidate_files()))

    def test_missing_runtime_links_are_rejected_before_reuse(self):
        backend = Path(self.state['backend']['path'])
        for local, target in self.runtime_targets.items():
            with self.subTest(local=local):
                self.remove_link(backend / local)
                with self.assertRaises(release.ReleaseError):
                    release.plan_release(self.root, self.manifest(self.candidate_files()))
                self.set_link(backend / local, target)

    def test_wrong_runtime_link_targets_are_rejected_before_reuse(self):
        backend = Path(self.state['backend']['path'])
        wrong = self.root / 'wrong-runtime'
        wrong.mkdir()
        for local, target in self.runtime_targets.items():
            with self.subTest(local=local):
                self.set_link(backend / local, wrong)
                with self.assertRaises(release.ReleaseError):
                    release.plan_release(self.root, self.manifest(self.candidate_files()))
                self.set_link(backend / local, target)

    def test_missing_registered_interpreter_is_rejected(self):
        (self.root / 'env/bin/python').unlink()
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, self.manifest(self.candidate_files()))

    def test_runtime_environment_registry_must_match_active_dependencies(self):
        self.write_json('shared/environments.json', {'d' * 64: str(self.root / 'env')})
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, self.manifest(self.candidate_files()))


class DeltaPackAndPublishTests(DeltaFixture):
    def frontend_candidate(self):
        files = self.candidate_files({'frontend/assets/app.js': b'console.log("new")\n'})
        return files, self.manifest(files)

    def build_delta(self, changes):
        files = self.candidate_files(changes)
        candidate = self.manifest(files)
        plan = release.plan_release(self.root, candidate)
        self.sequence += 1
        output = self.root / f'planned-delta-{self.sequence}.tar.gz'
        pack.delta(self.archive(files, candidate), plan, output)
        return output

    def assert_recovery_metadata(self, before):
        self.assertEqual({name: json.loads(data) for name, data in self.metadata_snapshot().items()},
                         {name: json.loads(data) for name, data in before.items()})
        self.assertFalse((self.root / 'transaction.json').exists())
        for component in release.COMPONENTS:
            self.assertEqual((self.root / 'current' / component).resolve(), Path(self.state[component]['path']))

    def test_packer_copies_only_selected_component_and_preserves_full_candidate(self):
        files, candidate = self.frontend_candidate()
        full = self.archive(files, candidate)
        plan = release.plan_release(self.root, candidate)
        output = self.root / 'delta.tar.gz'
        manifest = pack.delta(full, plan, output)
        self.assertEqual(manifest['format'], 2)
        self.assertEqual(manifest['components'], ['frontend'])
        self.assertEqual(manifest['candidate'], candidate)
        self.assertEqual(manifest['base'], plan['base'])
        self.assertEqual(manifest['reuse'], plan['reuse'])
        self.assertEqual(release.validate(output), manifest)
        with tarfile.open(output) as archive:
            payload = set(manifest['files']) - set(manifest['reuse'])
            self.assertEqual(set(archive.getnames()), {'manifest.json', *payload})
            self.assertFalse(any(name.startswith('backend/') for name in archive.getnames()))
            for name in payload:
                self.assertEqual(archive.extractfile(name).read(), files[name])

    def test_packer_rejects_plan_bound_to_another_commit_or_policy(self):
        files, candidate = self.frontend_candidate()
        full = self.archive(files, candidate)
        original = release.plan_release(self.root, candidate)
        for key, value in [('sha', 'd' * 40), ('policy', 'd' * 64),
                           ('base', 'bad-base'), ('components', [])]:
            with self.subTest(key=key):
                plan = {**original, key: value}
                output = self.root / f'rejected-{key}.tar.gz'
                with self.assertRaises(release.ReleaseError):
                    pack.delta(full, plan, output)
                self.assertFalse(output.exists())

    def test_packer_verifies_full_bundle_including_omitted_component(self):
        files, candidate = self.frontend_candidate()
        plan = release.plan_release(self.root, candidate)
        tampered = {**files, 'backend/App/views.py': b'tampered omitted backend'}
        output = self.root / 'rejected.tar.gz'
        with self.assertRaises(release.ReleaseError):
            pack.delta(self.archive(tampered, candidate), plan, output)
        self.assertFalse(output.exists())

    def test_frontend_delta_publish_keeps_omitted_backend_state_and_files(self):
        files, candidate = self.frontend_candidate()
        old_backend = deepcopy(self.state['backend'])
        backend_bytes = {path.relative_to(Path(old_backend['path'])).as_posix(): path.read_bytes()
                         for path in Path(old_backend['path']).rglob('*') if path.is_file()}
        plan = release.plan_release(self.root, candidate)
        archive = self.root / 'delta.tar.gz'
        pack.delta(self.archive(files, candidate), plan, archive)
        with self.publish_hooks() as (backend, frontend, restart, health):
            release.publish(self.root, archive)
            backend.assert_not_called()
            frontend.assert_called_once()
            restart.assert_not_called()
            health.assert_called_once()
        state = json.loads((self.root / 'state.json').read_text())
        self.assertEqual(state['backend'], old_backend)
        self.assertEqual((self.root / 'current/backend').resolve(), Path(old_backend['path']))
        self.assertEqual(state['frontend']['sha'], NEW_SHA)
        self.assertEqual(state['frontend']['source'], NEW_SOURCES['frontend'])
        self.assertFalse((Path(state['frontend']['path']).parent / 'backend').exists())
        self.assertEqual({path.relative_to(Path(old_backend['path'])).as_posix(): path.read_bytes()
                          for path in Path(old_backend['path']).rglob('*') if path.is_file()}, backend_bytes)

    def test_backend_delta_publish_runs_preflight_and_preserves_frontend(self):
        files = self.candidate_files({'backend/App/views.py': b'VALUE = 2\n'})
        candidate = self.manifest(files)
        old_frontend = deepcopy(self.state['frontend'])
        plan = release.plan_release(self.root, candidate)
        archive = self.root / 'backend-delta.tar.gz'
        pack.delta(self.archive(files, candidate), plan, archive)
        with self.publish_hooks() as (backend, frontend, restart, health):
            release.publish(self.root, archive)
            backend.assert_called_once()
            frontend.assert_not_called()
            restart.assert_called_once()
            health.assert_called_once()
        state = json.loads((self.root / 'state.json').read_text())
        self.assertEqual(state['frontend'], old_frontend)
        self.assertEqual(state['backend']['sha'], NEW_SHA)
        self.assertFalse((Path(state['backend']['path']).parent / 'frontend').exists())

    def test_same_candidate_can_stage_independent_deltas_for_distinct_active_bases(self):
        files, candidate = self.frontend_candidate()
        original = self.delta_manifest(candidate, ['frontend'])
        first = release.stage(self.archive({name: files[name] for name in original['files']}, original),
                              self.root / 'releases')
        state = deepcopy(self.state)
        state['backend']['community_ready'] = True
        second_manifest = self.delta_manifest(candidate, ['frontend'], base=release.state_token(state))
        second = release.stage(self.archive({name: files[name] for name in second_manifest['files']}, second_manifest),
                               self.root / 'releases')
        self.assertNotEqual(first, second)
        self.assertEqual(json.loads((first / 'manifest.json').read_text()), original)
        self.assertEqual(json.loads((second / 'manifest.json').read_text()), second_manifest)
        self.assertEqual((first / 'frontend/assets/app.js').read_bytes(), (second / 'frontend/assets/app.js').read_bytes())
        retry = release.stage(self.archive({name: files[name] for name in original['files']}, original),
                              self.root / 'releases')
        self.assertEqual(retry, first)

    def test_stale_delta_base_is_rejected_before_prepare_or_switch(self):
        files, candidate = self.frontend_candidate()
        plan = release.plan_release(self.root, candidate)
        archive = self.root / 'stale-delta.tar.gz'
        pack.delta(self.archive(files, candidate), plan, archive)
        self.state['backend']['community_ready'] = True
        self.write_json('state.json', self.state)
        before = self.metadata_snapshot()
        with self.publish_hooks() as hooks:
            with self.assertRaises(release.ReleaseError):
                release.publish(self.root, archive)
            for hook in hooks:
                hook.assert_not_called()
        self.assert_metadata_unchanged(before)
        self.assertEqual(set((self.root / 'releases').iterdir()), {self.root / 'releases' / OLD_SHA})

    def test_unchanged_large_frontend_asset_is_omitted_from_payload_and_copied_completely(self):
        large_name = 'frontend/assets/large.bin'
        self.files[large_name] = bytes(range(256)) * 2048
        old_files = self.candidate_files(sha=OLD_SHA)
        self.old_manifest = self.manifest(old_files, sha=OLD_SHA, sources=OLD_SOURCES)
        self.materialize(self.old_manifest, old_files)
        files = self.candidate_files({'frontend/index.html': b'<html>new interface</html>'})
        candidate = self.manifest(files)
        plan = release.plan_release(self.root, candidate)
        self.assertEqual(plan['reuse'][large_name], digest(self.files[large_name]))
        output = self.root / 'small-frontend-delta.tar.gz'
        manifest = pack.delta(self.archive(files, candidate), plan, output)
        with tarfile.open(output) as archive:
            self.assertNotIn(large_name, archive.getnames())
            self.assertNotIn('frontend/assets/app.js', archive.getnames())
            self.assertIn('frontend/index.html', archive.getnames())
            self.assertEqual(set(archive.getnames()),
                             {'manifest.json', 'frontend/index.html', 'frontend/deploy-version.json'})
        target = release.stage(output, self.root / 'releases', reuse_state=self.state)
        self.assertEqual((target / large_name).read_bytes(), self.files[large_name])
        for name in manifest['files']:
            self.assertEqual((target / name).read_bytes(), files[name])

    def test_backend_required_files_can_be_reused_and_stage_remains_complete(self):
        files = self.candidate_files({'backend/App/views.py': b'VALUE = 2\n'})
        candidate = self.manifest(files)
        plan = release.plan_release(self.root, candidate)
        required = {'backend/manage.py', 'backend/requirements.txt'}
        self.assertTrue(required <= set(plan['reuse']))
        output = self.root / 'backend-reuse.tar.gz'
        manifest = pack.delta(self.archive(files, candidate), plan, output)
        with tarfile.open(output) as archive:
            self.assertFalse(required & set(archive.getnames()))
        self.assertEqual(release.validate(output), manifest)
        target = release.stage(output, self.root / 'releases', reuse_state=self.state)
        for name in manifest['files']:
            self.assertEqual((target / name).read_bytes(), files[name])

    def test_reuse_requires_matching_baseline_state_before_staging(self):
        files, candidate = self.frontend_candidate()
        plan = release.plan_release(self.root, candidate)
        output = self.root / 'requires-baseline.tar.gz'
        pack.delta(self.archive(files, candidate), plan, output)
        changed = deepcopy(self.state)
        changed['backend']['community_ready'] = True
        for state in (None, changed):
            with self.subTest(state=state):
                with self.assertRaises(release.ReleaseError):
                    release.stage(output, self.root / 'releases', reuse_state=state)
                self.assertEqual(set((self.root / 'releases').iterdir()), {self.root / 'releases' / OLD_SHA})

    def test_reuse_hash_tampering_is_rejected(self):
        files, candidate = self.frontend_candidate()
        plan = release.plan_release(self.root, candidate)
        output = self.root / 'reuse-hash.tar.gz'
        manifest = pack.delta(self.archive(files, candidate), plan, output)
        name = next(iter(manifest['reuse']))
        manifest['reuse'][name] = 'd' * 64
        with self.assertRaises(release.ReleaseError):
            release.validate_manifest(manifest)

    def test_publish_recomputes_reuse_instead_of_trusting_client_payload(self):
        files, candidate = self.frontend_candidate()
        plan = release.plan_release(self.root, candidate)
        self.assertTrue(plan['reuse'])
        manifest = self.delta_manifest(candidate, plan['components'])
        manifest['reuse'] = {}
        selected = {name: files[name] for name in manifest['files']}
        output = self.archive(selected, manifest)
        release.validate(output)
        before = self.metadata_snapshot()
        with self.publish_hooks() as hooks:
            with self.assertRaises(release.ReleaseError):
                release.publish(self.root, output)
            for hook in hooks:
                hook.assert_not_called()
        self.assert_metadata_unchanged(before)

    def test_reused_source_change_during_copy_fails_without_switching(self):
        files, candidate = self.frontend_candidate()
        plan = release.plan_release(self.root, candidate)
        self.assertIn('frontend/index.html', plan['reuse'])
        output = self.root / 'copy-race.tar.gz'
        pack.delta(self.archive(files, candidate), plan, output)
        original_stage = release.stage

        def change_before_copy(archive, releases, reuse_state=None):
            old_index = Path(self.state['frontend']['path']) / 'index.html'
            old_index.write_bytes(b'changed after locked planning')
            return original_stage(archive, releases, reuse_state=reuse_state)

        before = self.metadata_snapshot()
        with self.publish_hooks() as hooks, patch.object(release, 'stage', side_effect=change_before_copy):
            with self.assertRaises(release.ReleaseError):
                release.publish(self.root, output)
            for hook in hooks:
                hook.assert_not_called()
        self.assert_metadata_unchanged(before)
        for component in release.COMPONENTS:
            self.assertEqual((self.root / 'current' / component).resolve(), Path(self.state[component]['path']))
        self.assertEqual(set((self.root / 'releases').iterdir()), {self.root / 'releases' / OLD_SHA})

    def test_game_catalog_is_always_transferred_and_verified_even_when_unchanged(self):
        revision = 'd' * 64
        catalog_name = f'backend/GameData/data/versions/{revision}.json'
        catalog = json.dumps({'schema_version': 1, 'revision': revision, 'items': {}}).encode()
        pointer = {'schema_version': 1, 'revision': revision, 'versions': [revision],
                   'catalog_sha256': digest(catalog), 'version_hashes': {revision: digest(catalog)}}
        catalog_files = {catalog_name: catalog, 'backend/GameData/data/current.json': json.dumps(pointer).encode()}
        self.files.update(catalog_files)
        old_files = self.candidate_files(sha=OLD_SHA)
        self.old_manifest = self.manifest(old_files, sha=OLD_SHA, sources=OLD_SOURCES)
        self.materialize(self.old_manifest, old_files)
        files = self.candidate_files({'backend/App/views.py': b'VALUE = 2\n'})
        candidate = self.manifest(files)
        plan = release.plan_release(self.root, candidate)
        self.assertFalse(set(catalog_files) & set(plan['reuse']))
        output = self.root / 'catalog-delta.tar.gz'
        manifest = pack.delta(self.archive(files, candidate), plan, output)
        with tarfile.open(output) as archive:
            self.assertTrue(set(catalog_files) <= set(archive.getnames()))
        self.assertEqual(release.validate(output), manifest)
        manifest['reuse'][catalog_name] = digest(catalog)
        with self.assertRaises(release.ReleaseError):
            release.validate_manifest(manifest)

    def test_publish_recomputes_components_instead_of_trusting_delta_selection(self):
        files, candidate = self.frontend_candidate()
        manifest = self.delta_manifest(candidate, ['frontend', 'backend'])
        archive = self.archive(files, manifest)
        release.validate(archive)
        before = self.metadata_snapshot()
        with self.publish_hooks() as hooks:
            with self.assertRaises(release.ReleaseError):
                release.publish(self.root, archive)
            for hook in hooks:
                hook.assert_not_called()
        self.assert_metadata_unchanged(before)

    def test_delta_pending_migration_preflight_fails_before_any_switch(self):
        original_prepare = release.prepare_backend
        output = self.build_delta({'backend/App/views.py': b'VALUE = 2\n'})
        for database in ('default', 'license'):
            with self.subTest(database=database):
                def migration_gate(args, cwd=None):
                    if args[1].endswith('migration_check.py') and args[-1] == database:
                        raise release.ReleaseError('pending synthetic migration')

                before = self.metadata_snapshot()
                with self.publish_hooks() as (_, frontend, restart, health), \
                        patch.object(release, 'prepare_backend', side_effect=original_prepare) as backend, \
                        patch.object(release, 'command', side_effect=migration_gate) as command:
                    with self.assertRaisesRegex(release.ReleaseError, 'pending synthetic migration'):
                        release.publish(self.root, output)
                    backend.assert_called_once()
                    checks = [call.args[0][-1] for call in command.call_args_list
                              if call.args[0][1].endswith('migration_check.py')]
                    self.assertEqual(checks, ['default'] if database == 'default' else ['default', 'license'])
                    frontend.assert_not_called()
                    restart.assert_not_called()
                    health.assert_not_called()
                self.assert_metadata_unchanged(before)
                for component in release.COMPONENTS:
                    self.assertEqual((self.root / 'current' / component).resolve(), Path(self.state[component]['path']))

    def test_delta_health_failure_restores_active_pair_previous_and_clears_journal(self):
        for component, changes in [('frontend', {'frontend/index.html': b'<html>new UI</html>'}),
                                   ('backend', {'backend/App/views.py': b'VALUE = 2\n'})]:
            with self.subTest(component=component):
                output = self.build_delta(changes)
                before = self.metadata_snapshot()

                def fail_candidate(config, state):
                    if state[component]['sha'] == NEW_SHA:
                        raise release.ReleaseError('candidate health failed')

                with self.publish_hooks() as (_, _, restart, health):
                    health.side_effect = fail_candidate
                    with self.assertRaisesRegex(release.ReleaseError, 'rolled back and recovery verified'):
                        release.publish(self.root, output)
                    self.assertEqual(health.call_count, 2)
                    attempted = health.call_args_list[0].args[1]
                    self.assertEqual(attempted[component]['sha'], NEW_SHA)
                    self.assertEqual(health.call_args_list[1].args[1], self.state)
                    self.assertEqual(restart.call_count, 2 if component == 'backend' else 0)
                self.assert_recovery_metadata(before)

    def test_delta_recovery_health_failure_retains_journal_for_operator(self):
        output = self.build_delta({'backend/App/views.py': b'VALUE = 2\n'})
        before = self.metadata_snapshot()
        with self.publish_hooks() as (_, _, restart, health):
            health.side_effect = release.ReleaseError('health remains unavailable')
            with self.assertRaisesRegex(release.ReleaseError, 'recovery failed'):
                release.publish(self.root, output)
            self.assertEqual(health.call_count, 2)
            self.assertEqual(restart.call_count, 2)
        self.assertEqual(self.metadata_snapshot(), before)
        journal = json.loads((self.root / 'transaction.json').read_text())
        self.assertEqual(journal['old'], self.state)
        self.assertEqual(journal['changed'], ['backend'])
        self.assertEqual(journal['new']['backend']['sha'], NEW_SHA)
        self.assertEqual(journal['new']['frontend'], self.state['frontend'])

    def assert_delta_publish_then_manual_rollback(self, component, changes):
        output = self.build_delta(changes)
        with self.publish_hooks() as (backend, frontend, restart, health), \
                patch.object(release, 'command') as command:
            backend.side_effect = lambda root, staged, manifest, config: self.provision_runtime(staged / 'backend')
            release.publish(self.root, output)
            published = json.loads((self.root / 'state.json').read_text())
            omitted = 'backend' if component == 'frontend' else 'frontend'
            self.assertEqual(published[omitted], self.state[omitted])
            self.assertEqual(published[component]['sha'], NEW_SHA)
            self.assertNotEqual(Path(published[component]['path']).parent.name, NEW_SHA)
            self.assertEqual(json.loads((self.root / 'previous.json').read_text()), self.state)
            release.publish(self.root, rollback=True)
            self.assertEqual(health.call_count, 2)
            self.assertEqual(health.call_args_list[0].args[1], published)
            self.assertEqual(health.call_args_list[1].args[1], self.state)
            checks = [call.args[0][-1] for call in command.call_args_list
                      if call.args[0][1].endswith('migration_check.py')]
            self.assertEqual(checks, ['default', 'license'] if component == 'backend' else [])
            self.assertEqual(restart.call_count, 2 if component == 'backend' else 0)
            self.assertEqual(backend.call_count, 1 if component == 'backend' else 0)
            self.assertEqual(frontend.call_count, 1 if component == 'frontend' else 0)
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.state)
        self.assertEqual(json.loads((self.root / 'previous.json').read_text()), published)
        self.assertFalse((self.root / 'transaction.json').exists())
        for name in release.COMPONENTS:
            self.assertEqual((self.root / 'current' / name).resolve(), Path(self.state[name]['path']))

    def test_frontend_delta_manual_rollback_restores_mixed_release_paths(self):
        self.assert_delta_publish_then_manual_rollback('frontend', {'frontend/index.html': b'<html>new UI</html>'})

    def test_backend_delta_manual_rollback_restores_mixed_release_paths(self):
        self.assert_delta_publish_then_manual_rollback('backend', {'backend/App/views.py': b'VALUE = 2\n'})


class NoopTests(DeltaFixture):
    def test_verified_noop_checks_health_of_active_pair_without_writing_state(self):
        before = self.metadata_snapshot()
        with patch.object(release, 'health') as health, patch.object(release, 'atomic_json') as write:
            result = release.confirm_noop(self.root, self.noop_plan())
            health.assert_called_once_with(json.loads((self.root / 'config.json').read_text()), self.state)
            write.assert_not_called()
        self.assertEqual(result, {'format': 1, 'sha': NEW_SHA, 'base': release.state_token(self.state),
                                  'components': [], 'policy': policy_digest()})
        self.assert_metadata_unchanged(before)

    def test_noop_pair_policy_and_equal_inputs_are_all_required(self):
        original = self.noop_plan()
        mutations = [
            lambda plan: plan['baseline'].__setitem__('frontend', 'd' * 40),
            lambda plan: plan['baseline'].__setitem__('backend', 'e' * 40),
            lambda plan: plan.__setitem__('policy', 'd' * 64),
            lambda plan: plan['inputs']['frontend'].__setitem__('head', 'd' * 64),
            lambda plan: plan['inputs']['backend'].__setitem__('baseline', 'e' * 64),
            lambda plan: plan['baseline'].pop('backend'),
            lambda plan: plan['inputs'].pop('frontend'),
            lambda plan: plan.__setitem__('action', 'release'),
            lambda plan: plan.__setitem__('sha', 'invalid'),
        ]
        before = self.metadata_snapshot()
        for index, mutate in enumerate(mutations):
            with self.subTest(case=index):
                plan = deepcopy(original)
                mutate(plan)
                with patch.object(release, 'health') as health:
                    with self.assertRaises(release.ReleaseError):
                        release.confirm_noop(self.root, plan)
                    health.assert_not_called()
                self.assert_metadata_unchanged(before)

    def test_failed_noop_health_leaves_state_and_previous_untouched(self):
        before = self.metadata_snapshot()
        with patch.object(release, 'health', side_effect=release.ReleaseError('unhealthy active pair')) as health:
            with self.assertRaises(release.ReleaseError):
                release.confirm_noop(self.root, self.noop_plan())
            health.assert_called_once()
        self.assert_metadata_unchanged(before)

    def test_noop_refuses_missing_or_legacy_baseline_evidence(self):
        before = self.metadata_snapshot()
        manifest_path = self.root / 'releases' / OLD_SHA / 'manifest.json'
        manifest_path.unlink()
        with patch.object(release, 'health') as health:
            with self.assertRaises(release.ReleaseError):
                release.confirm_noop(self.root, self.noop_plan())
            health.assert_not_called()
        self.assert_metadata_unchanged(before)
        self.write_json(f'releases/{OLD_SHA}/manifest.json', self.old_manifest)
        self.state['frontend']['legacy'] = True
        self.write_json('state.json', self.state)
        before = self.metadata_snapshot()
        with patch.object(release, 'health') as health:
            with self.assertRaises(release.ReleaseError):
                release.confirm_noop(self.root, self.noop_plan())
            health.assert_not_called()
        self.assert_metadata_unchanged(before)

    def test_noop_refuses_state_link_disagreement_and_unfinished_journal(self):
        before = self.metadata_snapshot()
        self.set_current('frontend', self.root / 'releases' / 'wrong' / 'frontend')
        with patch.object(release, 'health') as health:
            with self.assertRaises(release.ReleaseError):
                release.confirm_noop(self.root, self.noop_plan())
            health.assert_not_called()
        self.assert_metadata_unchanged(before)
        self.set_current('frontend', Path(self.state['frontend']['path']))
        self.write_json('transaction.json', {'unfinished': True})
        with patch.object(release, 'health') as health:
            with self.assertRaises(release.ReleaseError):
                release.confirm_noop(self.root, self.noop_plan())
            health.assert_not_called()
        self.assertEqual(self.metadata_snapshot(), before)
        self.assertTrue((self.root / 'transaction.json').exists())

    def test_noop_health_runs_while_the_server_lock_is_held(self):
        held = []

        @contextmanager
        def tracking_lock(root):
            held.append(root)
            try:
                yield
            finally:
                held.pop()

        def health(config, state):
            self.assertEqual(held, [self.root])
            self.assertEqual(state, self.state)

        with patch.object(release, 'server_lock', tracking_lock), patch.object(release, 'health', side_effect=health):
            release.confirm_noop(self.root, self.noop_plan())
        self.assertEqual(held, [])


@unittest.skipUnless(sys.platform.startswith('linux'), 'requires real Linux flock and symlinks')
class LinuxDeltaLockTests(DeltaFixture):
    def test_concurrent_plan_noop_and_delta_publish_refuse_real_held_lock(self):
        import fcntl
        files = self.candidate_files({'frontend/assets/app.js': b'changed'})
        candidate = self.manifest(files)
        plan = release.plan_release(self.root, candidate)
        archive = self.root / 'locked-delta.tar.gz'
        pack.delta(self.archive(files, candidate), plan, archive)
        before = self.metadata_snapshot()
        with (self.root / 'publish.lock').open('a') as locked:
            fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for action in (lambda: release.plan_release(self.root, candidate),
                           lambda: release.confirm_noop(self.root, self.noop_plan()),
                           lambda: release.publish(self.root, archive)):
                with self.subTest(action=action):
                    with self.publish_hooks() as hooks:
                        with self.assertRaises((release.ReleaseError, BlockingIOError)):
                            action()
                        for hook in hooks:
                            hook.assert_not_called()
        self.assert_metadata_unchanged(before)
        self.assertEqual((self.root / 'current/frontend').resolve(), Path(self.state['frontend']['path']))
        self.assertFalse((self.root / 'releases' / NEW_SHA).exists())

    def test_active_file_symlink_cannot_supply_baseline_evidence(self):
        path = Path(self.state['backend']['path']) / 'App/views.py'
        outside = self.root / 'outside.py'
        outside.write_bytes(path.read_bytes())
        path.unlink()
        path.symlink_to(outside)
        with self.assertRaises(release.ReleaseError):
            release.plan_release(self.root, self.manifest(self.candidate_files()))


if __name__ == '__main__':
    unittest.main()
