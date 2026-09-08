from datetime import timedelta
from uuid import uuid4
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db import connections, router
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


class FeedbackTestBase(TestCase):
    databases = {'default', 'license'}
    url = '/api/feedback/'

    def setUp(self):
        self.owner = get_user_model().objects.create_user(username='owner')
        self.other = get_user_model().objects.create_user(username='other')
        self.staff = get_user_model().objects.create_user(username='manager', is_staff=True)
        self.client = APIClient()
        self.login(self.owner)

    def login(self, user):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user).access_token}')

    def payload(self, **changes):
        return dict(request_id=str(uuid4()), type='feature', module='planetary',
                    title='增加资源筛选', description='希望增加资源筛选功能', contact='', **changes)

    def create(self, **changes):
        data = self.payload()
        data.update(changes)
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def detail_url(self, ticket):
        return f'{self.url}{ticket["id"]}/'

    def comment(self, ticket, **changes):
        data = {'request_id': str(uuid4()), 'body': '补充说明'}
        data.update(changes)
        return self.client.post(self.detail_url(ticket) + 'comments/', data, format='json')


class FeedbackTests(FeedbackTestBase):
    def test_create_list_and_detail(self):
        ticket = self.create()
        self.assertEqual(ticket['status'], 'pending')
        self.assertEqual(ticket['author_name'], 'owner')
        self.assertEqual(ticket['comments'], [])
        listing = self.client.get(self.url).json()
        self.assertEqual(listing['count'], 1)
        self.assertFalse(listing['can_manage'])
        self.assertEqual(listing['results'][0]['reply_count'], 0)
        self.assertEqual(self.client.get(self.detail_url(ticket)).json(), ticket)

    def test_guest_cannot_access_any_endpoint(self):
        ticket = self.create()
        self.client.credentials()
        for method, url, data in [('get', self.url, {}), ('post', self.url, self.payload()),
                                  ('get', self.detail_url(ticket), {}),
                                  ('patch', self.detail_url(ticket), {'status': 'completed'}),
                                  ('post', self.detail_url(ticket) + 'comments/', {'body': 'test'})]:
            with self.subTest(method=method, url=url):
                self.assertEqual(getattr(self.client, method)(url, data, format='json').status_code, 401)

    def test_other_user_cannot_read_or_comment_or_change_ticket(self):
        ticket = self.create()
        self.login(self.other)
        self.assertEqual(self.client.get(self.url).json()['count'], 0)
        self.assertEqual(self.client.get(self.detail_url(ticket)).status_code, 404)
        self.assertEqual(self.comment(ticket).status_code, 404)
        self.assertEqual(self.client.patch(self.detail_url(ticket), {'status': 'completed'}, format='json').status_code, 404)

    def test_owner_cannot_manage(self):
        ticket = self.create()
        self.assertEqual(self.client.get(self.url, {'scope': 'all'}).status_code, 403)
        self.assertEqual(self.client.patch(self.detail_url(ticket), {'status': 'completed'}, format='json').status_code, 403)

    def test_staff_can_read_reply_and_change_status(self):
        ticket = self.create()
        self.login(self.staff)
        self.assertEqual(self.client.get(self.url).json()['count'], 0)
        listing = self.client.get(self.url, {'scope': 'all'}).json()
        self.assertTrue(listing['can_manage'])
        self.assertEqual(listing['count'], 1)
        for status in ('processing', 'completed', 'declined', 'pending'):
            self.assertEqual(self.client.patch(self.detail_url(ticket), {'status': status}, format='json').json()['status'], status)
        response = self.comment(ticket)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['comments'][0]['is_staff'])
        self.login(self.owner)
        detail = self.client.get(self.detail_url(ticket)).json()
        self.assertEqual(detail['reply_count'], 1)
        self.assertEqual(detail['comments'][0]['author_name'], 'manager')

    def test_owner_can_supplement(self):
        ticket = self.create()
        response = self.comment(ticket)
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()['comments'][0]['is_staff'])

    def test_filters(self):
        self.create()
        ticket = self.create(type='bug', module='account')
        self.login(self.staff)
        self.client.patch(self.detail_url(ticket), {'status': 'processing'}, format='json')
        for field, value in [('type', 'bug'), ('module', 'account'), ('status', 'processing')]:
            result = self.client.get(self.url, {'scope': 'all', field: value}).json()
            self.assertEqual(result['count'], 1)
            self.assertEqual(result['results'][0]['id'], ticket['id'])
        self.assertEqual(self.client.get(self.url, {'scope': 'all', 'type': 'feature', 'module': 'account'}).json()['count'], 0)

    def test_pagination(self):
        for i in range(20):
            self.create(title=f'反馈 {i}')
        self.login(self.other)
        self.create()
        self.login(self.staff)
        page1 = self.client.get(self.url, {'scope': 'all'}).json()
        page2 = self.client.get(self.url, {'scope': 'all', 'page': 2}).json()
        self.assertEqual(page1['count'], 21)
        self.assertEqual(len(page1['results']), 20)
        self.assertEqual(len(page2['results']), 1)
        self.assertNotIn(page2['results'][0]['id'], [row['id'] for row in page1['results']])

    def test_invalid_filters(self):
        for query in ({'scope': 'public'}, {'type': 'other'}, {'status': 'bad'}, {'module': 'bad'}, {'page': 0}, {'page': 'bad'}):
            with self.subTest(query=query):
                self.assertEqual(self.client.get(self.url, query).status_code, 400)

    def test_invalid_ticket_fields(self):
        for field, values in {'request_id': ['', 'invalid', None], 'type': ['bad', '', None, 1],
                              'module': ['bad', '', None], 'title': ['', '  ', 'x' * 121, 123, None],
                              'description': ['', '  ', 'x' * 5001, [], None],
                              'contact': ['x' * 201, 123, None]}.items():
            for value in values:
                with self.subTest(field=field, value=str(value)[:20]):
                    data = self.payload()
                    data[field] = value
                    self.assertEqual(self.client.post(self.url, data, format='json').status_code, 400)

    def test_missing_fields_and_non_object_rejected(self):
        for field in ('request_id', 'type', 'module', 'title', 'description'):
            data = self.payload()
            del data[field]
            self.assertEqual(self.client.post(self.url, data, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.url, [], format='json').status_code, 400)

    def test_contact_optional_and_text_retained_plain(self):
        data = self.payload()
        del data['contact']
        data['description'] = '<script>alert(1)</script>'
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['description'], data['description'])
        self.assertEqual(response.json()['contact'], '')

    def test_rejects_unrecognized_fields_and_role_grants(self):
        data = self.payload()
        data.update(status='completed', author=self.other.pk, is_staff=True)
        self.assertEqual(self.client.post(self.url, data, format='json').status_code, 400)
        ticket = self.create()
        self.login(self.staff)
        self.assertEqual(self.client.patch(self.detail_url(ticket), {'title': 'changed'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(self.detail_url(ticket), {'status': 'bad'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(self.detail_url(ticket), {}, format='json').status_code, 400)

    def test_ticket_idempotency_and_conflict(self):
        data = self.payload()
        first = self.client.post(self.url, data, format='json')
        self.assertEqual(first.status_code, 201)
        repeat = self.client.post(self.url, data, format='json')
        self.assertEqual(repeat.status_code, 200)
        self.assertEqual(repeat.json()['id'], first.json()['id'])
        data['title'] = 'different'
        self.assertEqual(self.client.post(self.url, data, format='json').status_code, 409)
        self.login(self.other)
        self.assertEqual(self.client.post(self.url, data, format='json').status_code, 201)

    def test_comment_validation(self):
        ticket = self.create()
        for changes in ({'body': ''}, {'body': '  '}, {'body': 'x' * 3001}, {'body': 123},
                        {'body': None}, {'request_id': 'bad'}, {'is_staff': True}):
            self.assertEqual(self.comment(ticket, **changes).status_code, 400)

    def test_comment_idempotency_and_cross_ticket_conflict(self):
        ticket = self.create()
        request_id = str(uuid4())
        self.assertEqual(self.comment(ticket, request_id=request_id).status_code, 201)
        self.assertEqual(self.comment(ticket, request_id=request_id).status_code, 200)
        self.assertEqual(self.comment(ticket, request_id=request_id, body='changed').status_code, 409)
        self.assertEqual(self.comment(self.create(), request_id=request_id).status_code, 409)
        self.assertEqual(self.client.get(self.detail_url(ticket)).json()['reply_count'], 1)

    def test_ticket_rate_limit_persisted_and_replay_allowed(self):
        request_id = str(uuid4())
        self.create(request_id=request_id)
        for _ in range(19):
            self.create()
        self.assertEqual(self.client.post(self.url, self.payload(), format='json').status_code, 429)
        replay = self.payload()
        replay['request_id'] = request_id
        self.assertEqual(self.client.post(self.url, replay, format='json').status_code, 200)
        model = apps.get_model('Feedback', 'FeedbackTicket')
        model.objects.update(created_at=timezone.now() - timedelta(hours=25))
        self.create()

    def test_comment_rate_limit_persisted_and_replay_allowed(self):
        ticket = self.create()
        request_id = str(uuid4())
        self.assertEqual(self.comment(ticket, request_id=request_id).status_code, 201)
        for _ in range(59):
            self.assertEqual(self.comment(ticket).status_code, 201)
        self.assertEqual(self.comment(ticket).status_code, 429)
        self.assertEqual(self.comment(ticket, request_id=request_id).status_code, 200)
        apps.get_model('Feedback', 'FeedbackComment').objects.update(created_at=timezone.now() - timedelta(hours=2))
        self.assertEqual(self.comment(ticket).status_code, 201)

    def test_ticket_comment_cap(self):
        ticket = self.create()
        model = apps.get_model('Feedback', 'FeedbackComment')
        model.objects.bulk_create([model(ticket_id=ticket['id'], author=self.other, request_id=uuid4(), body='history') for _ in range(100)])
        self.assertEqual(self.comment(ticket).status_code, 400)

    def test_no_delete_or_upload(self):
        ticket = self.create()
        self.assertEqual(self.client.delete(self.detail_url(ticket)).status_code, 405)
        self.assertEqual(self.client.post(self.url, self.payload(), format='multipart').status_code, 415)

    def test_models_migrated_only_on_default(self):
        for name in ('FeedbackTicket', 'FeedbackComment'):
            model = apps.get_model('Feedback', name)
            self.assertTrue(model._meta.managed)
            self.assertEqual(router.db_for_write(model), 'default')
            self.assertIn(model._meta.db_table, connections['default'].introspection.table_names())
            self.assertNotIn(model._meta.db_table, connections['license'].introspection.table_names())


class FeedbackAttachmentTests(FeedbackTestBase):
    # Run only attachment tests here, while reusing the API helpers and setup.
    def setUp(self):
        super().setUp()
        self.upload_directory = TemporaryDirectory()
        self.addCleanup(self.upload_directory.cleanup)
        self.settings_override = self.settings(FEEDBACK_UPLOAD_ROOT=self.upload_directory.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.ticket = self.create()

    def upload(self, name='report.txt', body=b'error details', request_id=None, ticket=None):
        return self.client.post(self.detail_url(ticket or self.ticket) + 'attachments/',
                                {'file': SimpleUploadedFile(name, body), 'request_id': request_id or str(uuid4())}, format='multipart')

    def download_url(self, attachment, ticket=None):
        return self.detail_url(ticket or self.ticket) + f'attachments/{attachment["id"]}/download/'

    def test_upload_download_plain_text_private(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.content)
        attachment = response.json()
        self.assertEqual(attachment['name'], 'report.txt')
        self.assertEqual(attachment['content_type'], 'text/plain')
        self.assertEqual(attachment['size'], 13)
        detail = self.client.get(self.detail_url(self.ticket)).json()
        self.assertEqual(detail['attachments'], [attachment])
        download = self.client.get(self.download_url(attachment))
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b''.join(download.streaming_content), b'error details')
        self.assertTrue(download['Content-Disposition'].startswith('attachment;'))
        self.assertEqual(download['X-Content-Type-Options'], 'nosniff')
        self.assertIn('no-store', download['Cache-Control'])
        self.assertNotIn('storage_name', attachment)

    def test_upload_download_ownership(self):
        attachment = self.upload().json()
        self.login(self.other)
        self.assertEqual(self.upload().status_code, 404)
        self.assertEqual(self.client.get(self.download_url(attachment)).status_code, 404)
        self.login(self.staff)
        response = self.client.get(self.download_url(attachment))
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(self.upload().status_code, 201)
        self.client.credentials()
        self.assertEqual(self.upload().status_code, 401)
        self.assertEqual(self.client.get(self.download_url(attachment)).status_code, 401)

    def test_download_cannot_mix_ticket_and_attachment(self):
        attachment = self.upload().json()
        self.assertEqual(self.client.get(self.download_url(attachment, self.create())).status_code, 404)

    def test_upload_valid_images_and_pdf(self):
        from PIL import Image
        for extension, image_format in [('png', 'PNG'), ('jpg', 'JPEG'), ('webp', 'WEBP')]:
            stream = BytesIO()
            Image.new('RGB', (2, 2)).save(stream, format=image_format)
            self.assertEqual(self.upload('image.' + extension, stream.getvalue()).status_code, 201)
        self.assertEqual(self.upload('document.pdf', b'%PDF-1.7\n%%EOF').status_code, 201)
        self.assertEqual(self.upload('debug.log', '中文日志'.encode()).status_code, 201)

    def test_upload_rejects_extension_spoof_and_bad_content(self):
        for name, body in [('bad.svg', b'<svg/>'), ('bad.html', b'<h1>hi</h1>'), ('bad.exe', b'MZ'),
                           ('bad.zip', b'PK'), ('image.png', b'not an image'), ('document.pdf', b'not pdf'),
                           ('binary.txt', b'hello\0world'), ('bad.log', b'\xff'), ('empty.txt', b'')]:
            with self.subTest(name=name):
                self.assertEqual(self.upload(name, body).status_code, 400)
        from PIL import Image
        stream = BytesIO()
        Image.new('RGB', (2, 2)).save(stream, format='PNG')
        self.assertEqual(self.upload('wrong.jpg', stream.getvalue()).status_code, 400)

    def test_upload_rejects_oversize(self):
        self.assertEqual(self.upload(body=b'a' * (10 * 1024 * 1024 + 1)).status_code, 400)

    def test_upload_rejects_excessive_image_pixels_and_animation(self):
        from PIL import Image
        stream = BytesIO()
        Image.new('RGB', (2, 2)).save(stream, format='PNG')
        with patch('Feedback.attachments.MAX_IMAGE_PIXELS', 3):
            self.assertEqual(self.upload('large.png', stream.getvalue()).status_code, 400)
        animated = BytesIO()
        Image.new('RGB', (2, 2), 'red').save(animated, format='PNG', save_all=True,
                                           append_images=[Image.new('RGB', (2, 2), 'blue')], duration=100)
        self.assertEqual(self.upload('animated.png', animated.getvalue()).status_code, 400)

    def test_download_missing_file_returns_safe_error(self):
        attachment = self.upload().json()
        for file in Path(self.upload_directory.name).iterdir():
            file.unlink()
        response = self.client.get(self.download_url(attachment))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(self.upload_directory.name, str(response.content))

    def test_upload_uses_safe_name_and_random_storage(self):
        result = self.upload('../../private\\report.txt').json()
        self.assertNotIn('/', result['name'])
        self.assertNotIn('\\', result['name'])
        stored = list(Path(self.upload_directory.name).iterdir())
        self.assertEqual(len(stored), 1)
        self.assertNotEqual(stored[0].name, result['name'])

    def test_upload_idempotency(self):
        request_id = str(uuid4())
        first = self.upload(request_id=request_id)
        self.assertEqual(first.status_code, 201)
        replay = self.upload(request_id=request_id)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()['id'], first.json()['id'])
        self.assertEqual(self.upload(body=b'changed', request_id=request_id).status_code, 409)
        self.assertEqual(self.upload(name='renamed.txt', request_id=request_id).status_code, 409)
        self.assertEqual(self.upload(request_id=request_id, ticket=self.create()).status_code, 409)
        self.assertEqual(len(list(Path(self.upload_directory.name).iterdir())), 1)

    def test_upload_cap_and_total_bytes(self):
        model = apps.get_model('Feedback', 'FeedbackAttachment')
        model.objects.bulk_create([model(ticket_id=self.ticket['id'], author=self.owner,
                                          request_id=uuid4(), name='test.txt', storage_name=str(uuid4()),
                                          size=1, content_type='text/plain', sha256='a' * 64) for _ in range(20)])
        self.assertEqual(self.upload().status_code, 400)
        model.objects.all().delete()
        model.objects.create(ticket_id=self.ticket['id'], author=self.owner, request_id=uuid4(),
                             name='test.txt', storage_name=str(uuid4()), size=50 * 1024 * 1024,
                             content_type='text/plain', sha256='a' * 64)
        self.assertEqual(self.upload().status_code, 400)

    def test_upload_rate_limit(self):
        model = apps.get_model('Feedback', 'FeedbackAttachment')
        another = self.create()
        model.objects.bulk_create([model(ticket_id=another['id'], author=self.owner,
                                          request_id=uuid4(), name='test.txt', storage_name=str(uuid4()),
                                          size=1, content_type='text/plain', sha256='a' * 64) for _ in range(60)])
        self.assertEqual(self.upload().status_code, 429)
        model.objects.update(created_at=timezone.now() - timedelta(hours=2))
        self.assertEqual(self.upload().status_code, 201)

    def test_upload_missing_fields(self):
        url = self.detail_url(self.ticket) + 'attachments/'
        for data in ({}, {'request_id': str(uuid4())}, {'file': SimpleUploadedFile('x.txt', b'hello')}):
            self.assertEqual(self.client.post(url, data, format='multipart').status_code, 400)

    def test_upload_cleans_file_when_database_fails(self):
        with patch('Feedback.models.FeedbackAttachment.save', side_effect=RuntimeError('database unavailable')):
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(list(Path(self.upload_directory.name).iterdir()), [])

    def test_upload_unconfigured_storage_is_safe(self):
        with self.settings(FEEDBACK_UPLOAD_ROOT=None):
            self.assertEqual(self.upload().status_code, 503)

    def test_attachment_migration_is_default_only(self):
        model = apps.get_model('Feedback', 'FeedbackAttachment')
        self.assertIn(model._meta.db_table, connections['default'].introspection.table_names())
        self.assertNotIn(model._meta.db_table, connections['license'].introspection.table_names())
