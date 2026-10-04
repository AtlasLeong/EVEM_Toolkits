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

    def run_patch(self, memberships, original_group=99, target_group=3, **extra):
        record = SimpleNamespace(
            id=379, fraud_account='account', account_type='character', remark='old',
            fraud_type='fraud', source_group_id=original_group,
            source_group_name='original', icon='original.png', save=Mock(),
        )
        with patch('FraudList.views.FraudList.objects.get', return_value=record), \
                patch('FraudList.views.FraudAuthUserGroup.objects.filter') as groups, \
                patch('FraudList.views.FraudAuthGroup.objects.get') as target, \
                patch('FraudList.views.FraudBehaviorFlow') as flow:
            groups.return_value.values_list.return_value = memberships
            target.return_value = SimpleNamespace(group_name='target', icon='target.png')
            request = self.factory.patch('/api/fraudadminlist', {'fraudRecord': {
                'fraud_id': 379, 'source_group_id': target_group, 'remark': 'updated', **extra,
            }}, format='json')
            force_authenticate(request, user=self.user)
            response = AdminFraudList.as_view()(request)
            return response, record, target, flow

    def test_patch_cannot_disguise_another_groups_record_as_own_group(self):
        response, record, target, flow = self.run_patch([3])
        self.assertEqual(response.status_code, 403)
        self.assertEqual(record.source_group_id, 99)
        record.save.assert_not_called()
        target.assert_not_called()
        flow.assert_not_called()

    def test_patch_requires_permission_for_target_group_too(self):
        response, record, target, flow = self.run_patch([99])
        self.assertEqual(response.status_code, 403)
        record.save.assert_not_called()
        target.assert_not_called()
        flow.assert_not_called()

    def test_patch_requires_group_membership(self):
        response, record, target, flow = self.run_patch([])
        self.assertEqual(response.status_code, 403)
        record.save.assert_not_called()
        flow.assert_not_called()

    def test_patch_only_updates_editable_fields_and_derived_group_metadata(self):
        response, record, target, flow = self.run_patch(
            [99, 3], id=42, pk=42, save='replace-method', source_group_name='forged', icon='forged.svg',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(record.id, 379)
        self.assertFalse(hasattr(record, 'pk'))
        self.assertEqual(record.remark, 'updated')
        self.assertEqual(record.source_group_id, 3)
        self.assertEqual(record.source_group_name, 'target')
        self.assertEqual(record.icon, 'target.png')
        record.save.assert_called_once()
        self.assertEqual(flow.call_count, 2)

    def test_patch_rejects_non_object_payload(self):
        request = self.factory.patch('/api/fraudadminlist', {'fraudRecord': ['invalid']}, format='json')
        force_authenticate(request, user=self.user)
        response = AdminFraudList.as_view()(request)
        self.assertEqual(response.status_code, 400)
