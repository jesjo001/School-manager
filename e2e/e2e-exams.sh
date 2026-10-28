#!/bin/sh
# Phase 6 end-to-end checks: the CBT lifecycle — exam authoring and windows,
# question/answer-key exposure rules, autosave + tab-switch integrity, deadline
# enforcement, MCQ auto-grading, manual grading of short answers, results and
# attempt isolation (learner vs learner, tenant vs tenant, learner vs staff).
#
# Score arithmetic used below (exam = 2 + 2 + 4 marks, maxScore 8):
#   learner 1: q1 correct (2) + q2 wrong (0) + q3 hand-graded (3) -> 5/8 = 63%
#   learner 2: q1 correct (2), deadline passes                     -> 2/8 = 25%
#   exam average (graded only) = round((63 + 25) / 2) = 44
BASE=${E2E_BASE:-http://127.0.0.1:3100}
APP=$(cd "$(dirname "$0")/.." && pwd)
DIR=${E2E_TMP:-$APP/.e2e}
mkdir -p "$DIR"
JT=$DIR/jar-teacher.txt
JS=$DIR/jar-p6-s1.txt
JS2=$DIR/jar-p6-s2.txt
JS3=$DIR/jar-p6-s3.txt
JO=$DIR/jar-p6-other.txt
rm -f "$JS" "$JS2" "$JS3" "$JO"
FAIL=0

say() { printf '\n== %s\n' "$1"; }
expect() { # expect <label> <actual> <wanted>
  if [ "$2" = "$3" ]; then printf '  ok   %-52s %s\n' "$1" "$2"
  else printf '  FAIL %-52s got=%s want=%s\n' "$1" "$2" "$3"; FAIL=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json() { curl -s -b "$1" -H 'content-type: application/json' -d "$2" "$3"; }
patch() { curl -s -b "$1" -X PATCH -H 'content-type: application/json' -d "$2" "$3"; }
put() { curl -s -b "$1" -X PUT -H 'content-type: application/json' -d "$2" "$3"; }
putcode() { curl -s -o /dev/null -w '%{http_code}' -b "$1" -X PUT -H 'content-type: application/json' -d "$2" "$3"; }
fid() { # first id in the payload (sed's greedy .* would pick the last one)
  node -e 'const m=(process.argv[1]||"").match(/"id":"([0-9a-f]{24})"/);console.log(m?m[1]:"")' "$1"
}
count() { # count <literal> — occurrences in the JSON piped on stdin
  node -e 'const p=process.argv[1];let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.split(p).length-1))' "$1"
}
byname() { # byname <exact name> — id of that row in the JSON list piped on stdin
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s).data;const items=Array.isArray(d)?d:(d&&d.items)||[];const hit=items.find((x)=>x&&x.name===process.argv[1]);console.log(hit?hit.id:"")}catch{console.log("")}})' "$1"
}
hexids() { # every id in order, space separated
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log([...s.matchAll(/"id":"([0-9a-f]{24})"/g)].map(m=>m[1]).join(" ")))'
}
iso() { # iso <ms offset from now, may be negative>
  node -e "console.log(new Date(Date.now()+($1)).toISOString())"
}

i=0
while [ $i -lt 90 ]; do
  if code "$BASE/auth" 2>/dev/null | grep -q 200; then break; fi
  i=$((i+1)); sleep 1
done
say "server ready after ${i}s"

# --- fixtures ----------------------------------------------------------------
say "sessions used by this suite"
expect "teacher login -> 200"    "$(curl -s -o /dev/null -w '%{http_code}' -c "$JT" -H 'content-type: application/json' -d '{"email":"teacher1@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/login)" "200"
expect "learner 1 login -> 200"  "$(curl -s -o /dev/null -w '%{http_code}' -c "$JS"  -H 'content-type: application/json' -d '{"identifier":"student1@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/student-login)" "200"
expect "learner 2 login -> 200"  "$(curl -s -o /dev/null -w '%{http_code}' -c "$JS2" -H 'content-type: application/json' -d '{"identifier":"student2@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/student-login)" "200"
expect "learner 3 login -> 200"  "$(curl -s -o /dev/null -w '%{http_code}' -c "$JS3" -H 'content-type: application/json' -d '{"identifier":"student3@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/student-login)" "200"

say "resolve the seeded class and subject through the API"
JSS1=$(curl -s -b "$JT" $BASE/api/classes | byname "JSS 1")
SUBJ=$(curl -s -b "$JT" $BASE/api/subjects | byname "Mathematics")
expect "seeded class + subject found" "$([ -n "$JSS1" ] && [ -n "$SUBJ" ] && echo ok || echo missing)" "ok"

# --- authoring ---------------------------------------------------------------
say "POST /api/exams — scheduled, live, finished and draft exams"
EX1=$(json "$JT" "{\"title\":\"Mid-term Mathematics\",\"subjectId\":\"$SUBJ\",\"classId\":\"$JSS1\",\"startTime\":\"$(iso 7200000)\",\"endTime\":\"$(iso 14400000)\",\"durationMinutes\":45}" $BASE/api/exams)
E1=$(fid "$EX1")
expect "future exam -> success"    "$(printf '%s' "$EX1" | count '"success":true')" "1"
expect "future exam -> Scheduled"  "$(printf '%s' "$EX1" | count '"status":"Scheduled"')" "1"

EX2=$(json "$JT" "{\"title\":\"Live CBT Quiz\",\"subjectId\":\"$SUBJ\",\"classId\":\"$JSS1\",\"startTime\":\"$(iso -600000)\",\"endTime\":\"$(iso 7200000)\",\"durationMinutes\":60}" $BASE/api/exams)
E2=$(fid "$EX2")
expect "open exam -> success"      "$(printf '%s' "$EX2" | count '"success":true')" "1"
expect "open exam -> Live"         "$(printf '%s' "$EX2" | count '"status":"Live"')" "1"

EX3=$(json "$JT" "{\"title\":\"Finished Quiz\",\"subjectId\":\"$SUBJ\",\"classId\":\"$JSS1\",\"startTime\":\"$(iso -10800000)\",\"endTime\":\"$(iso -3600000)\",\"durationMinutes\":30}" $BASE/api/exams)
E3=$(fid "$EX3")
expect "past exam -> Completed"    "$(printf '%s' "$EX3" | count '"status":"Completed"')" "1"

EX4=$(json "$JT" "{\"title\":\"Draft paper\",\"subjectId\":\"$SUBJ\",\"classId\":\"$JSS1\",\"startTime\":\"$(iso -60000)\",\"endTime\":\"$(iso 3600000)\",\"durationMinutes\":30,\"status\":\"draft\"}" $BASE/api/exams)
E4=$(fid "$EX4")
expect "draft exam -> Draft"       "$(printf '%s' "$EX4" | count '"status":"Draft"')" "1"

expect "end before start -> 400"   "$(code -b "$JT" -H 'content-type: application/json' -d "{\"title\":\"Bad window\",\"subjectId\":\"$SUBJ\",\"classId\":\"$JSS1\",\"startTime\":\"$(iso 7200000)\",\"endTime\":\"$(iso 600000)\",\"durationMinutes\":10}" $BASE/api/exams)" "400"
expect "unknown classId -> 400"    "$(code -b "$JT" -H 'content-type: application/json' -d "{\"title\":\"No class\",\"subjectId\":\"$SUBJ\",\"classId\":\"000000000000000000000000\",\"startTime\":\"$(iso 60000)\",\"endTime\":\"$(iso 3600000)\",\"durationMinutes\":10}" $BASE/api/exams)" "400"
expect "learner cannot author -> 403" "$(code -b "$JS" -H 'content-type: application/json' -d "{\"title\":\"Sneaky\",\"subjectId\":\"$SUBJ\",\"classId\":\"$JSS1\",\"startTime\":\"$(iso 60000)\",\"endTime\":\"$(iso 3600000)\",\"durationMinutes\":10}" $BASE/api/exams)" "403"

say "PUT /api/exams/:id/questions — MCQ key + short answer"
QP=$(put "$JT" "{\"questions\":[{\"type\":\"mcq\",\"text\":\"Solve 3x + 6 = 21.\",\"options\":[{\"id\":\"q1-a\",\"text\":\"3\"},{\"id\":\"q1-b\",\"text\":\"5\"},{\"id\":\"q1-c\",\"text\":\"7\"},{\"id\":\"q1-d\",\"text\":\"9\"}],\"correctOptionId\":\"q1-b\",\"marks\":2},{\"type\":\"mcq\",\"text\":\"Which of these is prime?\",\"options\":[{\"id\":\"q2-a\",\"text\":\"21\"},{\"id\":\"q2-b\",\"text\":\"27\"},{\"id\":\"q2-c\",\"text\":\"31\"},{\"id\":\"q2-d\",\"text\":\"39\"}],\"correctOptionId\":\"q2-c\",\"marks\":2},{\"type\":\"short_answer\",\"text\":\"Explain how you solved 3x + 6 = 21.\",\"marks\":4}]}" $BASE/api/exams/$E2/questions)
expect "questions saved -> success" "$(printf '%s' "$QP" | count '"success":true')" "1"
expect "three questions stored"     "$(printf '%s' "$QP" | count '"type":"')" "3"
QIDS=$(printf '%s' "$QP" | hexids)
Q1=$(printf '%s' "$QIDS" | cut -d' ' -f1); Q2=$(printf '%s' "$QIDS" | cut -d' ' -f2); Q3=$(printf '%s' "$QIDS" | cut -d' ' -f3)
expect "question ids extracted"     "$([ -n "$Q1" ] && [ -n "$Q2" ] && [ -n "$Q3" ] && echo ok || echo missing)" "ok"
KQ=$(curl -s -b "$JT" $BASE/api/exams/$E2/questions)
expect "teacher sees the answer key" "$(printf '%s' "$KQ" | count '"correctOptionId":"q1-b"')" "1"
expect "key hidden from option ids"  "$(printf '%s' "$KQ" | count 'q2-c')" "2"
expect "mcq key outside options -> 400" "$(putcode "$JT" '{"questions":[{"type":"mcq","text":"Broken","options":[{"id":"a","text":"1"},{"id":"b","text":"2"}],"correctOptionId":"z","marks":1}]}' $BASE/api/exams/$E2/questions)" "400"
expect "short answer key -> 400"      "$(putcode "$JT" '{"questions":[{"type":"short_answer","text":"Broken","correctOptionId":"a","marks":1}]}' $BASE/api/exams/$E2/questions)" "400"

# --- visibility --------------------------------------------------------------
say "exam lists are scoped by role and class"
SL=$(curl -s -b "$JS" "$BASE/api/exams?limit=100")
expect "learner sees 3 published exams" "$(printf '%s' "$SL" | count '"id":"')" "3"
expect "learner never sees drafts"      "$(printf '%s' "$SL" | grep -c 'Draft paper')" "0"
expect "learner sees the live exam"     "$(printf '%s' "$SL" | grep -c 'Live CBT Quiz')" "1"
expect "learner in SS 1 sees 0 exams"   "$(printf '%s' "$(curl -s -b "$JS3" "$BASE/api/exams?limit=100")" | count '"id":"')" "0"
expect "staff see all 4 exams"          "$(printf '%s' "$(curl -s -b "$JT" "$BASE/api/exams?limit=100")" | count '"id":"')" "4"

# --- the exam window ---------------------------------------------------------
say "the exam window is enforced"
expect "start before opening -> 409"  "$(code -b "$JS" -X POST $BASE/api/exams/$E1/start)" "409"
expect "start after closing -> 409"   "$(code -b "$JS" -X POST $BASE/api/exams/$E3/start)" "409"
expect "wrong class -> 403"           "$(code -b "$JS3" -X POST $BASE/api/exams/$E2/start)" "403"
SA=$(json "$JS" '' $BASE/api/exams/$E2/start)
A1=$(fid "$SA")
expect "learner can start -> success" "$(printf '%s' "$SA" | count '"success":true')" "1"
expect "sitting carries a deadline"   "$(printf '%s' "$SA" | count '"deadlineAt":"')" "1"
SA2=$(json "$JS" '' $BASE/api/exams/$E2/start)
expect "start is idempotent"          "$(fid "$SA2")" "$A1"
expect "learner payload has no key"   "$(printf '%s' "$SA" | count '"correctOptionId"')" "0"
expect "question set delivered twice" "$(printf '%s' "$SA" | count '"type":"')" "6"

# --- autosave ----------------------------------------------------------------
say "PATCH /api/attempts/:id/answer — autosave"
expect "save correct MCQ -> 200"     "$(code -b "$JS" -X PATCH -H 'content-type: application/json' -d "{\"questionId\":\"$Q1\",\"response\":\"q1-b\"}" $BASE/api/attempts/$A1/answer)" "200"
expect "save wrong MCQ -> 200"       "$(code -b "$JS" -X PATCH -H 'content-type: application/json' -d "{\"questionId\":\"$Q2\",\"response\":\"q2-a\"}" $BASE/api/attempts/$A1/answer)" "200"
expect "save short answer -> 200"    "$(code -b "$JS" -X PATCH -H 'content-type: application/json' -d "{\"questionId\":\"$Q3\",\"response\":\"Draw a line through the top, then use alternate angles.\"}" $BASE/api/attempts/$A1/answer)" "200"
expect "foreign question id -> 400"  "$(code -b "$JS" -X PATCH -H 'content-type: application/json' -d "{\"questionId\":\"000000000000000000000000\",\"response\":\"x\"}" $BASE/api/attempts/$A1/answer)" "400"
AT=$(curl -s -b "$JS" $BASE/api/attempts/$A1)
expect "attempt still in progress"   "$(printf '%s' "$AT" | count '"status":"in_progress"')" "1"
expect "three responses stored"      "$(printf '%s' "$AT" | count '"questionId":"')" "3"
expect "resume payload hides key"    "$(printf '%s' "$AT" | count '"correctOptionId"')" "0"
expect "response text round-trips"   "$(printf '%s' "$AT" | grep -c 'alternate angles')" "1"

# --- integrity ---------------------------------------------------------------
say "POST /api/attempts/:id/tab-switch — integrity counter"
TAB1=$(json "$JS" '' $BASE/api/attempts/$A1/tab-switch)
expect "first switch counted"        "$(printf '%s' "$TAB1" | count '"tabSwitchCount":1')" "1"
json "$JS" '' $BASE/api/attempts/$A1/tab-switch >/dev/null   # second switch
TAB3=$(json "$JS" '' $BASE/api/attempts/$A1/tab-switch)       # third switch
expect "third switch flags sitting"  "$(printf '%s' "$TAB3" | count '"flagged":true')" "1"
expect "three switches recorded"     "$(printf '%s' "$TAB3" | count '"tabSwitchCount":3')" "1"

# --- attempt isolation -------------------------------------------------------
say "attempts are isolated per learner and per tenant"
S2=$(json "$JS2" '' $BASE/api/exams/$E2/start)
A2=$(fid "$S2")
expect "second learner starts own sitting" "$(printf '%s' "$S2" | count '"success":true')" "1"
expect "two distinct attempts"             "$([ "$A1" != "$A2" ] && echo yes || echo no)" "yes"
expect "learner 2 cannot read attempt 1"   "$(code -b "$JS2" $BASE/api/attempts/$A1)" "404"
expect "learner 2 cannot save into 1"      "$(code -b "$JS2" -X PATCH -H 'content-type: application/json' -d "{\"questionId\":\"$Q1\",\"response\":\"q1-b\"}" $BASE/api/attempts/$A1/answer)" "404"
expect "learner 2 cannot submit attempt 1" "$(code -b "$JS2" -X POST $BASE/api/attempts/$A1/submit)" "404"
expect "unknown attempt id -> 404"      "$(code -b "$JS2" $BASE/api/attempts/000000000000000000000000)" "404"
expect "staff can review a sitting"        "$(code -b "$JT" $BASE/api/attempts/$A1)" "200"
REG=$(curl -s -c "$JO" -H 'content-type: application/json' -d "{\"schoolName\":\"Hillcrest Academy\",\"location\":\"Abuja, Wuse\",\"ownerName\":\"Kelechi Obi\",\"email\":\"kelechi$(date +%s)@hillcrest.edu.ng\",\"password\":\"password123\"}" $BASE/api/auth/register)
expect "second tenant registers"           "$(printf '%s' "$REG" | count '"success":true')" "1"
expect "tenant B cannot read attempt"      "$(code -b "$JO" $BASE/api/attempts/$A1)" "404"
expect "tenant B cannot read exam"         "$(code -b "$JO" $BASE/api/exams/$E2)" "404"
expect "tenant B cannot read results"      "$(code -b "$JO" $BASE/api/exams/$E2/results)" "404"

# --- deadline ---------------------------------------------------------------
say "the deadline wins over a late write"
expect "learner 2 saves one answer"  "$(code -b "$JS2" -X PATCH -H 'content-type: application/json' -d "{\"questionId\":\"$Q1\",\"response\":\"q1-b\"}" $BASE/api/attempts/$A2/answer)" "200"
( cd "$APP" && node --input-type=module -e "
import mongoose from 'mongoose';
await mongoose.connect('mongodb://127.0.0.1:27017/campusflow');
await mongoose.connection.db.collection('examattempts').updateOne(
  { _id: new mongoose.Types.ObjectId('$A2') },
  { \$set: { deadlineAt: new Date(Date.now() - 60000) } });
await mongoose.disconnect();
" ) 2>/dev/null
expect "late write after deadline -> 409" "$(code -b "$JS2" -X PATCH -H 'content-type: application/json' -d "{\"questionId\":\"$Q2\",\"response\":\"q2-c\"}" $BASE/api/attempts/$A2/answer)" "409"
EXPIRED=$(curl -s -b "$JS2" $BASE/api/attempts/$A2)
expect "expired sitting auto-submits"  "$(printf '%s' "$EXPIRED" | count '"autoSubmitted":true')" "1"
expect "expired sitting leaves progress" "$(printf '%s' "$EXPIRED" | count '"status":"in_progress"')" "0"
expect "expired sitting scored 2/8"    "$(printf '%s' "$EXPIRED" | count '"totalScore":2')" "1"

# --- submit + grading --------------------------------------------------------
say "submit, auto-grade, then hand-grade the short answer"
expect "grade an open sitting -> 409" "$(code -b "$JT" -X PATCH -H 'content-type: application/json' -d "{\"answers\":[{\"questionId\":\"$Q3\",\"marksAwarded\":4}]}" $BASE/api/attempts/$A1/grade)" "409"
SUB=$(json "$JS" '' $BASE/api/attempts/$A1/submit)
expect "submit -> success"            "$(printf '%s' "$SUB" | count '"success":true')" "1"
expect "pending short answer waits"   "$(printf '%s' "$SUB" | count '"status":"submitted"')" "1"
expect "auto-grade totals 2 of 8"     "$(printf '%s' "$SUB" | count '"totalScore":2')" "1"
expect "max score is 8"               "$(printf '%s' "$SUB" | count '"maxScore":8')" "1"
expect "submit is idempotent"         "$(printf '%s' "$(json "$JS" '' $BASE/api/attempts/$A1/submit)" | count '"status":"submitted"')" "1"
RES1=$(curl -s -b "$JS" $BASE/api/attempts/$A1)
expect "result payload attached"      "$(printf '%s' "$RES1" | count '"rows":')" "1"
expect "result percent before grading" "$(printf '%s' "$RES1" | count '"percent":25')" "1"
expect "answer key still hidden"      "$(printf '%s' "$RES1" | count '"correctOptionId"')" "0"

QUEUE=$(curl -s -b "$JT" $BASE/api/grading/queue)
expect "queue holds one hand-grade"   "$(printf '%s' "$QUEUE" | count '"attemptId":"')" "1"
expect "queue points at this sitting" "$(printf '%s' "$QUEUE" | count "\"attemptId\":\"$A1\"" )" "1"
expect "queue carries the learner"    "$(printf '%s' "$QUEUE" | grep -c 'Chidinma Okeke')" "1"
expect "learner cannot read queue"    "$(code -b "$JS" $BASE/api/grading/queue)" "403"

GRADE=$(patch "$JT" "{\"answers\":[{\"questionId\":\"$Q3\",\"marksAwarded\":3,\"feedback\":\"Clear method, mind the units.\"}]}" $BASE/api/attempts/$A1/grade)
expect "grade recorded -> success"    "$(printf '%s' "$GRADE" | count '"success":true')" "1"
expect "attempt is fully graded"      "$(printf '%s' "$GRADE" | count '"status":"graded"')" "1"
expect "graded total is 5 of 8"       "$(printf '%s' "$GRADE" | count '"totalScore":5')" "1"
expect "feedback stored"              "$(printf '%s' "$GRADE" | grep -c 'mind the units')" "1"
expect "queue now empty"              "$(printf '%s' "$(curl -s -b "$JT" $BASE/api/grading/queue)" | count '"attemptId":"')" "0"

# --- results -----------------------------------------------------------------
say "results, distribution and my-results"
RESULT=$(curl -s -b "$JT" $BASE/api/exams/$E2/results)
expect "two finished sittings"        "$(printf '%s' "$RESULT" | count '"studentId":"')" "2"
expect "learner 1 scored 63%"         "$(printf '%s' "$RESULT" | count '"percent":63')" "1"
expect "learner 1 graded C"           "$(printf '%s' "$RESULT" | count '"grade":"C"')" "1"
expect "learner 1 flagged for review" "$(printf '%s' "$RESULT" | count '"flagged":true')" "1"
expect "flagged count is 1"           "$(printf '%s' "$RESULT" | count '"flaggedCount":1')" "1"
expect "class average across graded"  "$(printf '%s' "$RESULT" | count '"average":44')" "1"
DIST=$(printf '%s' "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.data.distribution.reduce((n,b)=>n+b.students,0))})')
expect "distribution totals two"      "$DIST" "2"
expect "learner cannot read results"  "$(code -b "$JS" $BASE/api/exams/$E2/results)" "403"

MINE=$(curl -s -b "$JS" $BASE/api/me/results)
expect "my results holds one sitting" "$(printf '%s' "$MINE" | count '"attemptId":"')" "1"
expect "my average is 63"             "$(printf '%s' "$MINE" | count '"average":63')" "1"
expect "result names the exam"        "$(printf '%s' "$MINE" | grep -c 'Live CBT Quiz')" "1"
expect "staff get an empty result set" "$(printf '%s' "$(curl -s -b "$JT" $BASE/api/me/results)" | count '"items":[]')" "1"

# --- locking -----------------------------------------------------------------
say "sittings lock the paper and the exam"
expect "questions locked after sitting" "$(putcode "$JT" "{\"questions\":[{\"type\":\"mcq\",\"text\":\"Rewrite\",\"options\":[{\"id\":\"a\",\"text\":\"1\"},{\"id\":\"b\",\"text\":\"2\"}],\"correctOptionId\":\"a\",\"marks\":1}]}" $BASE/api/exams/$E2/questions)" "409"
expect "exam with sittings cannot go"   "$(code -b "$JT" -X DELETE $BASE/api/exams/$E2)" "409"
expect "empty exam can be deleted"      "$(code -b "$JT" -X DELETE $BASE/api/exams/$E1)" "200"
expect "deleted exam is gone"           "$(code -b "$JT" $BASE/api/exams/$E1)" "404"
expect "learner cannot delete exams"    "$(code -b "$JS" -X DELETE $BASE/api/exams/$E3)" "403"

printf '\n%s\n' "$([ $FAIL -eq 0 ] && echo 'ALL PHASE-6 EXAM/CBT CHECKS PASSED' || echo 'THERE WERE FAILURES')"
exit $FAIL
