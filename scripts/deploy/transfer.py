"""Validate trusted CI evidence and prepare only the remotely planned components."""
import argparse
import json
from pathlib import Path

from pack import delta
from release import COMPONENTS, HASH, SHA, ReleaseError, validate, validate_manifest
from source_plan import policy_digest


def inspect_source(plan, expected_sha):
    if (not isinstance(plan, dict) or type(plan.get('format')) is not int or plan.get('format') != 1
            or not isinstance(expected_sha, str) or not SHA.fullmatch(expected_sha)
            or plan.get('sha') != expected_sha or plan.get('action') not in ('noop', 'release')
            or plan.get('policy') != policy_digest()):
        raise ReleaseError('invalid CI source plan')
    if plan['action'] == 'noop':
        baseline, inputs = plan.get('baseline'), plan.get('inputs')
        if (not isinstance(baseline, dict) or set(baseline) != set(COMPONENTS)
                or not isinstance(inputs, dict) or set(inputs) != set(COMPONENTS)):
            raise ReleaseError('missing no-op evidence')
        for component in COMPONENTS:
            evidence = inputs[component]
            if (not isinstance(baseline[component], str) or not SHA.fullmatch(baseline[component])
                    or not isinstance(evidence, dict) or not isinstance(evidence.get('head'), str)
                    or not HASH.fullmatch(evidence['head']) or evidence.get('baseline') != evidence['head']):
                raise ReleaseError('invalid no-op evidence')
    return plan['action']


def inspect_remote(plan, expected_sha):
    if (not isinstance(plan, dict) or type(plan.get('format')) is not int
            or plan.get('format') != 1 or plan.get('sha') != expected_sha
            or plan.get('policy') != policy_digest() or not isinstance(plan.get('base'), str)
            or not HASH.fullmatch(plan['base']) or not isinstance(plan.get('components'), list)
            or plan['components'] != [c for c in COMPONENTS if c in plan['components']]
            or not isinstance(plan.get('reuse', {}), dict)):
        raise ReleaseError('invalid remote release plan')
    return plan['components']


def prepare(archive, manifest_file, remote_plan, output, expected_sha):
    manifest = validate_manifest(json.loads(Path(manifest_file).read_text(encoding='utf-8')))
    if manifest['format'] != 1 or manifest['sha'] != expected_sha or manifest.get('policy') != policy_digest():
        raise ReleaseError('release manifest identity mismatch')
    components = inspect_remote(remote_plan, expected_sha)
    if validate(archive) != manifest:
        raise ReleaseError('CI artifact differs from planning manifest')
    if components:
        delta(archive, remote_plan, output)
    return components


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('inspect-source', 'inspect-remote', 'prepare'))
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--plan', type=Path, default=Path('release-plan.json'))
    parser.add_argument('--archive', type=Path, default=Path('release.tar.gz'))
    parser.add_argument('--manifest', type=Path, default=Path('release-manifest.json'))
    parser.add_argument('--output', type=Path, default=Path('release-upload.tar.gz'))
    args = parser.parse_args()
    if args.plan.stat().st_size > 4 * 1024 ** 2:
        raise ReleaseError('oversized transfer plan')
    plan = json.loads(args.plan.read_text(encoding='utf-8'))
    if args.action == 'inspect-source':
        print(inspect_source(plan, args.expected_sha))
    elif args.action == 'inspect-remote':
        print('upload' if inspect_remote(plan, args.expected_sha) else 'noop')
    else:
        components = prepare(args.archive, args.manifest, plan, args.output, args.expected_sha)
        print('upload' if components else 'noop')


if __name__ == '__main__':
    main()
