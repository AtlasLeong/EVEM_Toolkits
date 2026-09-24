# Market session export design

An authorized capture is imported by the original Windows collector into a
`session.dpapi` file scoped to the capture owner's Windows account. The one-shot
exporter runs locally under that same account. It accepts explicit, absolute
source and destination paths; it does not parse PCAP or contact the game.

The exporter checks a bounded, regular `EVEMDP1` input, decrypts it with Windows
DPAPI, and decodes the collector's msgpack bundle. The existing
`Market.session_bundle.encode_session` validates the complete RPC template set,
literal endpoint IP, JSON shape, and output size before any output is created.
The resulting version-1 JSON is the portable session format consumed on Linux.

The destination must be outside this repository on a volume supporting
persistent ACLs. Windows creates it once with `CREATE_NEW` and a protected DACL
granting the current user only; there is no intermediate plaintext file or
overwrite path. If writing fails, the newly created file is removed. CLI output
and errors are generic and never include bundle data, exception text, or paths.

Tests use synthetic msgpack and stub DPAPI decryption. They cover round-trip
format, malformed input, validation failure, no overwrite, cleanup, output
silence, and the ACL on a synthetic Windows file. No real capture, DPAPI file,
credentials, network, or remote host is touched during development.

After export, the operator transfers the JSON via a controlled private channel
and installs it on Linux owned by the market collector user with mode 0600 in
a private directory. This does not establish session validity or lifetime; an
expired session still requires a new authorized capture.
