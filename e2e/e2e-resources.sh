#!/bin/sh
# Phase 4 end-to-end checks: classes, subjects, students, staff, attendance and
# teacher assignments — CRUD, envelope shapes, pagination/search, Zod validation,
# role gates and cross-tenant isolation. Needs next start on :3100 + mongod.
BASE=${E2E_BASE:-http://127.0.0.1:3100}
APP=$(cd "$(dirname "$0")/.." && pwd)
DIR=${E2E_TMP:-$APP/.e2e}
mkdir -p "$DIR"
JA=$DIR/jar-p4-owner.txt
JC=$DIR/jar-p4-tenant.txt
JT=$DIR/jar-teacher.txt
JS=$DIR/jar-student.txt
rm -f "$JA" "$JC" "$JT" "$JS"
FAIL=0

say() { printf '\n== %s\n' "$1"; }
expect() { # expect <label> <actual> <wanted>
  if [ "$2" = "$3" ]; then printf '  ok   %-52s %s\n' "$1" "$2"
  else printf '  FAIL %-52s got=%s want=%s\n' "$1" "$2" "$3"; FAIL=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# json <jar> <body> <url>
json() { curl -s -b "$1" -H 'content-type: application/json' -d "$2" "$3"; }
fid() {
  v=$(printf '%s' "$1" | sed -n 's/.*"id":"\([a-f0-9]\{24\}\)".*/\1/p' | head -1)
  if [ "${#v}" -ge 24 ]; then printf '%.24s' "$v"; fi
}
hits() { printf '%s' "$1" | grep -c "$2"; }
rows() { printf '%s' "$1" | grep -o "$2" | wc -l | tr -d ' '; }
# total — `data.total` of a paginated list piped on stdin (arrays print nothing)
total() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s).data;console.log(d&&typeof d.total==="number"?d.total:"?")}catch{console.log("?")}})'
}

# --- server ready ------------------------------------------------------------
i=0
while [ $i -lt 90 ]; do
  if code "$BASE/auth" 2>/dev/null | grep -q 200; then break; fi
  i=$((i+1)); sleep 1
done
say "server ready after ${i}s"

# --- sessions ----------------------------------------------------------------
say "sessions used by this suite"
expect "proprietor login -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -c "$JA" -H 'content-type: application/json' -d '{"email":"ada@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/login)" "200"

# --- classes -----------------------------------------------------------------
say "GET/POST/PATCH /api/classes"
# `npm run seed` already owns "JSS 1" and "SS 1", so this suite works in its own.
CL=$(json "$JA" '{"name":"SS 2","sections":3}' $BASE/api/classes)
CID=$(fid "$CL")
expect "create class -> success"     "$(hits "$CL" '"success":true')" "1"
expect "section count is a number"  "$(hits "$CL" '"sections":3')" "1"
expect "section letters serialised" "$(hits "$CL" '"sectionList":\["A","B","C"\]')" "1"
expect "new class starts with 0"    "$(hits "$CL" '"studentCount":0')" "1"
expect "class teacher empty"        "$(hits "$CL" '"teacher":""')" "1"
expect "duplicate class name -> 409" "$(code -b "$JA" -H 'content-type: application/json' -d '{"name":"SS 2"}' $BASE/api/classes)" "409"
expect "missing name -> 400"        "$(code -b "$JA" -H 'content-type: application/json' -d '{"sections":2}' $BASE/api/classes)" "400"
CLP=$(curl -s -b "$JA" -X PATCH -H 'content-type: application/json' -d '{"sections":4}' $BASE/api/classes/$CID)
expect "growing sections keeps A-C" "$(hits "$CLP" '"sectionList":\["A","B","C","D"\]')" "1"
expect "class list includes SS 2"   "$(curl -s -b "$JA" $BASE/api/classes | grep -c 'SS 2')" "1"
expect "unknown class id -> 404"    "$(code -b "$JA" -X PATCH -H 'content-type: application/json' -d '{"name":"Nope"}' $BASE/api/classes/000000000000000000000000)" "404"

# --- subjects ----------------------------------------------------------------
say "GET/POST/PATCH /api/subjects"
# `npm run seed` already ships a Mathematics subject — remember the baseline.
SUBN=$(rows "$(curl -s -b "$JA" $BASE/api/subjects)" '"id":"[a-f0-9]\{24\}"')
SU=$(json "$JA" "{\"name\":\"Further Mathematics\",\"classIds\":[\"$CID\"]}" $BASE/api/subjects)
SID=$(fid "$SU")
expect "create subject -> success"  "$(hits "$SU" '"success":true')" "1"
expect "subject knows its classes" "$(hits "$SU" '"classNames":\["SS 2"\]')" "1"
expect "duplicate subject -> 409"  "$(code -b "$JA" -H 'content-type: application/json' -d '{"name":"Further Mathematics"}' $BASE/api/subjects)" "409"
expect "foreign classId on subject -> 400" "$(code -b "$JA" -H 'content-type: application/json' -d '{"name":"Chemistry","classIds":["000000000000000000000000"]}' $BASE/api/subjects)" "400"
SUP=$(curl -s -b "$JA" -X PATCH -H 'content-type: application/json' -d "{\"classIds\":[],\"name\":\"Further Maths\"}" $BASE/api/subjects/$SID)
expect "patch subject name"         "$(hits "$SUP" '"name":"Further Maths"')" "1"
SU=$(curl -s -b "$JA" -X PATCH -H 'content-type: application/json' -d "{\"name\":\"Further Mathematics\",\"classIds\":[\"$CID\"]}" $BASE/api/subjects/$SID)
expect "restore subject name"       "$(hits "$SU" '"name":"Further Mathematics"')" "1"
expect "subject list grows by 1"    "$(rows "$(curl -s -b "$JA" $BASE/api/subjects)" '"id":"[a-f0-9]\{24\}"')" "$((SUBN + 1))"

# --- students ----------------------------------------------------------------
say "GET/POST/PATCH/DELETE /api/students"
# Seeded learners already exist — remember how many before adding two.
STUN=$(curl -s -b "$JA" "$BASE/api/students?limit=100" | total)
S1=$(json "$JA" "{\"name\":\"Amina Yusuf\",\"classId\":\"$CID\",\"section\":\"A\",\"gender\":\"Female\",\"guardian\":{\"name\":\"Halima Yusuf\"}}" $BASE/api/students)
S1ID=$(fid "$S1")
expect "create student -> success"  "$(hits "$S1" '"success":true')" "1"
expect "class name denormalised"   "$(hits "$S1" '"class":"SS 2"')" "1"
expect "status label Active"       "$(hits "$S1" '"status":"Active"')" "1"
expect "guardian rendered"         "$(hits "$S1" '"guardians":\["Halima Yusuf"\]')" "1"
expect "avatar falls back to initials" "$(hits "$S1" '"avatar":"AY"')" "1"
expect "attendance defaults to 0"  "$(hits "$S1" '"attendance":0')" "1"
expect "exam scores default empty" "$(hits "$S1" '"examScores":\[\]')" "1"
S2=$(json "$JA" "{\"name\":\"Chinedu Eze\",\"classId\":\"$CID\",\"section\":\"B\",\"admissionNumber\":\"GFA-9001\"}" $BASE/api/students)
S2ID=$(fid "$S2")
expect "explicit admission number"  "$(hits "$S2" '"success":true')" "1"
expect "duplicate admission -> 409" "$(code -b "$JA" -H 'content-type: application/json' -d "{\"name\":\"Ghost Eze\",\"classId\":\"$CID\",\"section\":\"A\",\"admissionNumber\":\"GFA-9001\"}" $BASE/api/students)" "409"
expect "empty body -> 400"          "$(code -b "$JA" -H 'content-type: application/json' -d '{}' $BASE/api/students)" "400"
expect "unknown classId -> 400"     "$(code -b "$JA" -H 'content-type: application/json' -d '{"name":"Zed Zoro","classId":"000000000000000000000000","section":"A"}' $BASE/api/students)" "400"

say "list: pagination + search + filters"
expect "school A has $((STUN + 2)) students" "$(curl -s -b "$JA" "$BASE/api/students?limit=100" | total)" "$((STUN + 2))"
expect "search by name -> 1"        "$(hits "$(curl -s -b "$JA" "$BASE/api/students?q=Amina")" '"total":1')" "1"
expect "search is literal not regex" "$(hits "$(curl -s -b "$JA" "$BASE/api/students?q=.*")" '"total":0')" "1"
expect "search by admission no -> 1" "$(hits "$(curl -s -b "$JA" "$BASE/api/students?q=GFA-9001")" '"total":1')" "1"
expect "class filter -> 2"          "$(hits "$(curl -s -b "$JA" "$BASE/api/students?classId=$CID")" '"total":2')" "1"
PAGE2=$(curl -s -b "$JA" "$BASE/api/students?limit=1&page=2")
expect "page 2 echo"                "$(hits "$PAGE2" '"page":2')" "1"
expect "page 2 holds 1 row"         "$(rows "$PAGE2" '"id":"[a-f0-9]\{24\}"')" "1"
expect "limit above 100 rejected"   "$(code -b "$JA" "$BASE/api/students?limit=500")" "400"

say "detail + update"
DET=$(curl -s -b "$JA" $BASE/api/students/$S1ID)
expect "GET by id -> Amina"         "$(hits "$DET" '"name":"Amina Yusuf"')" "1"
PA=$(curl -s -b "$JA" -X PATCH -H 'content-type: application/json' -d '{"status":"On leave"}' $BASE/api/students/$S1ID)
expect "patch status -> On leave"   "$(hits "$PA" '"status":"On leave"')" "1"
expect "status filter matches"      "$(hits "$(curl -s -b "$JA" "$BASE/api/students?status=On%20leave")" '"total":1')" "1"
PC=$(curl -s -b "$JA" -X PATCH -H 'content-type: application/json' -d '{"name":"Amina Y. Yusuf"}' $BASE/api/students/$S1ID)
expect "patch name -> 200"          "$(hits "$PC" '"name":"Amina Y. Yusuf"')" "1"
expect "unknown id -> 404"          "$(code -b "$JA" $BASE/api/students/000000000000000000000000)" "404"
expect "malformed id -> 404"        "$(code -b "$JA" $BASE/api/students/not-an-id)" "404"
expect "patch with bad classId -> 400" "$(code -b "$JA" -X PATCH -H 'content-type: application/json' -d '{"classId":"000000000000000000000000"}' $BASE/api/students/$S1ID)" "400"
expect "patch with nothing -> 400"  "$(code -b "$JA" -X PATCH -H 'content-type: application/json' -d '{}' $BASE/api/students/$S1ID)" "400"

# --- attendance --------------------------------------------------------------
say "GET/POST /api/attendance"
TODAY=$(date +%F)
FXID=$(fid "$(curl -s -b "$JA" "$BASE/api/students?q=Chidinma")")
AG=$(curl -s -b "$JA" "$BASE/api/attendance?classId=$CID&date=$TODAY")
expect "no register yet -> null"    "$(hits "$AG" '"data":null')" "1"
SAV=$(json "$JA" "{\"classId\":\"$CID\",\"date\":\"$TODAY\",\"records\":[{\"studentId\":\"$S1ID\",\"status\":\"Present\"},{\"studentId\":\"$S2ID\",\"status\":\"absent\"}]}" $BASE/api/attendance)
expect "register saved -> success"  "$(hits "$SAV" '"success":true')" "1"
expect "UI casing for Present"      "$(hits "$SAV" '"status":"Present"')" "1"
expect "lowercase input normalised" "$(hits "$SAV" '"status":"Absent"')" "1"
expect "records serialised for UI"  "$(rows "$SAV" '"studentId":"[a-f0-9]\{24\}"')" "2"
SAV2=$(json "$JA" "{\"classId\":\"$CID\",\"date\":\"$TODAY\",\"records\":[{\"studentId\":\"$S1ID\",\"status\":\"Present\"},{\"studentId\":\"$S2ID\",\"status\":\"Late\"}]}" $BASE/api/attendance)
expect "re-save is idempotent"      "$(rows "$SAV2" '"studentId":"[a-f0-9]\{24\}"')" "2"
expect "Late stored as Late"        "$(hits "$SAV2" '"status":"Late"')" "1"
AG2=$(curl -s -b "$JA" "$BASE/api/attendance?classId=$CID&date=$TODAY")
expect "GET returns the day"        "$(hits "$AG2" "\"date\":\"$TODAY\"" )" "1"
expect "learner from another class -> 400" "$(code -b "$JA" -H 'content-type: application/json' -d "{\"classId\":\"$CID\",\"date\":\"$TODAY\",\"records\":[{\"studentId\":\"$FXID\",\"status\":\"Present\"}]}" $BASE/api/attendance)" "400"
expect "unknown status -> 400"      "$(code -b "$JA" -H 'content-type: application/json' -d "{\"classId\":\"$CID\",\"date\":\"$TODAY\",\"records\":[{\"studentId\":\"$S1ID\",\"status\":\"maybe\"}]}" $BASE/api/attendance)" "400"
expect "impossible date -> 400"     "$(code -b "$JA" "$BASE/api/attendance?classId=$CID&date=2026-13-99")" "400"
expect "anonymous attendance -> 401" "$(code "$BASE/api/attendance?classId=$CID&date=$TODAY")" "401"

# --- staff -------------------------------------------------------------------
say "GET/POST/PATCH/DELETE /api/staff"
expect "school A starts with 2 staff" "$(hits "$(curl -s -b "$JA" "$BASE/api/staff?limit=100")" '"total":2')" "1"
INV=$(json "$JA" '{"name":"Mr. David Okoro","email":"david@greenfield.edu.ng","role":"Teacher","subjects":["Mathematics","English"],"classes":["Unassigned"]}' $BASE/api/staff)
DID=$(fid "$INV")
expect "invite -> success"          "$(hits "$INV" '"success":true')" "1"
expect "invited status label"       "$(hits "$INV" '"status":"Invited"')" "1"
expect "role label Teacher"         "$(hits "$INV" '"role":"Teacher"')" "1"
expect "invite keeps subjects"      "$(hits "$INV" '"subjects":\["Mathematics","English"\]')" "1"
expect "invite keeps classes"       "$(hits "$INV" '"classes":\["Unassigned"\]')" "1"
expect "duplicate invite -> 409"    "$(code -b "$JA" -H 'content-type: application/json' -d '{"name":"David Again","email":"david@greenfield.edu.ng","role":"Teacher"}' $BASE/api/staff)" "409"
BRS=$(json "$JA" '{"name":"Mrs. Bursar One","email":"bursar@greenfield.edu.ng","role":"Bursar"}' $BASE/api/staff)
BID=$(fid "$BRS")
expect "Bursar label maps to Admin" "$(hits "$BRS" '"role":"Admin"')" "1"
expect "school A has 4 staff"       "$(hits "$(curl -s -b "$JA" "$BASE/api/staff?limit=100")" '"total":4')" "1"
expect "role=Teacher filter -> 2"   "$(hits "$(curl -s -b "$JA" "$BASE/api/staff?role=Teacher&limit=100")" '"total":2')" "1"
expect "role=Head of School -> 1"   "$(hits "$(curl -s -b "$JA" "$BASE/api/staff?role=Head%20of%20School&limit=100")" '"total":1')" "1"
expect "search staff by name -> 1"  "$(hits "$(curl -s -b "$JA" "$BASE/api/staff?q=David")" '"total":1')" "1"
PST=$(curl -s -b "$JA" -X PATCH -H 'content-type: application/json' -d '{"status":"Active","subjects":["Mathematics"]}' $BASE/api/staff/$DID)
expect "staff status -> Active"     "$(hits "$PST" '"status":"Active"')" "1"
TID=$(fid "$(curl -s -b "$JA" "$BASE/api/staff?q=Tunde")")
expect "delete staff -> ok"         "$(hits "$(curl -s -b "$JA" -X DELETE $BASE/api/staff/$DID)" '"ok":true')" "1"
expect "deleted staff gone"         "$(hits "$(curl -s -b "$JA" "$BASE/api/staff?limit=100")" '"total":3')" "1"
expect "self delete -> 400"         "$(code -b "$JA" -X DELETE "$BASE/api/staff/$(printf '%s' "$(curl -s -b "$JA" $BASE/api/auth/me)" | sed -n 's/.*"userId":"\([a-f0-9]\{24\}\)".*/\1/p')")" "400"

# --- teacher assignments -----------------------------------------------------
say "GET/POST/DELETE /api/teacher-assignments"
TA=$(json "$JA" "{\"teacherId\":\"$TID\",\"subjectId\":\"$SID\",\"classId\":\"$CID\"}" $BASE/api/teacher-assignments)
TAID=$(fid "$TA")
expect "assignment -> success"      "$(hits "$TA" '"success":true')" "1"
expect "subject name resolved"     "$(hits "$TA" '"subjectName":"Further Mathematics"')" "1"
expect "class name resolved"       "$(hits "$TA" '"className":"SS 2"')" "1"
expect "teacher name resolved"     "$(hits "$TA" '"teacherName":"Tunde Bello"')" "1"
expect "duplicate assignment -> 409" "$(code -b "$JA" -H 'content-type: application/json' -d "{\"teacherId\":\"$TID\",\"subjectId\":\"$SID\",\"classId\":\"$CID\"}" $BASE/api/teacher-assignments)" "409"
expect "assignments by teacher -> 1" "$(rows "$(curl -s -b "$JA" "$BASE/api/teacher-assignments?teacherId=$TID")" '"subjectName"')" "1"
expect "foreign teacherId -> 400"  "$(code -b "$JA" -H 'content-type: application/json' -d "{\"teacherId\":\"000000000000000000000000\",\"subjectId\":\"$SID\",\"classId\":\"$CID\"}" $BASE/api/teacher-assignments)" "400"
expect "delete assignment -> ok"   "$(hits "$(curl -s -b "$JA" -X DELETE $BASE/api/teacher-assignments/$TAID)" '"ok":true')" "1"
expect "assignment list now empty" "$(rows "$(curl -s -b "$JA" $BASE/api/teacher-assignments)" '"subjectName"')" "0"

# --- tenant isolation --------------------------------------------------------
say "a second tenant cannot see or touch school A's records"
REG=$(curl -s -c "$JC" -H 'content-type: application/json' \
  -d "{\"schoolName\":\"Oakridge School\",\"location\":\"Enugu\",\"ownerName\":\"Chika Obi\",\"email\":\"chika$(date +%s)@oakridge.edu.ng\",\"password\":\"password123\"}" \
  $BASE/api/auth/register)
expect "tenant C registered"       "$(hits "$REG" '"success":true')" "1"
expect "tenant C student list empty" "$(hits "$(curl -s -b "$JC" "$BASE/api/students?limit=100")" '"total":0')" "1"
expect "tenant C cannot read A's student"  "$(code -b "$JC" $BASE/api/students/$S1ID)" "404"
expect "tenant C cannot patch A's student" "$(code -b "$JC" -X PATCH -H 'content-type: application/json' -d '{"name":"Hijacked"}' $BASE/api/students/$S1ID)" "404"
expect "tenant C cannot delete A's student" "$(code -b "$JC" -X DELETE $BASE/api/students/$S1ID)" "404"
expect "tenant C class list empty" "$(curl -s -b "$JC" $BASE/api/classes | grep -c 'SS 2')" "0"
expect "tenant C cannot patch A's class" "$(code -b "$JC" -X PATCH -H 'content-type: application/json' -d '{"name":"Stolen"}' $BASE/api/classes/$CID)" "404"
expect "tenant C cannot read A's subject" "$(code -b "$JC" -X PATCH -H 'content-type: application/json' -d '{"name":"Stolen"}' $BASE/api/subjects/$SID)" "404"
expect "tenant C cannot take A's register" "$(code -b "$JC" "$BASE/api/attendance?classId=$CID&date=$TODAY")" "400"
expect "tenant C staff = own owner only" "$(hits "$(curl -s -b "$JC" "$BASE/api/staff?limit=100")" '"total":1')" "1"
expect "tenant C cannot delete A's staff" "$(code -b "$JC" -X DELETE $BASE/api/staff/$TID)" "404"
expect "tenant C cannot reinvite A's email" "$(code -b "$JC" -H 'content-type: application/json' -d '{"name":"Copycat","email":"teacher1@greenfield.edu.ng","role":"Teacher"}' $BASE/api/staff)" "409"
expect "tenant C sees no assignments" "$(rows "$(curl -s -b "$JC" $BASE/api/teacher-assignments)" '"id"')" "0"
AFTER=$(curl -s -b "$JA" $BASE/api/students/$S1ID)
expect "school A data untouched"   "$(hits "$AFTER" '"name":"Amina Y. Yusuf"')" "1"

# --- role gates --------------------------------------------------------------
say "API role gates (mirrors RoleGuard)"
expect "teacher login -> 200"      "$(curl -s -o /dev/null -w '%{http_code}' -c "$JT" -H 'content-type: application/json' -d '{"email":"teacher1@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/login)" "200"
expect "learner login -> 200"      "$(curl -s -o /dev/null -w '%{http_code}' -c "$JS" -H 'content-type: application/json' -d '{"identifier":"student1@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/student-login)" "200"
expect "teacher reads students"    "$(code -b "$JT" "$BASE/api/students?limit=1")" "200"
expect "teacher takes attendance"  "$(code -b "$JT" -H 'content-type: application/json' -d "{\"classId\":\"$CID\",\"date\":\"$TODAY\",\"records\":[]}" $BASE/api/attendance)" "200"
expect "teacher cannot read staff" "$(code -b "$JT" $BASE/api/staff)" "403"
expect "teacher cannot invite"     "$(code -b "$JT" -H 'content-type: application/json' -d '{"name":"Nope","email":"nope@greenfield.edu.ng","role":"Teacher"}' $BASE/api/staff)" "403"
expect "learner cannot read students" "$(code -b "$JS" $BASE/api/students)" "403"
expect "learner cannot read classes"  "$(code -b "$JS" $BASE/api/classes)" "403"
expect "learner cannot read register" "$(code -b "$JS" "$BASE/api/attendance?classId=$CID&date=$TODAY")" "403"
expect "anonymous students -> 401" "$(code "$BASE/api/students")" "401"

# --- cascades ----------------------------------------------------------------
say "deleting a class keeps learner records consistent"
TD=$(json "$JA" '{"name":"TEMP DEL","sections":1}' $BASE/api/classes)
TDCID=$(fid "$TD")
TS=$(json "$JA" "{\"name\":\"Temp Learner\",\"classId\":\"$TDCID\",\"section\":\"A\"}" $BASE/api/students)
TSID=$(fid "$TS")
expect "temp class created"        "$(hits "$TD" '"success":true')" "1"
expect "delete class -> ok"        "$(hits "$(curl -s -b "$JA" -X DELETE $BASE/api/classes/$TDCID)" '"ok":true')" "1"
expect "class gone from list"      "$(curl -s -b "$JA" $BASE/api/classes | grep -c 'TEMP DEL')" "0"
expect "learner survives detach"   "$(hits "$(curl -s -b "$JA" $BASE/api/students/$TSID)" '"class":""')" "1"
expect "delete student -> ok"      "$(hits "$(curl -s -b "$JA" -X DELETE $BASE/api/students/$TSID)" '"ok":true')" "1"
expect "deleted student -> 404"    "$(code -b "$JA" $BASE/api/students/$TSID)" "404"
expect "teacher may edit classes"  "$(code -b "$JT" -X PATCH -H 'content-type: application/json' -d '{"sections":4}' $BASE/api/classes/$CID)" "200"

printf '\n%s\n' "$([ $FAIL -eq 0 ] && echo 'ALL PHASE-4 RESOURCE CHECKS PASSED' || echo 'THERE WERE FAILURES')"
exit $FAIL
