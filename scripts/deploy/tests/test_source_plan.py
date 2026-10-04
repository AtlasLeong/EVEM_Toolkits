import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest import mock


DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DIRECTORY))
import source_plan


# The reviewed old build pipeline, with delivery steps still inside validate.
# Its build semantics must equal the separated validate/package workflow without
# relying on Git history being present in a depth-one CI checkout.
CI_WORKFLOW = textwrap.dedent("""\
name: CI
jobs:
  validate:
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    defaults:
      run:
        shell: bash
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '22'
      - name: Install frontend dependencies
        working-directory: front-codex
        run: npm ci --no-audit --no-fund
      - name: Build frontend
        working-directory: front-codex
        run: npm run build 2>&1 | tee ../ci-evidence/frontend-build.log
      - name: Package verified commit
        run: python scripts/deploy/pack.py
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: release-${{ github.sha }}
          path: release.tar.gz
          if-no-files-found: error
          retention-days: 14
""")


class SourcePlanTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.git('init', '-q')
        self.git('config', 'core.autocrlf', 'false')
        for name, content in {
            'backend/manage.py': '# application\n',
            'backend/requirements.txt': 'Django==4.2.5\n',
            'backend/EVE_MDjango/settings.py': 'DEBUG = False\n',
            'backend/Market/migrations/0001_initial.py': '# migration\n',
            'backend/Authentication/tests.py': '# tests\n',
            'front-codex/index.html': '<html>app</html>\n',
            'front-codex/package.json': '{}\n',
            'front-codex/package-lock.json': '{}\n',
            'front-codex/vite.config.js': 'export default {}\n',
            'front-codex/src/main.jsx': '// application\n',
            'front-codex/tests/unit/app.test.mjs': '// tests\n',
            'README.md': '# repository documentation\n',
            'docs/deploy.md': '# deployment documentation\n',
            '.github/workflows/ci.yml': CI_WORKFLOW,
        }.items():
            self.write(name, content)
        self.base = self.commit('initial fixture')
        self.baseline = {c: self.base for c in source_plan.COMPONENTS}

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root,
                                       text=True, stderr=subprocess.PIPE)

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

    def commit(self, message):
        self.git('add', '.')
        self.git('-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid',
                 'commit', '-qm', message)
        return self.git('rev-parse', 'HEAD').strip()

    def plan(self, baseline=None):
        return source_plan.build_plan(self.root, self.baseline if baseline is None else baseline)

    def assert_changed(self, component):
        result = self.plan()
        self.assertEqual(result['action'], 'release')
        self.assertNotEqual(result['inputs'][component]['head'],
                            result['inputs'][component]['baseline'])
        other = 'backend' if component == 'frontend' else 'frontend'
        self.assertEqual(result['inputs'][other]['head'],
                         result['inputs'][other]['baseline'])

    def test_current_commit_is_noop_with_both_fingerprints_and_policy(self):
        result = self.plan()
        self.assertEqual(result['format'], 1)
        self.assertEqual(result['sha'], self.base)
        self.assertEqual(result['baseline'], self.baseline)
        self.assertEqual(result['action'], 'noop')
        self.assertEqual(result['reasons'], [])
        self.assertEqual(result['policy'], hashlib.sha256(
            Path(source_plan.__file__).read_bytes().replace(b'\r\n', b'\n')).hexdigest())
        for component in source_plan.COMPONENTS:
            self.assertEqual(result['inputs'][component]['head'],
                             result['inputs'][component]['baseline'])
            self.assertRegex(result['inputs'][component]['head'], r'^[0-9a-f]{64}$')

    def test_reviewed_test_only_changes_are_noop(self):
        for name in ('backend/Authentication/tests.py',
                     'backend/Market/tests/test_new.py',
                     'front-codex/tests/unit/app.test.mjs',
                     'scripts/deploy/tests/test_new.py'):
            self.write(name, '# changed tests\n')
        head = self.commit('only reviewed test paths')
        result = self.plan()
        self.assertNotEqual(head, self.base)
        self.assertEqual(result['action'], 'noop')

    def test_control_only_release_and_later_tests_keep_old_active_baseline_noop(self):
        final_ci = (DIRECTORY.parents[1] / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        old_context = source_plan.frontend_build_context(CI_WORKFLOW.encode())
        new_context = source_plan.frontend_build_context(final_ci.encode())
        self.assertTrue(old_context.startswith(b'reviewed-ci-build-v1\0'))
        self.assertTrue(new_context.startswith(b'reviewed-ci-build-v1\0'))
        self.assertEqual(old_context, new_context)
        for name in source_plan.CONTROL_FILES - {'.github/workflows/ci.yml'}:
            self.write(name, '# separately reviewed deployment/verification control\n')
        self.write('.github/workflows/ci.yml', final_ci)
        self.commit('install controls while active application SHAs remain old')
        self.assertEqual(self.plan()['action'], 'noop')
        self.write('front-codex/tests/unit/app.test.mjs', '// later test-only change\n')
        self.write('docs/deploy.md', '# later docs-only change\n')
        self.commit('test/docs commit following byte-identical delivery')
        result = self.plan()
        self.assertEqual(result['action'], 'noop')
        self.assertEqual(result['baseline'], self.baseline)
        for component in source_plan.COMPONENTS:
            self.assertEqual(result['inputs'][component]['head'],
                             result['inputs'][component]['baseline'])

    def test_ci_node_version_runner_action_and_install_flags_are_build_inputs(self):
        cases = (
            CI_WORKFLOW.replace("node-version: '22'", "node-version: '24'"),
            CI_WORKFLOW.replace('runs-on: ubuntu-24.04', 'runs-on: ubuntu-latest'),
            CI_WORKFLOW.replace('setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
                                'setup-node@' + 'b' * 40),
            CI_WORKFLOW.replace('npm ci --no-audit --no-fund',
                                'npm ci --ignore-scripts --no-audit --no-fund'),
        )
        for index, content in enumerate(cases):
            with self.subTest(index=index):
                self.write('.github/workflows/ci.yml', content)
                self.commit('changed compilation toolchain ' + str(index))
                self.assert_changed('frontend')

    def test_ci_build_flags_and_shell_defaults_are_build_inputs(self):
        for index, content in enumerate((
                CI_WORKFLOW.replace('npm run build 2>&1',
                                    'npm run build -- --mode development 2>&1'),
                CI_WORKFLOW.replace('shell: bash', 'shell: sh'),
                CI_WORKFLOW.replace('jobs:\n', 'defaults:\n  run:\n    shell: bash\njobs:\n'))):
            with self.subTest(index=index):
                self.write('.github/workflows/ci.yml', content)
                self.commit('changed build command/defaults ' + str(index))
                self.assert_changed('frontend')

    def test_ci_global_job_and_step_environment_changes_are_build_inputs(self):
        cases = (
            CI_WORKFLOW.replace('jobs:\n', 'env:\n  VITE_API_URL: https://example.invalid/api\njobs:\n'),
            CI_WORKFLOW.replace('    steps:\n', '    env:\n      NODE_OPTIONS: --max-old-space-size=2048\n    steps:\n'),
            CI_WORKFLOW.replace('      - name: Build frontend\n',
                                '      - name: Build frontend\n        env:\n          VITE_FEATURE: enabled\n'),
            CI_WORKFLOW.replace('      - name: Install frontend dependencies\n',
                                '      - name: Install frontend dependencies\n        env:\n          NPM_CONFIG_IGNORE_SCRIPTS: true\n'),
        )
        for index, content in enumerate(cases):
            with self.subTest(index=index):
                self.write('.github/workflows/ci.yml', content)
                self.commit('changed compilation environment ' + str(index))
                self.assert_changed('frontend')

    def test_ci_unknown_steps_and_changed_reviewed_control_cannot_hide_build_mutation(self):
        cases = (
            CI_WORKFLOW.replace('      - name: Build frontend\n',
                                '      - name: Inject build input\n        run: echo VITE_FEATURE=enabled >> "$GITHUB_ENV"\n      - name: Build frontend\n'),
            CI_WORKFLOW.replace('run: python scripts/deploy/pack.py',
                                'run: python scripts/deploy/pack.py && npm run build -- --mode development'),
            CI_WORKFLOW + '  new_build_job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run build\n',
            CI_WORKFLOW.replace('    steps:\n', '    strategy:\n      matrix:\n        node: [22, 24]\n    steps:\n'),
        )
        for index, content in enumerate(cases):
            with self.subTest(index=index):
                self.assertTrue(source_plan.frontend_build_context(content.encode()).startswith(
                    b'opaque-ci-build-v1\0'))
                self.write('.github/workflows/ci.yml', content)
                self.commit('unknown workflow mutation ' + str(index))
                self.assert_changed('frontend')

    def test_unknown_deploy_scripts_and_workflows_remain_shared_runtime_inputs(self):
        self.write('scripts/deploy/unreviewed-product.py', '# unknown product/build tool\n')
        self.write('.github/workflows/unreviewed.yml', '# unknown workflow\n')
        self.commit('new unreviewed tooling')
        result = self.plan()
        self.assertEqual(result['action'], 'release')
        for component in source_plan.COMPONENTS:
            self.assertNotEqual(result['inputs'][component]['head'],
                                result['inputs'][component]['baseline'])

    def test_document_only_changes_and_deletions_are_noop(self):
        (self.root / 'README.md').unlink()
        self.write('docs/deploy.md', '# updated documentation\n')
        self.write('backend/Community/README.md', '# application documentation\n')
        self.write('front-codex/TEST_CHECKLIST.md', '# checklist\n')
        self.commit('only reviewed documentation paths')
        self.assertEqual(self.plan()['action'], 'noop')

    def test_frontend_runtime_change(self):
        self.write('front-codex/src/main.jsx', '// new UI\n')
        self.commit('frontend product')
        self.assert_changed('frontend')

    def test_backend_runtime_change(self):
        self.write('backend/manage.py', '# new application\n')
        self.commit('backend product')
        self.assert_changed('backend')

    def test_migration_change_requires_backend_release(self):
        self.write('backend/Market/migrations/0001_initial.py', '# revised migration\n')
        self.commit('migration product')
        self.assert_changed('backend')

    def test_requirements_change_requires_backend_release(self):
        self.write('backend/requirements.txt', 'Django==4.2.6\n')
        self.commit('dependency product')
        self.assert_changed('backend')

    def test_settings_even_test_named_settings_require_backend_release(self):
        self.write('backend/EVE_MDjango/test_settings.py', 'DATABASES = {}\n')
        self.commit('settings remain runtime inputs')
        self.assert_changed('backend')

    def test_build_configuration_and_lockfile_require_frontend_release(self):
        self.write('front-codex/vite.config.js', 'export default {build: {}}\n')
        self.write('front-codex/package-lock.json', '{"lockfileVersion": 3}\n')
        self.commit('build inputs')
        self.assert_changed('frontend')

    def test_executable_mode_alone_is_a_runtime_change(self):
        self.git('update-index', '--chmod=+x', 'backend/manage.py')
        self.git('-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid',
                 'commit', '-qm', 'mode only')
        self.assert_changed('backend')

    def test_runtime_file_deletion_requires_a_release(self):
        (self.root / 'front-codex/src/main.jsx').unlink()
        self.commit('delete application entry')
        self.assert_changed('frontend')

    def test_unknown_paths_and_test_like_names_cannot_enable_noop(self):
        self.write('new-product/test_runtime.py', '# unknown product input\n')
        self.write('backend/NewApplication/tests.py', '# unreviewed name\n')
        self.write('backend/README_runtime.md', '# unreviewed application data\n')
        self.commit('unknown inputs require release')
        result = self.plan()
        self.assertEqual(result['action'], 'release')
        for component in source_plan.COMPONENTS:
            self.assertNotEqual(result['inputs'][component]['head'],
                                result['inputs'][component]['baseline'])

    def test_failed_prior_product_commit_followed_by_tests_still_releases(self):
        self.write('front-codex/src/main.jsx', '// product commit that failed CI\n')
        failed = self.commit('failed product candidate')
        self.write('front-codex/tests/unit/app.test.mjs', '// fix a test\n')
        head = self.commit('later test-only commit')
        self.assertEqual(source_plan.component_fingerprint(self.root, failed, 'frontend'),
                         source_plan.component_fingerprint(self.root, head, 'frontend'))
        self.assert_changed('frontend')

    def test_frontend_and_backend_use_independent_active_baselines(self):
        self.write('front-codex/src/main.jsx', '// new UI\n')
        frontend_active = self.commit('frontend successful release')
        self.write('backend/manage.py', '# new application\n')
        backend_active = self.commit('backend successful release')
        self.write('docs/deploy.md', '# document component releases\n')
        self.write('front-codex/tests/unit/app.test.mjs', '// more checks\n')
        self.commit('docs/tests after independent releases')
        baseline = {'frontend': frontend_active, 'backend': backend_active}
        result = self.plan(baseline)
        self.assertEqual(result['baseline'], baseline)
        self.assertEqual(result['action'], 'noop')
        stale_backend = self.plan({'frontend': frontend_active, 'backend': self.base})
        self.assertEqual(stale_backend['action'], 'release')
        self.assertEqual(stale_backend['inputs']['frontend']['head'],
                         stale_backend['inputs']['frontend']['baseline'])
        self.assertNotEqual(stale_backend['inputs']['backend']['head'],
                            stale_backend['inputs']['backend']['baseline'])

    def test_working_tree_and_untracked_content_do_not_affect_committed_inputs(self):
        self.write('backend/manage.py', '# uncommitted bytes\n')
        self.write('front-codex/src/untracked.jsx', '// untracked\n')
        self.assertEqual(self.plan()['action'], 'noop')
        self.git('config', 'core.autocrlf', 'true')
        self.assertEqual(self.plan()['action'], 'noop')

    def test_unavailable_active_commit_cannot_enable_noop(self):
        unavailable = 'a' * 40
        with mock.patch.object(source_plan, '_fetch_commit', side_effect=source_plan.PlanError('offline')) as fetch:
            result = self.plan({'frontend': unavailable, 'backend': self.base})
        fetch.assert_called_once_with(self.root, unavailable)
        self.assertEqual(result['action'], 'release')
        self.assertEqual(result['baseline']['frontend'], unavailable)
        self.assertIsNone(result['inputs']['frontend']['baseline'])
        self.assertEqual(result['reasons'], ['active-commit-unavailable:frontend'])

    def test_partial_or_invalid_active_version_proof_is_discarded(self):
        for baseline in ({}, {'frontend': self.base},
                         {'frontend': '../HEAD', 'backend': self.base},
                         {'frontend': 'A' * 40, 'backend': self.base},
                         {'frontend': self.base, 'backend': self.base, 'extra': self.base}):
            with self.subTest(baseline=baseline):
                result = self.plan(baseline)
                self.assertEqual(result['action'], 'release')
                self.assertEqual(result['baseline'], {})
                self.assertEqual(result['reasons'], ['active-version-proof-unavailable'])

    def test_default_plan_reads_public_versions(self):
        with mock.patch.object(source_plan, 'read_active_versions', return_value=self.baseline) as read:
            self.assertEqual(source_plan.build_plan(self.root)['action'], 'noop')
        read.assert_called_once_with()

    def test_public_origin_fetch_is_depth_one_and_credential_free(self):
        missing = 'a' * 40
        origin = 'https://github.com/example/public-repo.git'
        objects = (self.root / '.git/objects').resolve()
        with mock.patch.object(source_plan, '_git', side_effect=[
                origin.encode(), str(objects).encode(), b'', b'']) as git:
            source_plan._fetch_commit(self.root, missing)
        calls = git.call_args_list
        self.assertEqual(len(calls), 4)
        self.assertEqual(calls[0].args, (self.root, 'remote', 'get-url', 'origin'))
        self.assertEqual(calls[1].args, (self.root, 'rev-parse', '--git-path', 'objects'))
        isolated = calls[2].args[0]
        self.assertNotEqual(isolated, self.root)
        self.assertEqual(calls[2].args, (isolated, 'init', '--bare', '--quiet', '--template='))
        self.assertEqual(calls[3].args, (isolated, 'fetch', '--depth=1', '--no-tags',
                                        '--no-write-fetch-head', origin, missing))
        self.assertEqual(calls[3].kwargs['timeout'], 60)
        self.assertEqual(calls[3].kwargs['object_directory'], objects)
        self.assertEqual(calls[3].kwargs['config'],
                         ('protocol.allow=never', 'protocol.https.allow=always',
                          'maintenance.auto=false', 'gc.auto=0', 'fetch.writeCommitGraph=false'))
        self.assertFalse(isolated.exists())

    def test_git_object_directory_uses_only_an_explicit_absolute_store(self):
        objects = (self.root / '.git/objects').resolve()
        with mock.patch.dict(source_plan.os.environ, {'GIT_OBJECT_DIRECTORY': 'inherited-private-store'}):
            with mock.patch.object(source_plan.subprocess, 'run', return_value=mock.Mock(stdout=b'')) as run:
                source_plan._git(self.root, 'cat-file', '-e', self.base)
                self.assertNotIn('GIT_OBJECT_DIRECTORY', run.call_args.kwargs['env'])
                source_plan._git(self.root, 'cat-file', '-e', self.base, object_directory=objects)
                self.assertEqual(run.call_args.kwargs['env']['GIT_OBJECT_DIRECTORY'], str(objects))
        for invalid in (Path('.git/objects'), self.root / 'missing-object-store'):
            with self.subTest(invalid=invalid):
                with mock.patch.object(source_plan.subprocess, 'run') as run:
                    with self.assertRaises(source_plan.PlanError):
                        source_plan._git(self.root, 'cat-file', '-e', self.base, object_directory=invalid)
                run.assert_not_called()

    def test_isolated_fetch_populates_shallow_store_without_changing_git_metadata(self):
        self.write('docs/deploy.md', '# test/docs candidate after old application release\n')
        candidate = self.commit('docs-only candidate')
        with tempfile.TemporaryDirectory() as temporary:
            shallow = Path(temporary)
            source_plan._git(shallow, 'init', '-q', '--template=')
            source_plan._git(shallow, 'fetch', '--depth=1', '--no-tags', '--no-write-fetch-head',
                             self.root.as_uri(), candidate, config=('protocol.file.allow=always',))
            source_plan._git(shallow, 'update-ref', 'HEAD', candidate)
            origin = 'https://github.com/example/public-repo.git'
            source_plan._git(shallow, 'remote', 'add', 'origin', origin)
            # Synthetic local config must never reach the isolated HTTPS helper.
            source_plan._git(shallow, 'config', 'http.sslCert', 'must-not-load-client-cert.pem')
            source_plan._git(shallow, 'config', 'http.extraHeader', 'X-Test-Never-Inherit: fixture')
            metadata = ('HEAD', 'shallow', 'FETCH_HEAD', 'config')
            def snapshot():
                return {name: (shallow / '.git' / name).read_bytes()
                        if (shallow / '.git' / name).exists() else None for name in metadata}
            before = snapshot()
            with self.assertRaises(source_plan.PlanError):
                source_plan._git(shallow, 'cat-file', '-e', self.base + '^{commit}')
            original_git = source_plan._git
            observed = []
            def local_fixture_transport(repo, *args, **kwargs):
                if args and args[0] == 'fetch' and args[-2] == origin:
                    self.assertNotEqual(repo, shallow)
                    self.assertNotIn('sslCert', (Path(repo) / 'config').read_text())
                    self.assertNotIn('extraHeader', (Path(repo) / 'config').read_text())
                    self.assertEqual(kwargs['object_directory'], (shallow / '.git/objects').resolve())
                    observed.append(repo)
                    args = (*args[:-2], self.root.as_uri(), args[-1])
                    kwargs['config'] = (*kwargs['config'], 'protocol.file.allow=always')
                return original_git(repo, *args, **kwargs)
            with mock.patch.object(source_plan, '_git', side_effect=local_fixture_transport):
                result = source_plan.build_plan(shallow, self.baseline)
            self.assertEqual(len(observed), 1)
            self.assertFalse(observed[0].exists())
            metadata_unchanged = snapshot() == before
            self.assertTrue(metadata_unchanged)
            self.assertEqual(result['action'], 'noop')
            original_git(shallow, 'cat-file', '-e', self.base + '^{commit}')
            # Positive control uses committed product bytes, not working files.
            self.write('front-codex/src/main.jsx', '// changed product\n')
            product = self.commit('product-positive control')
            original_git(shallow, 'fetch', '--depth=1', '--no-tags', '--no-write-fetch-head',
                         self.root.as_uri(), product, config=('protocol.file.allow=always',))
            original_git(shallow, 'update-ref', 'HEAD', product)
            positive = source_plan.build_plan(shallow, self.baseline)
            self.assertEqual(positive['action'], 'release')
            self.assertEqual(positive['reasons'], ['runtime-inputs-changed:frontend'])
            print('Source-plan shallow regression: ' + json.dumps({
                'action': result['action'], 'sha': result['sha'],
                'baseline': result['baseline'], 'metadata_unchanged': metadata_unchanged,
                'positive_action': positive['action'], 'positive_sha': positive['sha'],
                'positive_reasons': positive['reasons'],
            }, sort_keys=True), flush=True)

    def test_authenticated_or_nonpublic_origin_never_fetches(self):
        for origin in ('https://token@github.com/example/repo.git',
                       'git@github.com:example/repo.git',
                       'https://github.com/example/repo.git?token=secret',
                       'https://localhost/example/repo.git',
                       'file:///private/repo.git'):
            with self.subTest(origin=origin):
                with mock.patch.object(source_plan, '_git', return_value=origin.encode()) as git:
                    with self.assertRaises(source_plan.PlanError):
                        source_plan._fetch_commit(self.root, 'a' * 40)
                self.assertEqual(git.call_count, 1)

    def test_git_environment_never_loads_credential_helpers_or_inherited_config(self):
        with mock.patch.dict(source_plan.os.environ, {
                'GIT_ASKPASS': 'private-helper', 'GIT_CONFIG_COUNT': '1',
                'GIT_CONFIG_KEY_0': 'http.extraHeader',
                'GIT_CONFIG_VALUE_0': 'private-value', 'HTTPS_PROXY': 'private-proxy'}):
            with mock.patch.object(source_plan.subprocess, 'run', return_value=mock.Mock(stdout=b'')) as run:
                source_plan._git(self.root, 'ls-tree', 'HEAD')
        args, kwargs = run.call_args
        self.assertIn('credential.helper=', args[0])
        self.assertIn('http.extraHeader=', args[0])
        self.assertEqual(kwargs['env']['GIT_TERMINAL_PROMPT'], '0')
        self.assertEqual(kwargs['env']['GIT_CONFIG_GLOBAL'], source_plan.os.devnull)
        self.assertEqual(kwargs['env']['GIT_NO_LAZY_FETCH'], '1')
        self.assertEqual(kwargs['env']['GIT_NO_REPLACE_OBJECTS'], '1')
        self.assertNotIn('GIT_CONFIG_VALUE_0', kwargs['env'])
        self.assertNotIn('HTTPS_PROXY', kwargs['env'])

    def test_policy_exclusions_are_precise_and_unknown_names_are_runtime(self):
        for name in ('backend/Authentication/tests.py', 'backend/Market/tests/new.py',
                     'docs/new.md', 'scripts/deploy/tests/test_release.py',
                     'scripts/deploy/requirements-ci.txt', 'scripts/deploy/release.py',
                     '.github/workflows/ci.yml', '.github/workflows/deploy.yml'):
            self.assertFalse(source_plan.runtime_path(name), name)
        for name in ('backend/NewApp/tests.py', 'backend/Market/tests_runtime.py',
                     'backend/Market/migrations/0002_test_name.py',
                     'backend/EVE_MDjango/test_settings.py', 'new-docs/readme.md',
                     'front-codex/src/readme.md', 'scripts/deploy/unreviewed.py',
                     'front-codex/tests-runtime.js', '.github/workflows/unreviewed.yml'):
            self.assertTrue(source_plan.runtime_path(name), name)
        for name in ('../docs/x', '/docs/x', 'docs//x', 'docs/./x', 'docs\\x'):
            with self.assertRaises(source_plan.PlanError):
                source_plan.runtime_path(name)

    def test_plan_output_is_complete_json(self):
        output = self.root / 'plan.json'
        plan = self.plan()
        source_plan._write_plan(output, plan)
        self.assertEqual(json.loads(output.read_text(encoding='utf-8')), plan)
        self.assertEqual(list(self.root.glob('.plan.json.*')), [])


class PublicVersionTests(unittest.TestCase):
    @staticmethod
    def response(value, status=200):
        response = io.BytesIO(json.dumps(value).encode())
        response.status = status
        return response

    def test_two_readonly_gets_validate_independent_exact_shas(self):
        opener = mock.Mock(side_effect=[self.response({'sha': 'a' * 40}),
                                        self.response({'sha': 'b' * 40})])
        self.assertEqual(source_plan.read_active_versions(open_url=opener, timeout=7),
                         {'frontend': 'a' * 40, 'backend': 'b' * 40})
        self.assertEqual(opener.call_count, 2)
        for call, url in zip(opener.call_args_list, source_plan.VERSION_URLS.values()):
            request = call.args[0]
            self.assertEqual(request.full_url, url)
            self.assertEqual(request.get_method(), 'GET')
            self.assertEqual(request.get_header('Cache-control'), 'no-cache')
            self.assertIsNone(request.get_header('Authorization'))
            self.assertEqual(call.kwargs, {'timeout': 7})

    def test_any_get_failure_discards_partial_baseline_and_still_reads_both(self):
        for responses in ((OSError('offline'), self.response({'sha': 'b' * 40})),
                          (self.response({'sha': 'a' * 40}), OSError('offline'))):
            opener = mock.Mock(side_effect=responses)
            self.assertEqual(source_plan.read_active_versions(open_url=opener), {})
            self.assertEqual(opener.call_count, 2)

    def test_invalid_json_shape_sha_and_status_fail_closed(self):
        for value, status in (({'sha': 'a' * 39}, 200), ({'sha': 'g' * 40}, 200),
                              ({'sha': 'a' * 40 + '\n'}, 200), ({'sha': None}, 200),
                              ({'sha': 'A' * 40}, 200), ([], 200),
                              ({'sha': 'a' * 40}, 503)):
            with self.subTest(value=value, status=status):
                opener = mock.Mock(side_effect=[self.response(value, status),
                                                self.response({'sha': 'b' * 40})])
                self.assertEqual(source_plan.read_active_versions(open_url=opener), {})

    def test_oversized_or_nonjson_response_fails_closed(self):
        for content in (b'{' + b' ' * source_plan.MAX_VERSION_BYTES, b'<html>unavailable</html>'):
            response = io.BytesIO(content)
            response.status = 200
            opener = mock.Mock(side_effect=[response, self.response({'sha': 'b' * 40})])
            self.assertEqual(source_plan.read_active_versions(open_url=opener), {})

    def test_default_http_client_has_no_proxy_or_redirect_authentication(self):
        open_url = mock.Mock(side_effect=[self.response({'sha': 'a' * 40}),
                                         self.response({'sha': 'b' * 40})])
        with mock.patch.object(source_plan.urllib.request, 'build_opener', return_value=mock.Mock(open=open_url)) as build:
            self.assertEqual(len(source_plan.read_active_versions()), 2)
        handlers = build.call_args.args
        self.assertEqual(handlers[0].proxies, {})
        with self.assertRaises(source_plan.PlanError):
            handlers[1].redirect_request(None, None, 302, '', {}, 'https://other.invalid/')


if __name__ == '__main__':
    unittest.main()
