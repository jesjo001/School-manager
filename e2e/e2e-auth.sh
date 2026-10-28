#!/bin/sh
# Phase 3 end-to-end check: middleware, register/login/logout, session,
# tenancy re-validation, rate limiting. Requires next start on :3100 + mongod.
BASE=${E2E_BASE:-http://127.0.0.1:3100}
APP=$(cd "$(dirname "$0")/.." && pwd)
DIR=${E2E_TMP:-$APP/.e2e}
mkdir -p "$DIR"
JAR=$DIR/jar-owner.txt
rm -f "$JAR"
FAIL=0
say() { printf '\n== %s\n' "$1"; }
expect() { # expect <label> <actual> <wanted>
  if [ "$2" = "$3" ]; then printf '  ok   %-52s %s\n' "$1" "$2"
  else printf '  FAIL %-52s got=%s want=%s\n' "$1" "$2" "$3"; FAIL=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# --- wait for the server -----------------------------------------------------
i=0
while [ $i -lt 90 ]; do
  if code "$BASE/auth" 2>/dev/null | grep -q 200; then break; fi
  i=$((i+1)); sleep 1
done
say "server ready after ${i}s"

# --- middleware --------------------------------------------------------------
say "middleware: anonymous users are kept out of the workspace"
expect "GET / redirects"            "$(code $BASE/)"                      "307"
expect "GET /students redirects"    "$(code $BASE/students)"              "307"
expect "GET /exam/anything redirects" "$(code $BASE/exam/whatever)"        "307"
expect "GET /auth is public"        "$(code $BASE/auth)"                  "200"
expect "GET /onboarding is public"  "$(code $BASE/onboarding)"            "200"

# --- register ----------------------------------------------------------------
say "POST /api/auth/register (creates tenant + school + proprietor)"
REG=$(curl -s -c "$JAR" -H 'content-type: application/json' \
  -d '{"schoolName":"Greenfield Academy","location":"Ibadan, Oyo","ownerName":"Ada Nwosu","email":"ada@greenfield.edu.ng","password":"password123","brandColor":"#8c8de8"}' \
  $BASE/api/auth/register)
printf '  %s\n' "$(printf '%s' "$REG" | head -c 320)"
expect "register success"          "$(printf '%s' "$REG" | grep -c '"success":true')" "1"
expect "cookie set (httpOnly)"     "$(grep -c 'cf_session' "$JAR" | tr -d ' ')"        "1"
expect "session role=Proprietor"   "$(printf '%s' "$REG" | grep -c '"role":"Proprietor"')" "1"
expect "brand colour preserved"    "$(printf '%s' "$REG" | grep -c '"brandColor":"#8c8de8"')" "1"

say "duplicate registration is rejected"
expect "second register -> 409"    "$(code -H 'content-type: application/json' \
  -d '{"schoolName":"Greenfield Academy","location":"Ibadan, Oyo","ownerName":"Ada Nwosu","email":"ada@greenfield.edu.ng","password":"password123"}' \
  $BASE/api/auth/register)" "409"

# --- session -----------------------------------------------------------------
say "GET /api/auth/me"
ME=$(curl -s -b "$JAR" $BASE/api/auth/me)
printf '  %s\n' "$(printf '%s' "$ME" | head -c 320)"
expect "session returned"          "$(printf '%s' "$ME" | grep -c '"success":true')" "1"
expect "school name in session"    "$(printf '%s' "$ME" | grep -c 'Greenfield Academy')" "1"
expect "me without cookie -> null" "$(curl -s $BASE/api/auth/me | grep -c '"data":null')" "1"

say "authenticated middleware pass-through"
expect "GET / with cookie -> 200"   "$(code -b "$JAR" $BASE/)"                 "200"
expect "GET /staff with cookie -> 200" "$(code -b "$JAR" $BASE/staff)"         "200"

# --- tenancy -----------------------------------------------------------------
say "school switching is validated against the DB, not the request body"
expect "switch to foreign id -> 403" "$(code -b "$JAR" -H 'content-type: application/json' \
  -d '{"schoolId":"000000000000000000000000"}' $BASE/api/schools/switch)" "403"
OWN=$(curl -s -b "$JAR" $BASE/api/schools)
SCHOOL_ID=$(printf '%s' "$OWN" | sed -n 's/.*"id":"\([a-f0-9]\{24\}\)".*/\1/p')
expect "GET /api/schools lists 1"  "$(printf '%s' "$OWN" | grep -c 'Greenfield Academy')" "1"
expect "switch to own school -> 200" "$(code -b "$JAR" -H 'content-type: application/json' \
  -d "{\"schoolId\":\"$SCHOOL_ID\"}" $BASE/api/schools/switch)" "200"
printf '  school id: %s\n' "$SCHOOL_ID"
printf '%s' "$SCHOOL_ID" > "$DIR/school-id.txt"

# --- failed login + rate limiting -------------------------------------------
say "wrong password and login throttling"
expect "wrong password -> 401"     "$(code -H 'content-type: application/json' \
  -d '{"email":"ada@greenfield.edu.ng","password":"nope"}' $BASE/api/auth/login)" "401"
expect "unknown account -> 401"    "$(code -H 'content-type: application/json' \
  -d '{"email":"ghost@nowhere.edu.ng","password":"x"}' $BASE/api/auth/login)" "401"
i=1; last=""
while [ $i -le 6 ]; do
  last=$(code -H 'content-type: application/json' -d '{"email":"ghost@nowhere.edu.ng","password":"x"}' $BASE/api/auth/login)
  printf '  attempt %s -> %s\n' "$i" "$last"
  i=$((i+1))
done
expect "6th attempt throttled"     "$last" "429"

expect "valid login -> 200"        "$(code -H 'content-type: application/json' \
  -d '{"email":"ada@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/login)" "200"

# --- logout ------------------------------------------------------------------
say "POST /api/auth/logout"
curl -s -b "$JAR" -c "$JAR" -X POST $BASE/api/auth/logout > /dev/null
expect "session cleared"           "$(curl -s -b "$JAR" $BASE/api/auth/me | grep -c '"data":null')" "1"
expect "GET / after logout"        "$(code -b "$JAR" $BASE/)" "307"

printf '\n%s\n' "$([ $FAIL -eq 0 ] && echo 'ALL PHASE-3 AUTH CHECKS PASSED' || echo 'THERE WERE FAILURES')"
exit $FAIL
