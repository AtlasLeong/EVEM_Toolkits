from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from FraudList.views import AdminFraudList


class AdminFraudListPatchTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.user = SimpleNamespace(id=7, is_authenticated=True)

    @patch('FraudList.views.uuid.uuid4', return_value='op-1')
    @patch('FraudList.views.FraudBehaviorFlow')
    @patch('FraudList.views.FraudAuthGroup.objects.get')
    @patch('FraudList.views.FraudAuthUserGroup.objects.filter')
    @patch('FraudList.views.FraudList.objects.get')
    def test_patch_updates_source_group_name_and_icon(
        self,
        fraud_get_mock,
        user_group_filter_mock,
        auth_group_get_mock,
        behavior_flow_mock,
        _uuid_mock,
    ):
        record = SimpleNamespace(
            id=379,
            fraud_account='test123123',
            account_type='咸鱼号',
            remark='asdasdads',
            fraud_type='诈骗',
            source_group_id=99,
            source_group_name='公共举报组',
            icon='old-icon.png',
        )
        record.save = Mock()
        fraud_get_mock.return_value = record

        user_group_filter_mock.return_value.values_list.return_value = [99, 3]
        auth_group_get_mock.return_value = SimpleNamespace(
            group_id=3,
            group_name='EVE交易群--微信-3',
            icon='new-icon.png',
        )

        behavior_entries = [Mock(), Mock()]
        behavior_flow_mock.side_effect = behavior_entries

        request = self.factory.patch(
            '/api/fraudadminlist',
            {
                'fraudRecord': {
                    'fraud_id': 379,
                    'fraud_account': 'test123123',
                    'account_type': '咸鱼号',
                    'remark': 'asdasdads',
                    'fraud_type': '诈骗',
                    'source_group_id': 3,
                }
            },
            format='json',
        )
        force_authenticate(request, user=self.user)

        response = AdminFraudList.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(record.source_group_id, 3)
        self.assertEqual(record.source_group_name, 'EVE交易群--微信-3')
        self.assertEqual(record.icon, 'new-icon.png')
        record.save.assert_called_once()

        self.assertEqual(behavior_flow_mock.call_count, 2)
        after_kwargs = behavior_flow_mock.call_args_list[1].kwargs
        self.assertEqual(after_kwargs['source_group_id'], 3)
        self.assertEqual(after_kwargs['source_group_name'], 'EVE交易群--微信-3')
        self.assertEqual(after_kwargs['icon'], 'new-icon.png')
        behavior_entries[0].save.assert_called_once()
        behavior_entries[1].save.assert_called_once()
