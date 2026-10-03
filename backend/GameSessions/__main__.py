"""Explicit offline provision/recovery of non-secret account coordination."""
import argparse
import os
import sqlite3

from .coordination import CoordinationError, Coordinator, provision


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('provision', 'resume'))
    parser.add_argument('--state-file', default=os.environ.get('GAME_SESSION_COORDINATOR_FILE'))
    parser.add_argument('--account-id')
    parser.add_argument('--confirm-authorized-session-replacement', action='store_true')
    parser.add_argument('--confirm-resolved-service-restriction', action='store_true')
    args = parser.parse_args()
    try:
        if args.action == 'provision':
            provision(args.state_file)
        else:
            if not (args.confirm_authorized_session_replacement or args.confirm_resolved_service_restriction):
                raise CoordinationError()
            Coordinator(args.state_file).resume(args.account_id,
                auth=args.confirm_authorized_session_replacement,
                service=args.confirm_resolved_service_restriction)
    except (CoordinationError, OSError, sqlite3.Error):
        print('Coordination operation refused.')
        return 1
    print('Coordination operation completed; no game connection was made.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
