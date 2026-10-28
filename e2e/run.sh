#!/bin/sh
# CampusFlow end-to-end gate.
#
#   sh e2e/run.sh                wipe the database, seed it, run every suite
#   E2E_KEEP=1 sh e2e/run.sh     keep whatever is in the database (fresh only)
#
# The suites assert exact counts, so the default is a wipe: every collection is
# emptied (indexes are kept, so unique constraints stay enforced while the
# server is running) and the data is rebuilt through the public API —
# registration in e2e-auth.sh, then `npm run seed`.
#
# The server must already be running:
#   npm run build && npm run start -- --port 3100
set -u
APP=$(cd "$(dirname "$0")/.." && pwd)
BASE=${E2E_BASE:-http://127.0.0.1:3100}
URI=${MONGODB_URI:-mongodb://127.0.0.1:27017/campusflow}
DIR=${E2E_TMP:-$APP/.e2e}
mkdir -p "$DIR"
FAIL=0

run() { # run <suite file name>
  printf '\n########## %s\n' "$1"
  sh "$APP/e2e/$1" || FAIL=1
}

i=0
while [ $i -lt 90 ]; do
  if curl -s -o /dev/null -w '%{http_code}' "$BASE/auth" | grep -q 200; then break; fi
  i=$((i + 1))
  sleep 1
done
if [ "$i" -ge 90 ]; then
  echo "no server answering on $BASE — run: npm run build && npm run start -- --port 3100"
  exit 1
fi
echo "server ready after ${i}s"

if [ "${E2E_KEEP:-0}" != "1" ]; then
  MONGODB_URI="$URI" node --input-type=module -e "
    import mongoose from 'mongoose'
    await mongoose.connect(process.env.MONGODB_URI)
    const collections = await mongoose.connection.db.listCollections().toArray()
    for (const { name } of collections) await mongoose.connection.db.collection(name).deleteMany({})
    await mongoose.disconnect()
    console.log('database emptied (indexes kept)')
  " || FAIL=1
fi

run e2e-auth.sh

printf '\n########## seed\n'
if (cd "$APP" && npm run seed --silent -- --school "$(cat "$DIR/school-id.txt")"); then :; else FAIL=1; fi

run e2e-roles.sh
run e2e-resources.sh
run e2e-fees.sh
run e2e-exams.sh

printf '\n'
if [ "$FAIL" = "0" ]; then
  echo "ALL E2E SUITES PASSED"
else
  echo "E2E FAILURES — see the FAIL lines above"
fi
exit "$FAIL"
