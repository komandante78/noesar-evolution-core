#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# One minute: install two packages, each measured in a throw-away copy, and read the receipts.
# Needs node 22 and docker. Touches nothing outside a temporary directory, which it removes.
#
#   sh examples/effect-receipt-demo/demo.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
tool="$here/../../tools/effect-receipt.mjs"
# The runner image, read from the tool itself so the demo cannot drift from it.
image=${NOESAR_RECEIPT_IMAGE:-$(sed -n "s/.*'\(node:[^']*@sha256:[0-9a-f]*\)'.*/\1/p" "$tool" | head -1)}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$here/app" "$work/app"

# The two packages, packed where npm can install them from — offline, as the reader's own user.
for pkg in clean install-script; do
  docker run --rm --network=none --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$here/packages/$pkg:/src:ro" -v "$work/app:/out" "$image" \
    sh -c 'cp -R /src /tmp/pkg && cd /tmp/pkg && npm pack --silent --pack-destination /out' >/dev/null
done

node "$tool" keygen --out "$work/key" >/dev/null
# What installing a package is allowed to touch: its folder, the manifest, the lock file, npm's cache.
declared="--declare node_modules/ --declare package.json --declare package-lock.json --declare ~/.npm/"

for pkg in clean install-script; do
  echo
  echo "=== npm install receipt-demo-$pkg — declared: $declared"
  # shellcheck disable=SC2086
  node "$tool" run --workspace "$work/app" $declared --key "$work/key.pem" \
    --out "$work/$pkg.json" -- npm install --no-audit --no-fund "./receipt-demo-$pkg-1.0.0.tgz" || true
  echo "--- verified by someone who holds only the public key:"
  node "$tool" verify --in "$work/$pkg.json" --pub "$work/key.pub.pem" || true
done
