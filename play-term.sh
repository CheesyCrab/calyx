#!/usr/bin/env sh
set -eu

exec "$(dirname "$0")/_run-catalog.sh" play-term "$@"
