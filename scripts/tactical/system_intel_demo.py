"""Add a few clearly fictional system snapshots to the existing local real-map demo.

Repeat runs preserve user edits and observation times. No network access.
"""
import os
import sys
from uuid import uuid4, uuid5, NAMESPACE_URL

from real_universe import BACKEND, DEMO_ORGANIZATION_REQUEST, require_local_environment


def main():
    local_settings = 'EVE_MDjango.tactical_local_settings'
    if os.environ.get('DJANGO_SETTINGS_MODULE', local_settings) != local_settings:
        raise ValueError('Production or unknown settings are forbidden')
    os.environ['DJANGO_SETTINGS_MODULE'] = local_settings
    sys.path.insert(0, str(BACKEND))
    import django
    django.setup()
    require_local_environment()
    from django.core.management import call_command
    from django.contrib.auth import get_user_model
    from django.utils import timezone
    from TacticalBoard.models import BoardSystems
    from TacticalCollaboration.models import CommandReceipt, Organization
    from TacticalCollaboration import services
    call_command('migrate', interactive=False, verbosity=0)
    owner = get_user_model().objects.get(username='tactical_demo_founder', is_active=True)
    receipt = CommandReceipt.objects.get(actor=owner, scope='create', request_id=DEMO_ORGANIZATION_REQUEST)
    organization = Organization.objects.get(pk=receipt.result['id'], founder=owner)
    scout = get_user_model().objects.get(username='tactical_demo_scout', is_active=True)
    connection_id = str(uuid4())
    services.admit(scout, organization.pk, connection_id)
    try:
        names = [('萨斯塔', 68), ('玛斯帕', 24), ('莎拉', 12), ('埃克葡温姆', 0)]
        for name, people in names:
            node = BoardSystems.objects.filter(zh_name=name, constellation__region_id=10000001).first()
            if node is None:
                raise ValueError(f'Missing real Derelik system: {name}')
            request_id = uuid5(NAMESPACE_URL, f'local-system-intel-v1:{organization.pk}:{node.pk}')
            if CommandReceipt.objects.filter(actor=scout, scope=f'org:{organization.pk}', request_id=request_id).exists():
                continue
            services.command(scout, organization.pk, {
                'action': 'report.create', 'request_id': str(request_id), 'connection_id': connection_id,
                'report_kind': 'system_count', 'system_id': node.pk, 'people': people, 'ships': {},
                'notes': '本地演示人数，不代表真实军情。', 'observed_at': timezone.now().isoformat(),
            })
            print(f'Added local demo snapshot: {name}, enemy {people}')
        print(f'Local demo ready: organization {organization.pk}; existing snapshots retained')
    finally:
        services.leave(scout, organization.pk, connection_id)


if __name__ == '__main__':
    main()
