"""Runtime storage gates must match the read-only release preflight."""
import io
from pathlib import Path
import tempfile
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from .models import Corporation, MediaAsset, MediaUploadAttempt, Revision


class RuntimeStorageTests(TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='community-runtime-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.private = self.root / 'private-community'
        self.private.mkdir()
        self.override = override_settings(COMMUNITY_UPLOAD_ROOT=self.private)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.owner = get_user_model().objects.create_user('storage-owner')
        self.corporation = Corporation.objects.create(name='Storage test', name_key='storage-test', owner=self.owner)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        image = io.BytesIO()
        Image.new('RGB', (8, 8), 'blue').save(image, 'PNG')
        self.image = image.getvalue()

    def upload(self):
        return self.client.post(f'/api/community/corporations/{self.corporation.pk}/media/', {
            'request_id': str(uuid4()),
            'file': SimpleUploadedFile('test.png', self.image),
        }, format='multipart')

    def test_upload_rejects_public_and_switchable_release_directories(self):
        for name in ('public', 'dist', 'assets', 'releases/version', 'current', '.staging-version'):
            unsafe = self.root / name / 'private-community'
            unsafe.mkdir(parents=True)
            with self.subTest(name=name), override_settings(COMMUNITY_UPLOAD_ROOT=unsafe):
                response = self.upload()
                self.assertEqual(response.status_code, 503, response.content)
                self.assertIn('no-store', response['Cache-Control'])
                self.assertEqual(list(unsafe.iterdir()), [])
        self.assertFalse(MediaAsset.objects.exists())
        self.assertFalse(MediaUploadAttempt.objects.exists())

    def test_upload_rejects_project_tree(self):
        with override_settings(BASE_DIR=self.root):
            self.assertEqual(self.upload().status_code, 503)
        self.assertFalse(MediaAsset.objects.exists())

    def test_upload_rejects_missing_directory_without_creating_it(self):
        missing = self.root / 'not-provisioned'
        with override_settings(COMMUNITY_UPLOAD_ROOT=missing):
            self.assertEqual(self.upload().status_code, 503)
        self.assertFalse(missing.exists())
        self.assertFalse(MediaAsset.objects.exists())

    def test_prefixed_static_directories_do_not_break_a_safe_private_upload(self):
        static = self.root / 'static'
        static.mkdir()
        with override_settings(STATICFILES_DIRS=[('custom', static)]):
            response = self.upload()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(MediaAsset.objects.count(), 1)

    def test_prefixed_static_directory_is_rejected_when_it_contains_private_storage(self):
        with override_settings(STATICFILES_DIRS=[('custom', self.root)]):
            response = self.upload()
        self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(list(self.private.iterdir()), [])

    def test_public_and_private_reads_also_fail_closed_for_unsafe_storage(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.content)
        asset = MediaAsset.objects.get(pk=response.json()['id'])
        revision = Revision.objects.create(corporation=self.corporation, author=self.owner,
                                           status='approved', content={'logo_asset_id': asset.pk})
        self.corporation.published_revision = revision
        self.corporation.save(update_fields=['published_revision'])
        unsafe = self.root / 'public' / 'private-community'
        unsafe.mkdir(parents=True)
        (unsafe / asset.storage_name).write_bytes((self.private / asset.storage_name).read_bytes())
        paths = (
            f'/api/community/media/{asset.pk}/private/',
            f'/api/community/corporations/{self.corporation.pk}/media/{asset.pk}/',
        )
        with override_settings(COMMUNITY_UPLOAD_ROOT=unsafe):
            for path in paths:
                with self.subTest(path=path):
                    response = self.client.get(path)
                    try:
                        self.assertEqual(response.status_code, 503)
                        self.assertIn('no-store', response['Cache-Control'])
                    finally:
                        response.close()
