#!/bin/sh
set -eu

report_file="$(mktemp "${TMPDIR:-/tmp}/calyx-appstream.XXXXXX")"
trap 'rm -f "$report_file"' EXIT

if appstreamcli validate --no-net "$1" >"$report_file" 2>&1; then
    cat "$report_file"
    exit 0
fi

cat "$report_file"

# The private rehearsal intentionally has no public homepage yet. Accept that
# one warning, but keep every other AppStream error or warning fatal.
grep -Fqx 'W: org.cheesycrab.Calyx:~: url-homepage-missing' "$report_file"
awk '
    /^[EW]:/ && $0 != "W: org.cheesycrab.Calyx:~: url-homepage-missing" { bad = 1 }
    END { exit bad }
' "$report_file"
