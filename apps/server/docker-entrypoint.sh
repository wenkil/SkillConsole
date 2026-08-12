#!/bin/sh
set -eu

# Named volumes created by older SkillConsole images may still be owned by
# root. Repair only the two writable runtime roots before permanently dropping
# the container's narrowly scoped bootstrap capabilities.
mkdir -p /workspace/var /home/node/.claude
chown -R node:node /workspace/var /home/node/.claude

exec setpriv \
  --reuid=node \
  --regid=node \
  --init-groups \
  --bounding-set=-all \
  --inh-caps=-all \
  --ambient-caps=-all \
  --no-new-privs \
  "$@"
