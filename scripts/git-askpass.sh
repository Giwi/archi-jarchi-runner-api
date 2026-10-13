#!/bin/sh
# git credential prompt helper used by archi-server.
# git invokes this with a prompt as $1; credentials come from the environment
# so the access token never appears in the process arguments.
case "$1" in
  *[Uu]sername*) printf '%s\n' "${ARCHI_GIT_USERNAME:-}" ;;
  *)             printf '%s\n' "${ARCHI_GIT_PASSWORD:-}" ;;
esac
