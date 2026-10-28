#!/bin/sh
# Phase 5 end-to-end checks: invoices (create/list/filter), Paystack behind
# `lib/payments/provider.ts` (simulated locally → live:false), verify settle,
# webhook signature rejection, RBAC and tenant isolation for the fees module.
BASE=${E2E_BASE:-http://127.0.0.1:3100}
APP=$(cd "$(dirname "$0")/.." && pwd)
DIR=${E2E_TMP:-$APP/.e2e}
mkdir -p "$DIR"
JA=$DIR/jar-p5-owner.txt
JC=$DIR/jar-p4-tenant.txt
JT=$DIR/jar-teacher.txt
JS=$DIR/jar-student.txt
rm -f "$JA"
FAIL=0

say() { printf '\n== %s\n' "$1"; }
expect() { # expect <label> <actual> <wanted>
  if [ "$2" = "$3" ]; then printf '  ok   %-52s %s\n' "$1" "$2"
  else printf '  FAIL %-52s got=%s want=%s\n' "$1" "$2" "$3"; FAIL=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json() { curl -s -b "$1" -H 'content-type: application/json' -d "$2" "$3"; }
fid() {
  v=$(printf '%s' "$1" | sed -n 's/.*"id":"\([a-f0-9]\{24\}\)".*/\1/p' | head -1)
  if [ "${#v}" -ge 24 ]; then printf '%.24s' "$v"; fi
}
hits() { printf '%s' "$1" | grep -c "$2"; }
rows() { printf '%s' "$1" | grep -o "$2" | wc -l | tr -d ' '; }

i=0
while [ $i -lt 90 ]; do
  if code "$BASE/auth" 2>/dev/null | grep -q 200; then break; fi
  i=$((i+1)); sleep 1
done
say "server ready after ${i}s"

expect "proprietor login -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -c "$JA" -H 'content-type: application/json' -d '{"email":"ada@greenfield.edu.ng","password":"password123"}' $BASE/api/auth/login)" "200"
SID=$(fid "$(curl -s -b "$JA" "$BASE/api/students?q=Chidinma")")

# --- invoices ----------------------------------------------------------------
say "POST/GET /api/invoices"
INV=$(json "$JA" "{\"studentId\":\"$SID\",\"amount\":96000,\"dueDate\":\"2027-03-15\",\"term\":\"Third Term\",\"items\":[{\"label\":\"Tuition\",\"amount\":90000},{\"label\":\"Levies\",\"amount\":6000}]}" $BASE/api/invoices)
IID=$(fid "$INV")
expect "create invoice -> success"  "$(hits "$INV" '"success":true')" "1"
expect "student name resolved"     "$(hits "$INV" '"student":"Chidinma Okeke"')" "1"
expect "amount kept as sent"       "$(hits "$INV" '"amount":96000')" "1"
expect "future due date Pending"   "$(hits "$INV" '"status":"Pending"')" "1"
expect "due date serialised"       "$(hits "$INV" '"dueDate":"2027-03-15"')" "1"
expect "term kept"                 "$(hits "$INV" '"term":"Third Term"')" "1"
INV2=$(json "$JA" "{\"studentId\":\"$SID\",\"amount\":45000,\"dueDate\":\"2020-05-02\"}" $BASE/api/invoices)
expect "past due date Overdue"     "$(hits "$INV2" '"status":"Overdue"')" "1"
expect "unknown student -> 400"    "$(code -b "$JA" -H 'content-type: application/json' -d '{"studentId":"000000000000000000000000","amount":1000,"dueDate":"2027-01-01"}' $BASE/api/invoices)" "400"
expect "zero amount -> 400"        "$(code -b "$JA" -H 'content-type: application/json' -d "{\"studentId\":\"$SID\",\"amount\":0,\"dueDate\":\"2027-01-01\"}" $BASE/api/invoices)" "400"
expect "nonexistent due date -> 400" "$(code -b "$JA" -H 'content-type: application/json' -d "{\"studentId\":\"$SID\",\"amount\":100,\"dueDate\":\"2026-02-30\"}" $BASE/api/invoices)" "400"
expect "invoice list total=2"      "$(hits "$(curl -s -b "$JA" "$BASE/api/invoices?limit=100")" '"total":2')" "1"
expect "filter Overdue -> 1"       "$(hits "$(curl -s -b "$JA" "$BASE/api/invoices?status=Overdue")" '"total":1')" "1"
expect "filter Pending -> 1"       "$(hits "$(curl -s -b "$JA" "$BASE/api/invoices?status=Pending")" '"total":1')" "1"
expect "filter Paid -> 0"          "$(hits "$(curl -s -b "$JA" "$BASE/api/invoices?status=Paid")" '"total":0')" "1"
expect "search by student name"    "$(hits "$(curl -s -b "$JA" "$BASE/api/invoices?q=Chidinma")" '"total":2')" "1"
expect "search by invoice number"  "$(rows "$(curl -s -b "$JA" "$BASE/api/invoices?q=INV")" '"id":"[a-f0-9]\{24\}"')" "2"

# --- initialize --------------------------------------------------------------
say "POST /api/payments/initialize"
INIT=$(json "$JA" "{\"invoiceId\":\"$IID\"}" $BASE/api/payments/initialize)
REF=$(printf '%s' "$INIT" | sed -n 's/.*"reference":"\([^"]*\)".*/\1/p')
expect "initialize -> success"     "$(hits "$INIT" '"success":true')" "1"
expect "simulated mode (live:false)" "$(hits "$INIT" '"live":false')" "1"
expect "checkout url returned"     "$(hits "$INIT" '"authorizationUrl":"http')" "1"
expect "reference has a value"     "$([ -n "$REF" ] && echo yes || echo no)" "yes"
expect "amount matches the invoice" "$(hits "$INIT" '"amount":96000')" "1"
INIT2=$(json "$JA" "{\"invoiceId\":\"$IID\"}" $BASE/api/payments/initialize)
REF2=$(printf '%s' "$INIT2" | sed -n 's/.*"reference":"\([^"]*\)".*/\1/p')
expect "retry reuses the reference" "$([ "$REF" = "$REF2" ] && echo yes || echo no)" "yes"
expect "foreign invoice -> 400"    "$(code -b "$JA" -H 'content-type: application/json' -d '{"invoiceId":"000000000000000000000000"}' $BASE/api/payments/initialize)" "400"
expect "anonymous initialize -> 401" "$(code -H 'content-type: application/json' -d "{\"invoiceId\":\"$IID\"}" $BASE/api/payments/initialize)" "401"

# --- verify ------------------------------------------------------------------
say "GET /api/payments/verify"
VER=$(curl -s -b "$JA" "$BASE/api/payments/verify?reference=$REF")
expect "verify -> success"         "$(hits "$VER" '"success":true')" "1"
expect "invoice settles to Paid"   "$(hits "$VER" '"status":"Paid"')" "1"
expect "payment amount kept"       "$(hits "$VER" '"amount":96000')" "1"
expect "reference echoed"          "$(hits "$VER" "\"paystackRef\":\"$REF\"" )" "1"
VER2=$(curl -s -b "$JA" "$BASE/api/payments/verify?reference=$REF")
expect "verify is idempotent"      "$(hits "$VER2" '"status":"Paid"')" "1"
expect "unknown reference -> 404"  "$(code -b "$JA" "$BASE/api/payments/verify?reference=cf_nope_123456")" "404"
expect "paid invoice hidden from Pending" "$(hits "$(curl -s -b "$JA" "$BASE/api/invoices?status=Pending")" '"total":0')" "1"
expect "paid invoice listed as Paid" "$(hits "$(curl -s -b "$JA" "$BASE/api/invoices?status=Paid")" '"total":1')" "1"
expect "paid invoice id matches"   "$(hits "$(curl -s -b "$JA" "$BASE/api/invoices?status=Paid")" "\"id\":\"$IID\"" )" "1"
expect "paid invoice re-pay -> 409" "$(code -b "$JA" -H 'content-type: application/json' -d "{\"invoiceId\":\"$IID\"}" $BASE/api/payments/initialize)" "409"
expect "payments list holds 1"     "$(rows "$(curl -s -b "$JA" $BASE/api/payments)" '"invoiceId":"[a-f0-9]\{24\}"')" "1"
expect "school feesCollected=96000" "$(hits "$(curl -s -b "$JA" $BASE/api/schools)" '"feesCollected":96000')" "1"

# --- webhook -----------------------------------------------------------------
say "POST /api/payments/webhook"
WBODY="{\"event\":\"charge.success\",\"data\":{\"reference\":\"$REF\",\"amount\":9600000,\"channel\":\"card\",\"paid_at\":\"2026-10-26T10:00:00.000Z\"}}"
expect "unsigned webhook -> 401"   "$(code -H 'content-type: application/json' -d "$WBODY" $BASE/api/payments/webhook)" "401"
expect "bad signature -> 401"      "$(code -H 'content-type: application/json' -H 'x-paystack-signature: deadbeef' -d "$WBODY" $BASE/api/payments/webhook)" "401"
expect "payment still intact"      "$(hits "$(curl -s -b "$JA" "$BASE/api/payments/verify?reference=$REF")" '"status":"Paid"')" "1"

# --- RBAC --------------------------------------------------------------------
say "fees RBAC"
expect "teacher invoices -> 403"   "$(code -b "$JT" $BASE/api/invoices)" "403"
expect "teacher payments -> 403"   "$(code -b "$JT" $BASE/api/payments)" "403"
expect "learner /fees page -> 307" "$(code -b "$JS" $BASE/fees)" "307"
expect "learner API invoices -> 403" "$(code -b "$JS" $BASE/api/invoices)" "403"
expect "anonymous invoices -> 401" "$(code "$BASE/api/invoices")" "401"

# --- tenant isolation --------------------------------------------------------
say "tenant isolation for fees"
expect "tenant C invoices empty"   "$(hits "$(curl -s -b "$JC" "$BASE/api/invoices?limit=100")" '"total":0')" "1"
expect "tenant C payments empty"   "$(rows "$(curl -s -b "$JC" $BASE/api/payments)" '"invoiceId"')" "0"
expect "tenant C cannot init A's invoice" "$(code -b "$JC" -H 'content-type: application/json' -d "{\"invoiceId\":\"$IID\"}" $BASE/api/payments/initialize)" "400"
expect "tenant C cannot verify A's ref" "$(code -b "$JC" "$BASE/api/payments/verify?reference=$REF")" "404"
expect "tenant C sees 0 collected" "$(hits "$(curl -s -b "$JC" $BASE/api/schools)" '"feesCollected":0')" "1"
expect "tenant C cannot create for A's student" "$(code -b "$JC" -H 'content-type: application/json' -d "{\"studentId\":\"$SID\",\"amount\":100,\"dueDate\":\"2027-01-01\"}" $BASE/api/invoices)" "400"

printf '\n%s\n' "$([ $FAIL -eq 0 ] && echo 'ALL PHASE-5 FEES CHECKS PASSED' || echo 'THERE WERE FAILURES')"
exit $FAIL
