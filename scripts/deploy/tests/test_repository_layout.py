"""Repository layout contracts for the production build and deployment path."""
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]


class RepositoryLayoutTests(unittest.TestCase):
    def test_only_the_active_frontend_is_kept_in_the_repository(self):
        self.assertTrue((REPO_ROOT / 'front-codex').is_dir())
        self.assertFalse((REPO_ROOT / 'frontend').exists())
        self.assertFalse((REPO_ROOT / 'frontend-v2').exists())

    def test_documentation_points_to_the_active_frontend(self):
        readme = (REPO_ROOT / 'README.md').read_text(encoding='utf-8')
        self.assertIn('front-codex/', readme)
        self.assertNotIn('./frontend/README.md', readme)


if __name__ == '__main__':
    unittest.main()
