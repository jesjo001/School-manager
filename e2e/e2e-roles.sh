#!/bin/sh
# Phase 3 checks for role-based session behaviour: learner sign-in, teacher
# gating, and cross-tenant school switching.
BASE=${E2E_BASE:-http://127.0.0.1:3100}
APP=$(cd "$(dirname "$0")/.." && pwd)
DIR=${E2E_TMP:-$APP/.e2e}
mkdir -p "$DIR"
JT=$DIR/jar-teacher.txt
JS=$DIR/jar-student.txt
JS2=$DIR/jar-student2.txt
JB=$DIR/jar-other.txt
OWN=$DIR/jar-owner2.txt
JA=$DIR/jar-ownerA.txt
rm -f "$JT" "$JS" "$JS2" "$JB" "$OWN" "$JA"
FAIL=0
say() { printf '\n== %s\n' "$1"; }
expect() {
  if [ "$2" = "$3" ]; then printf '  ok   %-52s %s\n' "$1" "$2"
  else printf '  FAIL %-52s got=%s want=%s\n' "$1" "$2" "$3"; FAIL=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d "$2" "$BASE$1"; }

# --- teacher session ---------------------------------------------------------
say "teacher sign-in and route gating"
expect "staff login -> 200"          "$(curl -s -o /dev/null -w '%{http_code}' -c "$JT" -H 'content-type: application/json' -d '{"email":"teacher1@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/login)" "200"
expect "teacher /dashboard -> 200"  "$(code -b "$JT" $BASE/dashboard)"  "200"
expect "teacher /students -> 200"   "$(code -b "$JT" $BASE/students)"   "200"
expect "teacher /staff -> 307"      "$(code -b "$JT" $BASE/staff)"      "307"
expect "teacher /fees -> 307"       "$(code -b "$JT" $BASE/fees)"       "307"
TME=$(curl -s -b "$JT" $BASE/api/auth/me)
expect "me role=Teacher"            "$(printf '%s' "$TME" | grep -c '"role":"Teacher"')" "1"
expect "me kind=staff"              "$(printf '%s' "$TME" | grep -c '"kind":"staff"')"  "1"

# --- learner session ---------------------------------------------------------
say "learner sign-in (school email)"
expect "student-login -> 200"        "$(curl -s -o /dev/null -w '%{http_code}' -c "$JS" -H 'content-type: application/json' -d '{"identifier":"student1@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/student-login)" "200"
expect "student /exams -> 200"       "$(code -b "$JS" $BASE/exams)"      "200"
expect "student /exam/abc -> 200"    "$(code -b "$JS" $BASE/exam/abc)"   "200"
# The original RoleGuard table permits `/` for students too, so middleware
# agrees: learners may open the overview, they just land on /exams first.
expect "student / (overview) -> 200"  "$(code -b "$JS" $BASE/)"             "200"
expect "student /students -> 307"    "$(code -b "$JS" $BASE/students)"   "307"
expect "student /staff -> 307"       "$(code -b "$JS" $BASE/staff)"      "307"
expect "student /exams/new -> 307"   "$(code -b "$JS" $BASE/exams/new)"  "307"
SME=$(curl -s -b "$JS" $BASE/api/auth/me)
expect "me role=Student"             "$(printf '%s' "$SME" | grep -c '"role":"Student"')" "1"
expect "me kind=student"             "$(printf '%s' "$SME" | grep -c '"kind":"student"')" "1"
expect "students cannot use staff login" "$(post /api/auth/login '{"email":"student1@greenfield.edu.ng","password":"password123"}')" "401"
expect "learner cannot switch school" "$(code -b "$JS" -H 'content-type: application/json' -d '{"schoolId":"000000000000000000000000"}' $BASE/api/schools/switch)" "403"

say "learner sign-in (admission number)"
expect "student-login by admission -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -c "$JS2" -H 'content-type: application/json' -d '{"identifier":"GFA-2401","password":"password123"}' $BASE/api/auth/student-login)" "200"
expect "admission session is the same learner" \
  "$(curl -s -b "$JS2" $BASE/api/auth/me | grep -c 'Chidinma Okeke')" "1"
expect "wrong learner password -> 401" "$(post /api/auth/student-login '{"identifier":"GFA-2401","password":"wrong"}')" "401"

# --- cross-tenant isolation --------------------------------------------------
say "a second tenant cannot adopt the first tenant's school"
expect "owner A signs back in -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -c "$JA" -H 'content-type: application/json' -d '{"email":"ada@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/login)" "200"
REG=$(curl -s -c "$OWN" -H 'content-type: application/json' \
  -d "{\"schoolName\":\"Sunrise College\",\"location\":\"Lagos, Ikeja\",\"ownerName\":\"Bola Ade\",\"email\":\"bola$(date +%s)@sunrise.edu.ng\",\"password\":\"password123\"}" \
  $BASE/api/auth/register)
expect "second register -> success"  "$(printf '%s' "$REG" | grep -c '"success":true')" "1"
BS=$(curl -s -b "$OWN" $BASE/api/schools)
BID=$(printf '%s' "$BS" | sed -n 's/.*"id":"\([a-f0-9]\{24\}\)".*/\1/p')
AID=$(cat "$DIR/school-id.txt")
expect "tenants really have different schools" "$([ "$AID" != "$BID" ] && echo yes || echo no)" "yes"
expect "owner A cannot switch to school B" \
  "$(code -b "$JA" -H 'content-type: application/json' -d "{\"schoolId\":\"$BID\"}" $BASE/api/schools/switch)" "403"
expect "owner B cannot switch to school A" \
  "$(code -b "$OWN" -H 'content-type: application/json' -d "{\"schoolId\":\"$AID\"}" $BASE/api/schools/switch)" "403"
expect "owner A sees only their own school" "$(curl -s -b "$JA" $BASE/api/schools | grep -c 'Sunrise College')" "0"
expect "owner B sees only their own school" "$(curl -s -b "$OWN" $BASE/api/schools | grep -c 'Greenfield Academy')" "0"

printf '\n%s\n' "$([ $FAIL -eq 0 ] && echo 'ALL PHASE-3 ROLE/TENANCY CHECKS PASSED' || echo 'THERE WERE FAILURES')"
exit $FAIL
