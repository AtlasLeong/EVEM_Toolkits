# Market QA account provisioning design

This one-shot, root-only command provisions a new account for a restore
rehearsal on the existing MySQL instance. It never writes to `eve_echoes` and
does not create the QA schema; the restore command will create that schema.
The decision to use the existing instance, rather than a separate QA server,
must be disclosed to the operator.

The command requires an explicit candidate backend, expected production
database name (`eve_echoes`), exact existing backup directory, and opt-in flag.
It loads the candidate's default database settings and connected database
identity in-process. Because the candidate currently uses a public-IP MySQL
endpoint, it opens a second connection to `127.0.0.1:3306` with the same
credentials and requires both connections to report `DATABASE()=eve_echoes`
and the same valid, nonempty `@@server_uuid`. Missing loopback access or any
identity mismatch stops before SQL mutation.

The backup directory must be a direct child of the configured backup root,
owned by root and mode 0700, with the private backup manifest/dump in place.
The command generates a fresh `evem_market_qa_` name with twelve lowercase hex
digits and a URL-safe password of at least 24 characters. It checks that no
schema or account of that name exists. It creates a new 0600 env file in that
directory with the rehearsal's enable/name/user/password keys and the expected
server UUID, then creates `'name'@'127.0.0.1'` and grants privileges only on
the exact QA schema. Underscores in the database-level grant are escaped to
avoid wildcard scope. An existing env file is never overwritten.

Credentials stay in process memory and the root-private env file; they are
never command arguments, inherited child environment, stdout, or exception
text. The command does not auto-drop an account or schema on partial failure;
the private env remains for manual reconciliation once account creation is
attempted. Tests use synthetic settings and fake database connections only.
No production connection or provisioning is exercised during development.

Operational limits: MySQL may record credential-bearing account statements in
server-side logs, outside this CLI's control; review server logging before a
live run. MySQL host-name resolution may cause a later TCP loopback login to
authenticate as `name@localhost` rather than `name@127.0.0.1`; the restore
command must reject that with its exact `CURRENT_USER()` guard. Provisioning
alone does not validate or import the dump; the separate restore preflight
does that. A failed loopback login, missing administrative grant-table access,
or any identity mismatch is a stop condition, not a reason to loosen guards.
