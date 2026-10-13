#!/bin/sh
set -eu
exec /usr/bin/flock --nonblock /EVEMTK/deploy/shared/killboard/collector.lock \
  /EVEMTK/deploy/current/backend/.venv/bin/python \
  /EVEMTK/deploy/current/backend/manage.py anomaly_collect \
  --settings=EVE_MDjango.anomaly_worker_settings
