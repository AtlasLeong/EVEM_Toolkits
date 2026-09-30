#!/bin/sh
set -eu

# Compatibility wrapper; the real runner is inside the verified release.
exec /bin/sh /EVEMTK/deploy/current/backend/Killboard/run-collector.sh
