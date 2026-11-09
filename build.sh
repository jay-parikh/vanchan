#!/bin/sh
# Tests the app, then packs app/ into ../vanchan.zip for Netlify drop.
# The zip is only made when every test passes.
set -e
cd "$(dirname "$0")"
export PATH="$HOME/node22/bin:$PATH"

echo "== book text (tests/parse.js)"
node tests/parse.js 2>/dev/null
echo
echo "== sync merge rules (tests/unit.js)"
if out=$(node tests/unit.js 2>&1); then echo "$out" | tail -1; else
  echo "$out" | grep -v '^PASS'
  echo "Unit tests failed: no zip made."
  exit 1
fi
echo

echo "== app in a browser (tests/ui.js)"
if node tests/ui.js > tests/ui.log 2>&1; then tail -1 tests/ui.log; else
  grep -v '^PASS' tests/ui.log
  echo "Browser tests failed: no zip made. Full log: tests/ui.log"
  exit 1
fi
echo

echo "== highlights, notes, pen, index card, wide screens (tests/marks.js)"
if node tests/marks.js > tests/marks.log 2>&1; then tail -1 tests/marks.log; else
  grep -v '^PASS' tests/marks.log
  echo "Marking tests failed: no zip made. Full log: tests/marks.log"
  exit 1
fi
echo

echo "== touch: scrolling and drawing in pen mode (tests/touch.js)"
if node tests/touch.js > tests/touch.log 2>&1; then tail -1 tests/touch.log; else
  grep -v '^PASS' tests/touch.log
  echo "Touch tests failed: no zip made. Full log: tests/touch.log"
  exit 1
fi
echo

echo "== updating from the released version (tests/upgrade.js)"
if node tests/upgrade.js > tests/upgrade.log 2>&1; then tail -1 tests/upgrade.log; else
  grep -v '^PASS' tests/upgrade.log
  echo "Upgrade tests failed: no zip made. Full log: tests/upgrade.log"
  exit 1
fi
echo

echo "== sync between two devices (tests/devices.js)"
if node tests/devices.js > tests/devices.log 2>&1; then tail -1 tests/devices.log; else
  grep -v '^PASS' tests/devices.log
  echo "Sync tests failed: no zip made. Full log: tests/devices.log"
  exit 1
fi
echo

VERSION=$(sed -n "s/^const VERSION = '\(.*\)';/\1/p" app/sw.js)
ZIP="$(cd .. && pwd)/vanchan.zip"
rm -f "$ZIP"
(cd app && python3 -c "
import os, sys, zipfile
z = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)
for root, dirs, files in os.walk('.'):
    for f in files:
        p = os.path.join(root, f)[2:]
        z.write(p, p)
z.close()
" "$ZIP")
echo "Built $ZIP ($VERSION). Check the screenshots in tests/shots/ before deploying."
