"""Small contract checks for gates that cannot be run as GitHub Actions locally."""
from pathlib import Path
import re
import unittest


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
