"""
Final regression test suite — verifies patches did NOT break existing functionality
and that all new guards work correctly in context.
Covers: PIN wrappers, trigger path, esc() in HTML context, processPhotoSubmission
guards vs. valid submissions, internal callers of syncToBigQuery, saveAutoSplitProposals.
"""
import datetime, sys, random

GREEN = "\033[92m"; RED = "\033[91m"; BOLD = "\033[1m"; RESET = "\033[0m"
passed = 0; failed = 0

def ok(label):
    global passed; passed += 1
    print(f"  {GREEN}PASS{RESET} {label}")

def fail(label, got=None, exp=None):
    global failed; failed += 1
    print(f"  {RED}FAIL{RESET} {label}")
    if got is not None: print(f"       got: {repr(got)}  expected: {repr(exp)}")

def section(t): print(f"\n{BOLD}-- {t} --{RESET}")

def eq(label, got, exp):
    if got == exp: ok(label)
    else: fail(label, got, exp)

def true_(label, v):
    if v: ok(label)
    else: fail(label, v, True)

def false_(label, v):
    if not v: ok(label)
    else: fail(label, v, False)

# ── In-memory DB ──────────────────────────────────────────────────────────────
WEEK = "2026-04-21"; SEM = "Spring 2026"
SEED = {
    "members": [
        ["id","name","email","status","pledge_class","created_at"],
        ["M001","Alice Smith",  "alice@t.com","active",  "Fall 2024","2024-08-01"],
        ["M002","Bob O'Brien",  "bob@t.com",  "active",  "Fall 2024","2024-08-01"],
        ["M003","Carol White",  "carol@t.com","active",  "Spr 2025", "2025-01-10"],
        ["M004","Dave Brown",   "dave@t.com", "active",  "Fall 2025","2025-08-15"],
        ["M005","Eve Inactive", "eve@t.com",  "inactive","Fall 2024","2024-08-01"],
    ],
    "chore_assignments": [
        ["aid","member_id","chore_name","group_id","semester","assigned_at"],
        ["A001","M001","Kitchen Cleanup",   "GK",SEM,"2026-01-15"],
        ["A002","M002","Bathroom Cleaning", "GB",SEM,"2026-01-15"],
        ["A003","M003","Bathroom Cleaning", "GB",SEM,"2026-01-15"],
        ["A004","M004","Trash Duty",        "GT",SEM,"2026-01-15"],
    ],
    "submissions": [
        ["sid","member_id","chore_name","week_start","submitted_at",
         "photo_url","photo_hash","exif_date","auto_status","human_status","verified_by","notes"],
    ],
    "fines": [["fid","member_id","chore_name","week_start","reason","issued_at","issued_by"]],
    "config": [
        ["key","value"],
        ["semester",SEM],["week_start",WEEK],["officer_pin","9876"],
        ["officer_emails","officer@t.com"],["fine_amount","5"],
        ["photo_hash_threshold","10"],["exif_age_limit_days","8"],
    ],
    "logs": [["timestamp","level","function","message"]],
    "weekly_status": [["chore_name","members","submitted","auto_statuses","human_statuses"]],
}
DB = {}
def reset_db():
    global DB
    DB = {k:[list(r) for r in v] for k,v in SEED.items()}
reset_db()

uuid_c = [0]
def new_uuid():
    uuid_c[0] += 1; return f"{uuid_c[0]:032X}"

def get_config(k):
    for r in DB["config"][1:]:
        if r[0]==k: return r[1]
    return None
def set_config(k, v):
    for r in DB["config"][1:]:
        if r[0]==k: r[1]=v; return
    DB["config"].append([k,v])

def norm_date(v):
    if not v: return ""
    if isinstance(v, datetime.date): return v.strftime("%Y-%m-%d")
    return str(v).strip()[:10]

def hamming(h1, h2):
    if not h1 or not h2 or len(h1)!=len(h2): return 64
    return sum(1 for a,b in zip(h1,h2) if a!=b)

def compute_hash(bts):
    length = len(bts)
    if length < 100: return "0"*64
    start = min(512, length//10); span = length-start
    samples = []
    for i in range(64):
        pos = start + int((i/64)*span)
        b = bts[pos]; b = ((b%256)+256)%256
        samples.append(b)
    mean = sum(samples)/64
    return "".join("1" if v>=mean else "0" for v in samples)

def check_pin(supplied):
    stored = str(get_config("officer_pin") or "")
    if not stored: return True
    return str(supplied or "") == stored

# ── Patched processPhotoSubmission ────────────────────────────────────────────
def submit_photo(member_id, chore_name, image_bytes, client_date_iso=None):
    semester    = get_config("semester")
    week_start  = norm_date(get_config("week_start"))
    threshold   = int(get_config("photo_hash_threshold") or 10)
    age_limit   = int(get_config("exif_age_limit_days") or 8)

    mem_row = next((r for r in DB["members"][1:] if r[0]==member_id), None)
    if not mem_row or mem_row[3]!="active":
        return {"success":False,"autoStatus":"rejected","message":"Account not active."}

    assigned = any(r[1]==member_id and r[2]==chore_name and r[4]==semester
                   for r in DB["chore_assignments"][1:])
    if not assigned:
        return {"success":False,"autoStatus":"rejected","message":"Not assigned to this chore."}

    existing = DB["submissions"]
    for r in existing[1:]:
        if r[1]==member_id and r[2]==chore_name and norm_date(r[3])==week_start:
            if r[9]=="failed":
                return {"success":False,"autoStatus":"rejected",
                        "message":"An officer reviewed and failed your submission. Contact an officer."}
            return {"success":False,"autoStatus":"rejected",
                    "message":"Already submitted this week.","submissionId":r[0]}

    if len(image_bytes)<5120:
        return {"success":False,"autoStatus":"rejected","message":"Image too small."}

    photo_url = f"https://drive/{member_id}"
    new_hash  = compute_hash(image_bytes)
    auto_status="passed"; msg="Submitted!"; note=""

    if new_hash=="0"*64 or new_hash=="1"*64:
        auto_status="flagged"; msg="Degenerate image."; note="uniform hash"

    if auto_status=="passed":
        for r in existing[1:]:
            if r[2]!=chore_name: continue
            ex=str(r[6]);
            if not ex or len(ex)!=64: continue
            if ex==new_hash: auto_status="rejected"; msg="Exact dup."; note=f"dup {r[0]}"; break
            d=hamming(ex,new_hash)
            if d<threshold: auto_status="flagged"; msg="Near-dup."; note=f"near {r[0]}"; break

    photo_date=None
    if client_date_iso:
        try: photo_date=datetime.datetime.fromisoformat(client_date_iso.replace("Z",""))
        except: pass
    if photo_date and auto_status=="passed":
        diff=(datetime.datetime.now()-photo_date).total_seconds()/86400
        if diff<0: auto_status="flagged"; msg="Future date."; note=f"future:{photo_date}"
        elif diff>age_limit: auto_status="flagged"; msg=f"Old photo ({int(diff)}d)."; note=f"date:{photo_date}"

    sid="S"+new_uuid()[:8]
    DB["submissions"].append([sid,member_id,chore_name,week_start,
        datetime.datetime.now().isoformat(),photo_url,new_hash,
        client_date_iso or "",auto_status,"pending","",note])
    return {"success":auto_status!="rejected","autoStatus":auto_status,"submissionId":sid,"message":msg}

# ── runMondayReset (no PIN — for trigger/menu) ────────────────────────────────
emails_sent=[]
def run_monday_reset():
    semester=get_config("semester"); week_start=norm_date(get_config("week_start"))
    fine_amount=int(get_config("fine_amount") or 5); emails_raw=get_config("officer_emails") or ""
    submissions=DB["submissions"]; assignments=DB["chore_assignments"]
    members=DB["members"]; fines=DB["fines"]
    passed_set=set()
    for r in submissions[1:]:
        if norm_date(r[3])==week_start:
            if (r[8]=="passed" and r[9]!="failed") or r[9]=="verified":
                passed_set.add(r[1]+"|"+r[2])
    active={r[0] for r in members[1:] if r[3]=="active"}
    mem_name={r[0]:r[1] for r in members[1:]}
    fine_list=[]
    for r in assignments[1:]:
        if r[4]!=semester or r[1] not in active: continue
        if r[1]+"|"+r[2] not in passed_set:
            fine_list.append({"memberId":r[1],"memberName":mem_name.get(r[1]),"choreName":r[2]})
    for f in fine_list:
        fines.append(["F"+new_uuid()[:8],f["memberId"],f["choreName"],week_start,
                      "Missed submission",datetime.datetime.now().isoformat(),"system"])
    if fine_list and emails_raw:
        emails_sent.append({"to":emails_raw,"subject":f"Fines week of {week_start}"})
    DB["submissions"]=[submissions[0]]
    d=datetime.date.fromisoformat(week_start)
    next_w=(d+datetime.timedelta(days=7)).isoformat()
    set_config("week_start",next_w)
    return {"fines":len(fine_list),"next_week":next_w}

def run_monday_reset_web(pin):
    if not check_pin(pin): raise PermissionError("Unauthorized")
    return run_monday_reset()

# ── saveAutoSplitProposals (with PIN) ─────────────────────────────────────────
def save_proposals(proposals_json, pin):
    if not check_pin(pin):
        return {"success":False,"error":"Unauthorized"}
    proposals=__import__("json").loads(proposals_json)
    semester=get_config("semester")
    for p in proposals:
        DB["chore_assignments"].append(["A"+new_uuid()[:8],p["memberId"],p["choreName"],
            "G"+p["choreName"][:8].replace(" ",""),semester,datetime.datetime.now().isoformat()])
    return {"success":True,"saved":len(proposals)}

# ── esc() as patched (includes single-quote escaping) ─────────────────────────
def esc(s):
    return (str(s or "").replace("&","&amp;").replace("<","&lt;")
            .replace(">","&gt;").replace('"',"&quot;").replace("'","&#39;"))

# ═══════════════════════════════════════════════════════════════════════════════
# TEST SECTIONS
# ═══════════════════════════════════════════════════════════════════════════════

real_img  = bytes(range(256))*22               # 5632 bytes, varied
real_img2 = bytes([(x+100)%256 for x in range(256)])*22  # different varied image, hamming ~32 from real_img

# ── 1. PIN check helper ───────────────────────────────────────────────────────
section("1. _checkOfficerPin")
eq("correct PIN accepted",   check_pin("9876"), True)
false_("wrong PIN rejected",  check_pin("0000"))
false_("empty PIN rejected",  check_pin(""))
false_("None PIN rejected",   check_pin(None))

# Without configured PIN — should pass through
set_config("officer_pin",""); eq("no PIN configured -> open access", check_pin(""), True)
set_config("officer_pin","9876")  # restore

# ── 2. runMondayReset trigger path (NO args — simulates automatic trigger) ────
section("2. runMondayReset — trigger fires with no arguments")
reset_db(); emails_sent.clear()
submit_photo("M001","Kitchen Cleanup",real_img)

# Simulate trigger firing with NO pin — must not raise
try:
    res=run_monday_reset()
    true_("trigger call (no pin) completes without error", True)
    eq("correct fine count from trigger call", res["fines"], 3)  # M002,M003,M004 no-sub
except Exception as e:
    fail(f"trigger call raised: {e}")

# ── 3. runMondayResetWeb PIN gate ─────────────────────────────────────────────
section("3. runMondayResetWeb — PIN-protected web wrapper")
reset_db(); emails_sent.clear()
try:
    run_monday_reset_web("0000")
    fail("wrong PIN should have raised")
except PermissionError:
    ok("wrong PIN raises PermissionError")

reset_db()
try:
    res=run_monday_reset_web("9876")
    true_("correct PIN completes", True)
    true_("returns fines count", "fines" in res)
except Exception as e:
    fail(f"correct PIN raised: {e}")

# ── 4. processPhotoSubmission — valid happy path still works ──────────────────
section("4. processPhotoSubmission — valid submissions unbroken")
reset_db()

r=submit_photo("M001","Kitchen Cleanup",real_img)
eq("valid submission passes",          r["autoStatus"], "passed")
true_("success flag True",             r["success"])
true_("submission ID assigned",        r.get("submissionId","").startswith("S"))
eq("stored in DB",                     len(DB["submissions"]),2)  # header+1

r2=submit_photo("M002","Bathroom Cleaning",real_img)
eq("second valid member passes",       r2["autoStatus"], "passed")

r3=submit_photo("M003","Bathroom Cleaning",real_img2)
eq("third member (different chore group) passes", r3["autoStatus"], "passed")

# ── 5. Guard: inactive member still blocked ───────────────────────────────────
section("5. Guard: inactive member rejected")
reset_db()
r=submit_photo("M005","Kitchen Cleanup",real_img)
eq("inactive member rejected",  r["autoStatus"],"rejected")
false_("success=False",          r["success"])

# ── 6. Guard: unassigned member still blocked ─────────────────────────────────
section("6. Guard: unassigned member rejected")
reset_db()
r=submit_photo("M001","Trash Duty",real_img)  # M001 is assigned Kitchen, not Trash
eq("wrong chore rejected",  r["autoStatus"],"rejected")

# ── 7. Guard: double-submit blocked, distinct members of same chore unaffected ─
section("7. Guard: double-submit — distinct members sharing a chore unaffected")
reset_db()

r1=submit_photo("M002","Bathroom Cleaning",real_img)
eq("M002 first submit passes",          r1["autoStatus"],"passed")

# M003 is ALSO assigned to Bathroom Cleaning — different image → should pass
r2=submit_photo("M003","Bathroom Cleaning",real_img2)
eq("M003 (same chore, diff member) passes",  r2["autoStatus"],"passed")

# M002 tries to submit again → blocked
r3=submit_photo("M002","Bathroom Cleaning",bytes([100]*5200))
eq("M002 double-submit rejected",       r3["autoStatus"],"rejected")
true_("rejection message mentions week", "week" in r3["message"].lower())

# ── 8. Guard: officer-fail lock ───────────────────────────────────────────────
section("8. Guard: officer fail locks out re-submission")
reset_db()
r=submit_photo("M001","Kitchen Cleanup",real_img)
# officer marks failed
for row in DB["submissions"][1:]:
    if row[0]==r["submissionId"]: row[9]="failed"
r2=submit_photo("M001","Kitchen Cleanup",bytes([100]*5200))
eq("re-submit after officer fail rejected",  r2["autoStatus"],"rejected")
true_("message mentions officer",            "officer" in r2["message"].lower())

# ── 9. Guard: minimum size ────────────────────────────────────────────────────
section("9. Guard: minimum file size (< 5120 bytes)")
reset_db()
eq("4096 bytes rejected",  submit_photo("M001","Kitchen Cleanup",bytes(4096))["autoStatus"],"rejected")
eq("5119 bytes rejected",  submit_photo("M001","Kitchen Cleanup",bytes(5119))["autoStatus"],"rejected")
eq("5120 bytes accepted",  submit_photo("M001","Kitchen Cleanup",bytes(range(256))*20)["autoStatus"],"passed")

# ── 10. Guard: degenerate hash flagged ───────────────────────────────────────
section("10. Guard: solid-color / uniform image flagged")
reset_db()
solid=bytes([128]*6000)
r=submit_photo("M001","Kitchen Cleanup",solid)
eq("all-same-byte image flagged", r["autoStatus"],"flagged")
true_("not rejected — officer gets to review", r["success"])

# ── 11. Guard: future clientDate flagged ─────────────────────────────────────
section("11. Guard: future photo date flagged")
reset_db()
future=(datetime.datetime.now()+datetime.timedelta(days=3)).isoformat()+"Z"
r=submit_photo("M001","Kitchen Cleanup",real_img,future)
eq("future date flagged",  r["autoStatus"],"flagged")

# Verify non-future, non-old date passes normally
recent=datetime.datetime.now().isoformat()+"Z"
r2=submit_photo("M002","Bathroom Cleaning",real_img,recent)
eq("fresh date passes",    r2["autoStatus"],"passed")

# ── 12. saveAutoSplitProposals PIN gate ───────────────────────────────────────
section("12. saveAutoSplitProposals — PIN gate")
import json
reset_db()
proposals=[{"memberId":"M001","memberName":"Alice","choreName":"Kitchen Cleanup"},
           {"memberId":"M004","memberName":"Dave", "choreName":"Trash Duty"}]

r=save_proposals(json.dumps(proposals),"0000")
false_("wrong PIN rejected",    r["success"])
eq("error message present",     "Unauthorized" in r.get("error",""), True)

r2=save_proposals(json.dumps(proposals),"9876")
true_("correct PIN accepted",   r2["success"])
eq("2 proposals saved",         r2["saved"],2)

# ── 13. syncToBigQuery internal caller path ───────────────────────────────────
section("13. syncToBigQuery — internal callers unaffected by web wrapper")
# Verify that calling syncToBigQuery() (no pin, internal) would not be blocked.
# In the real GAS code, syncToBigQuery() has NO PIN check — only syncToBigQueryWeb(pin) does.
# We verify here that the calling pattern from endOfSemesterArchiveWeb is still valid.
# Simulated: endOfSemesterArchiveWeb checks PIN then calls syncToBigQuery() directly.
archive_calls=[]
def fake_sync(): archive_calls.append("sync_called")
def end_of_semester_web(pin):
    if not check_pin(pin): return {"success":False,"error":"Unauthorized"}
    fake_sync()  # ← simulates syncToBigQuery() internal call (no PIN arg)
    for name in ["chore_assignments","submissions","fines","weekly_status"]:
        DB[name]=[DB[name][0]]
    return {"success":True}

reset_db()
r=end_of_semester_web("0000")
false_("wrong PIN rejected",        r["success"])
eq("sync NOT called on bad PIN",    len(archive_calls),0)

r2=end_of_semester_web("9876")
true_("correct PIN accepted",       r2["success"])
eq("sync called internally",        archive_calls,["sync_called"])
eq("submissions cleared",           len(DB["submissions"]),1)
eq("members untouched",             len(DB["members"]),6)

# ── 14. esc() regression — single-quote escaping context ─────────────────────
section("14. esc() — single-quote escaping correct in all contexts")

# Standard HTML escaping still works
eq("& escaped",    esc("a&b"),        "a&amp;b")
eq("< escaped",    esc("<script>"),   "&lt;script&gt;")
eq("> escaped",    esc(">"),          "&gt;")
eq("\" escaped",   esc('"hi"'),       "&quot;hi&quot;")

# New: single quote escaped
eq("' escaped",    esc("O'Brien"),    "O&#39;Brien")

# XSS attempt via member name
xss='x\',\'x\');alert(1);//'
escaped=esc(xss)
false_("XSS payload: no raw single quote in output", "'" in escaped)
true_("XSS payload uses &#39;", "&#39;" in escaped)

# Verify &#39; inside innerHTML attribute is safe: browser decodes &#39; → '
# which is the correct value to pass to JS. This is proper HTML encoding.
_name = "Bob O'Brien"
rendered = f"onclick=\"openVerify('S001','{esc(_name)}','Trash Duty','verified')\""
false_("No raw single quote breaks attribute parsing", "Bob O'" in rendered)
true_("&#39; is in rendered attribute",  "&#39;" in rendered)

# None and empty handled
eq("None -> empty string",  esc(None),"")
eq("empty string -> empty", esc(""),  "")

# ── 15. Trigger handler name unaffected ──────────────────────────────────────
section("15. autoMondayTrigger handler name check")
# The trigger registers handler 'runMondayReset' (no pin). Verify it's still callable no-arg.
try:
    reset_db()
    r=run_monday_reset()   # simulates trigger firing — no args, no PIN
    true_("runMondayReset() callable with zero args", True)
    true_("returns expected keys", "fines" in r and "next_week" in r)
except TypeError as e:
    fail(f"runMondayReset() broke on no-arg call: {e}")

# ── 16. esc() in MemberView flag-modal context ────────────────────────────────
section("16. MemberView: esc() in onclick with apostrophe in chore name")
chore = "Brother's Kitchen Duty"
sub_id = "S00000001"
rendered = f"onclick=\"openFlagModal('{esc(sub_id)}', '{esc(chore)}')\""
false_("No raw quote breaks onclick", "Brother'" in rendered)
true_("&#39; present", "&#39;" in rendered)

# ── 17. Full Monday reset after all guards (integration) ─────────────────────
section("17. Integration: full week with guards, then Monday reset")
reset_db(); emails_sent.clear()

# Valid submissions
submit_photo("M001","Kitchen Cleanup",   real_img)
submit_photo("M002","Bathroom Cleaning", real_img)
# M003 submits a degenerate (flagged) photo — officer will review
submit_photo("M003","Bathroom Cleaning", bytes([128]*6000))
# M004 doesn't submit at all

# Officer verifies M003's flagged submission
for row in DB["submissions"][1:]:
    if row[1]=="M003": row[9]="verified"

res=run_monday_reset()
fine_members=[r[1] for r in DB["fines"][1:]]

eq("only M004 gets a fine (1 total)",  res["fines"],1)
true_("M001 not fined",                "M001" not in fine_members)
true_("M002 not fined",                "M002" not in fine_members)
true_("M003 not fined (verified)",     "M003" not in fine_members)
true_("M004 fined",                    "M004" in fine_members)
eq("submissions cleared after reset",  len(DB["submissions"]),1)
eq("week advanced",                    norm_date(get_config("week_start")),"2026-04-28")

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n{'='*55}")
print(f"  Results: {GREEN}{passed} passed{RESET}  |  {RED}{failed} failed{RESET}")
print(f"{'='*55}\n")
sys.exit(0 if not failed else 1)
