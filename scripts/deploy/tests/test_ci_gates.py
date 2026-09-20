"""Small contract checks for gates that cannot be run as GitHub Actions locally."""
from pathlib import Path
import unittest


class CIGatesTests(unittest.TestCase):
    def test_ci_keeps_all_required_safety_and_ui_gates(self):
        workflow = (Path(__file__).resolve().parents[3] / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        for command in ('python -m unittest discover -s scripts/deploy/tests -v',
                        'python -m unittest discover -s scripts/community/tests -v',
                        'node --test tests/unit/*.test.mjs tests/preview/*.test.mjs',
                        'npx playwright test --config tests/preview-e2e/playwright.config.js',
                        'npm run test:e2e', 'npm run build'):
            with self.subTest(command=command):
                self.assertIn(command, workflow)
        self.assertNotIn('continue-on-error', workflow)
        self.assertIn('front-codex/output/preview-sandbox-tests', workflow)
        self.assertIn('ci-evidence', workflow)
        self.assertIn('if: failure()', workflow)
        self.assertIn('branches: [codex/automated-deployment]', workflow)
        self.assertIn('branches: [master]', workflow)
        self.assertIn('workflow_call:', workflow)
