"""Small contract checks for gates that cannot be run as GitHub Actions locally."""
from pathlib import Path
import copy
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import textwrap
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[3]
SHA = 'a' * 40


def workflow(name):
    return (ROOT / '.github/workflows' / name).read_text(encoding='utf-8')


def job(content, name):
    match = re.search(r'(?ms)^  ' + re.escape(name) + r':\s*\n(.*?)(?=^  [a-z][a-z_]*:\s*$|\Z)', content)
    if match is None:
        raise AssertionError('missing job ' + name)
    return match.group(1)


def step(content, name):
    match = re.search(r'(?ms)^      - name: ' + re.escape(name) + r'\n(.*?)(?=^      - |\Z)', content)
    if match is None:
        raise AssertionError('missing step ' + name)
    return match.group(1)


def inline_python(content, name):
    match = re.search(r"(?ms)^          python - <<'PY'\n(.*?)^          PY$", step(content, name))
    if match is None:
        raise AssertionError('missing inline Python in ' + name)
    return textwrap.dedent(match.group(1))


def ci_case():
    repository = {'id': 41, 'full_name': 'owner/repo', 'fork': False}
    run = {
        'id': 23, 'run_attempt': 2, 'workflow_id': 12, 'name': 'CI',
        'event': 'push', 'head_branch': 'master', 'head_sha': SHA,
        'path': '.github/workflows/ci.yml', 'status': 'completed',
        'conclusion': 'success', 'repository': copy.deepcopy(repository),
        'head_repository': copy.deepcopy(repository),
    }
    event = {'action': 'completed', 'repository': repository, 'workflow_run': copy.deepcopy(run)}
    definition = {'id': 12, 'path': '.github/workflows/ci.yml', 'name': 'CI', 'state': 'active'}
    jobs = [
        {'id': index, 'run_id': 23, 'head_sha': SHA, 'name': name,
         'status': 'completed', 'conclusion': 'success'}
        for index, name in enumerate(('market_mysql', 'validate', 'package'), start=1)
    ]
    master = {'ref': 'refs/heads/master', 'object': {'type': 'commit', 'sha': SHA}}
    return event, run, definition, jobs, master


def plan_case(action='release'):
    policy = hashlib.sha256((ROOT / 'scripts/deploy/source_plan.py').read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    return {
        'format': 1, 'action': action, 'sha': SHA, 'policy': policy,
        'baseline': {'frontend': 'b' * 40, 'backend': 'c' * 40},
        'inputs': {'frontend': {'head': 'd' * 64, 'baseline': 'd' * 64},
                   'backend': {'head': 'e' * 64, 'baseline': 'e' * 64}},
        'reasons': [],
    }


class CIGatesTests(unittest.TestCase):
    def test_ci_keeps_all_required_safety_and_ui_gates(self):
        workflow = (Path(__file__).resolve().parents[3] / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        for command in ('python -m unittest discover -s scripts/deploy/tests -v',
                        'python -m unittest discover -s scripts/community/tests -v',
                        'node --test tests/unit/*.test.mjs tests/preview/*.test.mjs',
                        'npx playwright test --config tests/preview-e2e/playwright.config.js',
                        'npm run test:e2e', 'npm run build', 'npm run check:bundle'):
            with self.subTest(command=command):
                self.assertIn(command, workflow)
        self.assertNotIn('continue-on-error', workflow)
        self.assertIn('front-codex/output/preview-sandbox-tests', workflow)
        self.assertIn('ci-evidence', workflow)
        self.assertIn('if: failure()', workflow)
        self.assertIn('branches: [master, codex/automated-deployment]', workflow)
        self.assertIn('branches: [master]', workflow)
        self.assertIn('Community Starsea EVE_MDjango.tests_deployment', workflow)
        self.assertIn('makemigrations Feedback Community Starsea', workflow)
        self.assertIn('workflow_call:', workflow)

    def test_market_mysql_integration_has_an_independent_service_job(self):
        workflow = (Path(__file__).resolve().parents[3] / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        self.assertRegex(workflow, r'(?m)^  market_mysql:\s*$')
        job = re.search(r'(?ms)^  market_mysql:\s*\n(.*?)(?=^  [a-z][a-z_]*:\s*$|\Z)', workflow)
        self.assertIsNotNone(job)
        content = job.group(1)
        for required in (
            'image: mysql:8.0.37',
            'MYSQL_DATABASE: market_ci',
            'MYSQL_USER: market_ci',
            'MARKET_CI_MYSQL:',
            'market_mysql_ci_settings',
            'python manage.py migrate',
            'tests_market_mysql_integration',
        ):
            with self.subTest(required=required):
                self.assertIn(required, content)
        self.assertNotIn('EVE_MDjango.settings', content)
        self.assertNotIn('continue-on-error', content)

    def test_private_killboard_and_shared_data_have_explicit_gates(self):
        workflow = (Path(__file__).resolve().parents[3] / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        for gate in ('Killboard.tests.test_worker', 'Killboard.tests.test_collector_transport',
                     'Killboard.tests.test_freshness', 'Killboard.tests.test_serializers',
                     'GameData.tests', 'makemigrations Killboard',
                     'scripts/killboard/tests', 'scripts/game_data/client_assets/tests'):
            self.assertIn(gate, workflow)

    def test_ci_packages_only_after_all_jobs_and_reuses_one_plan_and_build(self):
        content = workflow('ci.yml')
        validate = job(content, 'validate')
        package = job(content, 'package')
        self.assertIn('needs: [validate, market_mysql]', package)
        self.assertNotIn('always()', package)
        self.assertEqual(content.count('python scripts/deploy/source_plan.py --output release-plan.json'), 1)
        self.assertGreater(validate.index('Plan publishable source changes'), validate.index('tests/tactical-e2e/playwright.config.js'))
        self.assertIn('action: ${{ steps.plan.outputs.action }}', validate)
        self.assertIn('EVEM_EXPECTED_ACTION: ${{ needs.validate.outputs.action }}', package)
        self.assertNotIn('npm run build', package)
        self.assertNotIn('pack.py', validate)
        for name in ('verified-release-plan', 'verified-frontend', 'release-plan', 'release'):
            self.assertIn('name: ' + name + '-${{ github.sha }}-${{ github.run_attempt }}', content)
        for name in ('Keep verified frontend build for packaging', 'Download verified frontend build',
                     'Package verified commit', 'Keep publishable release'):
            self.assertIn("if: steps.plan.outputs.action == 'release'", step(content, name))
        self.assertNotIn('if:', step(content, 'Keep publishable release plan'))
        self.assertIn('release.tar.gz\n            release-manifest.json', step(content, 'Keep publishable release'))

    def test_production_reuses_the_exact_ci_attempt_and_keeps_manual_fallback(self):
        content = workflow('deploy.yml')
        trigger = content.split('permissions:', 1)[0]
        self.assertIn('workflow_run:', trigger)
        self.assertIn('workflows: [CI]', trigger)
        self.assertIn('types: [completed]', trigger)
        self.assertIn('branches: [master]', trigger)
        self.assertNotRegex(trigger, r'(?m)^  push:')
        verify = job(content, 'verify')
        self.assertIn("github.event_name == 'workflow_dispatch'", verify)
        self.assertIn("inputs.action == 'publish'", verify)
        self.assertIn('uses: ./.github/workflows/ci.yml', verify)
        self.assertNotIn('checkout', job(content, 'authorize'))
        self.assertNotIn('EVEM_SSH_KEY', job(content, 'authorize'))
        publish = job(content, 'publish')
        self.assertIn('needs: [authorize, verify]', publish)
        self.assertIn('always() && !cancelled()', publish)
        self.assertIn("needs.authorize.result == 'success'", publish)
        self.assertIn("needs.verify.result == 'success'", publish)
        self.assertIn('EVEM_RELEASE_SHA: ${{ needs.authorize.outputs.sha || github.sha }}', publish)
        self.assertIn('EVEM_CI_RUN_ID: ${{ needs.authorize.outputs.run_id || github.run_id }}', publish)
        self.assertIn('EVEM_CI_RUN_ATTEMPT: ${{ needs.authorize.outputs.run_attempt || github.run_attempt }}', publish)
        self.assertIn('ref: ${{ env.EVEM_RELEASE_SHA }}', publish)
        self.assertIn('persist-credentials: false', publish)
        for name in ('Download verified release plan', 'Download verified product'):
            download = step(content, name)
            self.assertIn('run-id: ${{ env.EVEM_CI_RUN_ID }}', download)
            self.assertIn('github-token: ${{ github.token }}', download)
            self.assertIn('repository: ${{ github.repository }}', download)
            self.assertIn('${{ env.EVEM_RELEASE_SHA }}-${{ env.EVEM_CI_RUN_ATTEMPT }}', download)
            self.assertIn('path: ${{ runner.temp }}/evem-release/', download)
        self.assertIn("if: steps.plan.outputs.action == 'release'", step(content, 'Download verified product'))
        self.assertLess(publish.index('Validate release plan before downloading product'), publish.index('Download verified product'))
        self.assertLess(publish.index('Recheck current master after approval'), publish.index('Upload verified artifact and publish'))
        self.assertIn('environment: production', publish)
        self.assertIn('group: evem-production', content)
        self.assertIn('cancel-in-progress: false', content)
        rollback = job(content, 'rollback')
        self.assertNotIn('needs:', rollback)
        self.assertIn("inputs.action == 'rollback'", rollback)
        self.assertIn('environment: production', rollback)
        self.assertIn('bash scripts/deploy/transport.sh rollback', rollback)
        for name in ('authorize', 'publish'):
            self.assertIn('actions: read', job(content, name))
            self.assertNotRegex(job(content, name), r'(?m)^      [a-z-]+: write\s*$')
        self.assertNotIn('actions:', content.split('jobs:', 1)[0])


class ProductionAuthorizationTests(unittest.TestCase):
    def run_gate(self, event=None, run=None, definition=None, jobs=None, master=None, pages=None):
        defaults = ci_case()
        event, run, definition, jobs, master = [
            default if override is None else override
            for default, override in zip(defaults, (event, run, definition, jobs, master))
        ]
        responses = {
            '/actions/workflows/ci.yml': definition,
            '/actions/runs/23': run,
            '/git/ref/heads/master': master,
        }
        pages = [jobs] if pages is None else pages
        for page, batch in enumerate(pages, start=1):
            responses[f'/actions/runs/23/attempts/2/jobs?per_page=100&page={page}'] = {
                'total_count': len(jobs), 'jobs': batch,
            }
        requests = []
        def read(request, timeout):
            self.assertEqual(timeout, 30)
            self.assertEqual(request.get_header('Authorization'), 'Bearer read-only-token')
            prefix = 'https://api.github.test/repos/owner/repo'
            self.assertTrue(request.full_url.startswith(prefix))
            path = request.full_url[len(prefix):]
            requests.append(path)
            return io.BytesIO(json.dumps(responses[path]).encode('utf-8'))
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            event_path = directory / 'event.json'
            event_path.write_text(json.dumps(event), encoding='utf-8')
            output_path = directory / 'output.txt'
            env = {
                'GITHUB_EVENT_NAME': 'workflow_run', 'GITHUB_REPOSITORY': 'owner/repo',
                'GITHUB_API_URL': 'https://api.github.test', 'GITHUB_EVENT_PATH': str(event_path),
                'GITHUB_OUTPUT': str(output_path), 'EVEM_REPOSITORY_ID': '41',
                'EVEM_GH_TOKEN': 'read-only-token',
            }
            script = inline_python(workflow('deploy.yml'), 'Validate completed CI run and current master')
            with mock.patch.dict(os.environ, env, clear=True), mock.patch('urllib.request.urlopen', side_effect=read):
                exec(compile(script, 'production-ci-authorization', 'exec'), {})
            return output_path.read_text(encoding='utf-8'), requests

    def test_accepts_exact_successful_push_ci_and_paginates_all_jobs(self):
        event, run, definition, jobs, master = ci_case()
        output, requests = self.run_gate(pages=[jobs[:2], jobs[2:]])
        self.assertEqual(output, f'sha={SHA}\nrun_id=23\nrun_attempt=2\n')
        self.assertIn('/actions/runs/23/attempts/2/jobs?per_page=100&page=2', requests)
        self.assertEqual(requests[-1], '/git/ref/heads/master')

    def test_accepts_only_exact_ci_path_and_documented_master_suffixes(self):
        for path in ('.github/workflows/ci.yml', '.github/workflows/ci.yml@master',
                     '.github/workflows/ci.yml@refs/heads/master'):
            with self.subTest(path=path):
                event, run, _, _, _ = ci_case()
                event['workflow_run']['path'] = run['path'] = path
                self.run_gate(event=event, run=run)

    def test_rejects_untrusted_or_unsuccessful_event_metadata(self):
        for field, value in (
            ('event', 'pull_request'), ('head_branch', 'other'),
            ('conclusion', 'failure'), ('status', 'in_progress'),
            ('name', 'Another CI'), ('path', '.github/workflows/other.yml'),
            ('path', '.github/workflows/ci.yml@feature'),
            ('id', '23'), ('id', True), ('id', -1), ('run_attempt', 0),
            ('workflow_id', None), ('head_sha', 'b' * 39),
        ):
            with self.subTest(field=field, value=value):
                event, _, _, _, _ = ci_case()
                event['workflow_run'][field] = value
                with self.assertRaises(SystemExit):
                    self.run_gate(event=event)
        event, _, _, _, _ = ci_case()
        event['action'] = 'requested'
        with self.assertRaises(SystemExit):
            self.run_gate(event=event)

    def test_rejects_wrong_repository_and_forks_in_event_and_run(self):
        for scope in ('event', 'repository', 'head_repository'):
            for field, value in (('full_name', 'attacker/repo'), ('id', 99), ('fork', True), ('fork', None)):
                with self.subTest(scope=scope, field=field):
                    event, _, _, _, _ = ci_case()
                    target = event['repository'] if scope == 'event' else event['workflow_run'][scope]
                    target[field] = value
                    with self.assertRaises(SystemExit):
                        self.run_gate(event=event)

    def test_rejects_rest_run_mismatch_and_newer_attempt(self):
        for field, value in (
            ('id', 24), ('head_sha', 'b' * 40), ('run_attempt', 3),
            ('workflow_id', 99), ('event', 'pull_request'),
            ('head_branch', 'other'), ('path', '.github/workflows/deploy.yml'),
            ('status', 'in_progress'), ('conclusion', 'failure'),
        ):
            with self.subTest(field=field):
                _, run, _, _, _ = ci_case()
                run[field] = value
                with self.assertRaises(SystemExit):
                    self.run_gate(run=run)
        for scope in ('repository', 'head_repository'):
            with self.subTest(scope=scope):
                _, run, _, _, _ = ci_case()
                run[scope]['fork'] = True
                with self.assertRaises(SystemExit):
                    self.run_gate(run=run)

    def test_rejects_same_name_workflow_with_wrong_identity(self):
        for field, value in (('id', 99), ('path', '.github/workflows/other.yml'),
                             ('name', 'Other'), ('state', 'disabled_manually')):
            with self.subTest(field=field):
                _, _, definition, _, _ = ci_case()
                definition[field] = value
                with self.assertRaises(SystemExit):
                    self.run_gate(definition=definition)

    def test_rejects_missing_failed_skipped_or_incomplete_required_jobs(self):
        for missing in range(3):
            with self.subTest(missing=missing):
                _, _, _, jobs, _ = ci_case()
                del jobs[missing]
                with self.assertRaises(SystemExit):
                    self.run_gate(jobs=jobs)
        for index in range(3):
            for field, value in (('conclusion', 'failure'), ('conclusion', 'skipped'),
                                 ('conclusion', 'cancelled'), ('status', 'in_progress'),
                                 ('head_sha', 'b' * 40), ('run_id', 24)):
                with self.subTest(index=index, field=field, value=value):
                    _, _, _, jobs, _ = ci_case()
                    jobs[index][field] = value
                    with self.assertRaises(SystemExit):
                        self.run_gate(jobs=jobs)

    def test_rejects_additional_failed_job_on_a_later_page(self):
        _, _, _, jobs, _ = ci_case()
        extra = dict(jobs[-1], id=4, name='additional_gate', conclusion='failure')
        jobs.append(extra)
        with self.assertRaisesRegex(SystemExit, 'every CI job'):
            self.run_gate(jobs=jobs, pages=[jobs[:3], jobs[3:]])

    def test_rejects_duplicate_jobs_and_empty_pagination(self):
        _, _, _, jobs, _ = ci_case()
        jobs[-1]['id'] = jobs[0]['id']
        with self.assertRaisesRegex(SystemExit, 'duplicate'):
            self.run_gate(jobs=jobs)
        _, _, _, jobs, _ = ci_case()
        with self.assertRaisesRegex(SystemExit, 'incomplete'):
            self.run_gate(jobs=jobs, pages=[jobs[:2], []])

    def test_rejects_stale_master_or_wrong_ref_type(self):
        for field, value in (('sha', 'b' * 40), ('type', 'tag')):
            with self.subTest(field=field):
                _, _, _, _, master = ci_case()
                master['object'][field] = value
                with self.assertRaisesRegex(SystemExit, 'stale'):
                    self.run_gate(master=master)

    def run_recheck(self, run=None, master=None, event_name='workflow_run'):
        _, default_run, _, _, default_master = ci_case()
        responses = {
            'https://api.github.test/repos/owner/repo/actions/runs/23': default_run if run is None else run,
            'https://api.github.test/repos/owner/repo/git/ref/heads/master': default_master if master is None else master,
        }
        env = {
            'GITHUB_EVENT_NAME': event_name, 'GITHUB_REPOSITORY': 'owner/repo',
            'GITHUB_API_URL': 'https://api.github.test', 'EVEM_GH_TOKEN': 'read-only-token',
            'EVEM_RELEASE_SHA': SHA, 'EVEM_CI_RUN_ID': '23', 'EVEM_CI_RUN_ATTEMPT': '2',
        }
        def read(request, timeout):
            return io.BytesIO(json.dumps(responses[request.full_url]).encode('utf-8'))
        script = inline_python(workflow('deploy.yml'), 'Recheck current master after approval and artifact download')
        with mock.patch.dict(os.environ, env, clear=True), mock.patch('urllib.request.urlopen', side_effect=read):
            exec(compile(script, 'production-final-authorization', 'exec'), {})

    def test_after_approval_recheck_accepts_auto_and_manual_current_master(self):
        self.run_recheck()
        self.run_recheck(event_name='workflow_dispatch')

    def test_after_approval_recheck_rejects_new_master_for_auto_and_manual(self):
        for event_name in ('workflow_run', 'workflow_dispatch'):
            with self.subTest(event_name=event_name):
                _, _, _, _, master = ci_case()
                master['object']['sha'] = 'b' * 40
                with self.assertRaisesRegex(SystemExit, 'stale release'):
                    self.run_recheck(master=master, event_name=event_name)

    def test_after_approval_recheck_rejects_changed_ci_attempt_or_result(self):
        for field, value in (('run_attempt', 3), ('conclusion', 'failure'),
                             ('status', 'in_progress'), ('head_sha', 'b' * 40)):
            with self.subTest(field=field):
                _, run, _, _, _ = ci_case()
                run[field] = value
                with self.assertRaisesRegex(SystemExit, 'CI run has changed'):
                    self.run_recheck(run=run)


class ReleasePlanGateTests(unittest.TestCase):
    PLAN_STEPS = (
        ('ci.yml', 'Plan publishable source changes'),
        ('ci.yml', 'Validate verified plan'),
        ('deploy.yml', 'Validate release plan before downloading product'),
    )

    def run_plan(self, filename, name, raw=None, expected_action='release', extra_file=False):
        if raw is None:
            raw = json.dumps(plan_case())
        script = inline_python(workflow(filename), name)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            artifact = directory / 'artifact'
            artifact.mkdir()
            path = artifact / 'release-plan.json'
            path.write_text(raw, encoding='utf-8')
            if extra_file:
                (artifact / 'injected.sh').write_text('untrusted', encoding='utf-8')
            output = directory / 'output.txt'
            working = directory / 'workspace'
            working.mkdir()
            env = {'EVEM_RELEASE_SHA': SHA, 'EVEM_PLAN_PATH': str(path),
                   'EVEM_EXPECTED_ACTION': expected_action, 'GITHUB_OUTPUT': str(output)}
            previous = Path.cwd()
            try:
                os.chdir(working)
                with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(sys, 'path', [str(ROOT / 'scripts/deploy'), *sys.path]):
                    exec(compile(script, 'release-plan-authorization', 'exec'), {})
                staged = Path('release-plan.json')
                return output.read_text(encoding='utf-8'), staged.read_text(encoding='utf-8') if staged.exists() else None
            finally:
                os.chdir(previous)

    def test_release_and_noop_plans_emit_only_validated_action(self):
        for filename, name in self.PLAN_STEPS:
            for action in ('release', 'noop'):
                with self.subTest(filename=filename, name=name, action=action):
                    raw = json.dumps(plan_case(action))
                    output, staged = self.run_plan(filename, name, raw, expected_action=action)
                    self.assertEqual(output, f'action={action}\n')
                    if filename == 'deploy.yml':
                        self.assertEqual(staged, raw)

    def test_all_plan_gates_reject_wrong_sha_schema_action_or_baseline(self):
        cases = [
            {'format': 2}, {'format': True}, {'action': 'publish'},
            {'sha': 'b' * 40}, {'baseline': 'master'}, {'baseline': 1},
            {'baseline': int('1' * 40)},
            {'baseline': {'frontend': 'b' * 40}},
            {'baseline': {'frontend': 'b' * 40, 'backend': 'invalid'}},
            {'inputs': {}}, {'inputs': None},
            {'inputs': {'frontend': {'head': 'invalid', 'baseline': None},
                        'backend': {'head': 'e' * 64, 'baseline': None}}},
            {'policy': '0' * 64},
        ]
        for filename, name in self.PLAN_STEPS:
            for changes in cases:
                with self.subTest(filename=filename, name=name, changes=changes):
                    plan = plan_case()
                    plan.update(changes)
                    with self.assertRaises((SystemExit, RuntimeError)):
                        self.run_plan(filename, name, json.dumps(plan))
            with self.subTest(filename=filename, name=name, missing_baseline=True):
                with self.assertRaises(SystemExit):
                    self.run_plan(filename, name, json.dumps({'format': 1, 'action': 'release', 'sha': SHA}))

    def test_duplicate_plan_keys_are_rejected(self):
        raw = '{"action":"noop",' + json.dumps(plan_case())[1:]
        for filename, name in self.PLAN_STEPS:
            with self.subTest(filename=filename, name=name):
                with self.assertRaisesRegex(SystemExit, 'duplicate'):
                    self.run_plan(filename, name, raw)

    def test_package_rejects_plan_that_differs_from_verified_action(self):
        with self.assertRaisesRegex(SystemExit, 'verification output'):
            self.run_plan('ci.yml', 'Validate verified plan', expected_action='noop')

    def test_release_with_unavailable_baseline_is_accepted_but_noop_is_not(self):
        for filename, name in self.PLAN_STEPS:
            with self.subTest(filename=filename, name=name):
                plan = plan_case()
                plan['baseline'] = {}
                for evidence in plan['inputs'].values():
                    evidence['baseline'] = None
                output, _ = self.run_plan(filename, name, json.dumps(plan))
                self.assertEqual(output, 'action=release\n')
                plan['action'] = 'noop'
                with self.assertRaises((SystemExit, RuntimeError)):
                    self.run_plan(filename, name, json.dumps(plan), expected_action='noop')

    def test_noop_requires_matching_both_component_fingerprints(self):
        for filename, name in self.PLAN_STEPS:
            for component in ('frontend', 'backend'):
                with self.subTest(filename=filename, name=name, component=component):
                    plan = plan_case('noop')
                    plan['inputs'][component]['baseline'] = 'f' * 64
                    with self.assertRaises((SystemExit, RuntimeError)):
                        self.run_plan(filename, name, json.dumps(plan), expected_action='noop')

    def test_production_rejects_artifact_that_could_replace_an_executable(self):
        with self.assertRaisesRegex(SystemExit, 'artifact files'):
            self.run_plan('deploy.yml', 'Validate release plan before downloading product', extra_file=True)

    def test_all_embedded_python_steps_compile_on_local_python(self):
        for filename in ('ci.yml', 'deploy.yml'):
            content = workflow(filename)
            for index, match in enumerate(re.finditer(r"(?ms)^          python - <<'PY'\n(.*?)^          PY$", content)):
                with self.subTest(filename=filename, index=index):
                    compile(textwrap.dedent(match.group(1)), filename, 'exec')
