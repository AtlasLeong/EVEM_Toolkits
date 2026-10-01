#!/bin/sh
set -eu
exec /usr/bin/flock --nonblock /EVEMTK/deploy/shared/killboard/collector.lock \
  /EVEMTK/deploy/current/backend/.venv/bin/python \
  /EVEMTK/deploy/current/backend/manage.py killboard_collect \
  --client Killboard.collector_transport.build_client --cursor latest --policy high_value_all \
  --max-requests 24 --rpc-interval 5 --rpc-jitter 3 --rpc-budget 36 --max-seconds 210 \
  --write --settings=EVE_MDjango.killboard_worker_settings
