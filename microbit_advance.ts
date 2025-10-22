// microbit_advance.ts
// ======================================================================
// Unified Behavior Engine for MQTT-Controlled Robot (micro:bit v2)
// - Keeps your existing motor & telemetry functions
// - Adds: WATCH/UNWATCH, WATCH1, *_UNTIL (compiled to temp rules),
//         MODE OBSTACLE_STOP, PLAY, DIST?, STATUS
// - Adaptive sampling: TEMP/VIB/DIST only when needed
// - Two MQTT subscriptions respected: per-team + per-class
// Serial protocol with ESP32 (unchanged style): CFG..., CONNECT, SUB, PUB...
// ======================================================================

// ===================== 1) Configuration (EDIT FOR YOUR CLASS) =====================
let WIFI_SSID = "iPhone X"
let WIFI_PASS = "StylorSL"
let MQTT_BROKER = "broker.hivemq.com"
let MQTT_PORT = 1883

// Topics
let MY_BASE_TOPIC = "nlbot/classA/TEAM01-AB15"
let MY_EVT_TOPIC = MY_BASE_TOPIC + "/evt"
let MY_CMD_TOPIC = MY_BASE_TOPIC + "/cmd"        // per-team
let MY_CLASS_CMD_TOPIC = "nlbot/classA/cmd"      // per-class

// Hardware pins / params
let drivePwm = 60
let TURN_PPM = 60
let US_TRIG = DigitalPin.P16
let US_ECHO = DigitalPin.P0
let DEFAULT_STOP_CM = 12
let MOTOR_SPINUP_MS = 150

// ===================== 2) Motor & basic helpers (KEPT) ============================
function turnLeft(pwm: number) {
    basic.showArrow(ArrowNames.East)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 1)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 1)
}
function backward(pwm: number) {
    basic.showArrow(ArrowNames.North)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 0)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 1)
}
function turnRight(pwm: number) {
    basic.showArrow(ArrowNames.West)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 0)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 0)
}
function forward(pwm: number) {
    basic.showArrow(ArrowNames.South)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 1)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 0)
}
function halt() {
    basic.clearScreen()
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, 0, 0)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, 0, 0)
}

// Ultrasonic read with early timeout (~10ms -> ~170cm), converted to cm.
// Called only by Sensor Mux, not arbitrarily in the loop.
function getDistanceCm(): number {
    pins.digitalWritePin(US_TRIG, 0)
    control.waitMicros(2)
    pins.digitalWritePin(US_TRIG, 1)
    control.waitMicros(10)
    pins.digitalWritePin(US_TRIG, 0)
    const d = pins.pulseIn(US_ECHO, PulseValue.High, 10000) // 10ms cap
    if (d <= 0) return -1
    let cm = Math.idiv(d, 58)
    return cm
}
function startsWith(s: string, prefix: string): boolean {
    return s.length >= prefix.length && s.indexOf(prefix) == 0
}

// ===================== 3) Telemetry (KEPT) =======================================
let isConnected = false
function publishEvent(kind: string, msg: string) {
    if (isConnected) {
        serial.writeLine(`PUB ${MY_EVT_TOPIC} ${kind} ${msg}`)
    }
}
function done(x: string) { publishEvent("DONE", x) }
function ack(x: string) { publishEvent("ACK", x) }
function warn(x: string) { publishEvent("WARN", x) }
function dist(cm: number) { publishEvent("DIST", `${cm}`) }
function sys(x: string) { publishEvent("SYS", x) }
function heartbeat() { sys(`heartbeat ${input.runningTime()}`) }

// ===================== 4) Behavior Engine Types & State ==========================
const TICK_MS = 20
const MAX_RULES = 6
const MAX_QUEUE = 6

type SensorId = "DIST" | "TEMP" | "VIB"
type Op = "<" | "<=" | ">" | ">=" | "="
type Logic = "A" | "A_AND_B" | "A_OR_B"

class Clause {
    sensor: SensorId; op: Op; threshold: number
    forMs: number; hys: number; edge: number /*0:none 1:UP 2:DOWN*/
    useDer: boolean; derWinMs: number
    useTmr: boolean; tmrMs: number
    // runtime
    upMs: number; last: number; armed: boolean
    constructor() {
        this.sensor = "DIST"; this.op = "<"; this.threshold = 0
        this.forMs = 0; this.hys = 0; this.edge = 0
        this.useDer = false; this.derWinMs = 0
        this.useTmr = false; this.tmrMs = 0
        this.upMs = 0; this.last = -9999; this.armed = true
    }
}
class Rule {
    id: number
    A: Clause; B: Clause; hasB: boolean; logic: Logic
    cooldownMs: number; oneShot: boolean
    expiresAt: number // for *_UNTIL temp rules
    cooldownUntil: number; active: boolean
    // Actions (1-2 tokens) like "STOP" or "RIGHT:0.5"
    actions: string[]
    constructor(id: number) {
        this.id = id; this.A = new Clause(); this.B = new Clause()
        this.hasB = false; this.logic = "A"
        this.cooldownMs = 500; this.oneShot = false
        this.expiresAt = 0; this.cooldownUntil = 0; this.active = true
        this.actions = []
    }
}

// Motion/action queue
let actionQueue: string[] = []
let activeMotion: string = ""          // e.g., "FWD:1.5"
let motionUntilMs = 0

// Rule table
let rules: Rule[] = []
let nextRuleId = 1
const MODE_RULE_ID = 999  // reserved for MODE OBSTACLE_STOP

// ===================== 5) Sensor Mux (adaptive) =================================
let needDIST = false, needTEMP = false, needVIB = false
let lastDistMs = 0, lastTempMs = 0, lastVibMs = 0
let S_DIST = -1, S_TEMP = 0, S_VIB = 0

// Simple smoothing for distance: reject absurd jumps >30cm
let prevDist = -1

function recomputeNeeds() {
    needDIST = false; needTEMP = false; needVIB = false
    // Rules drive needs
    for (let r of rules) if (r.active) {
        if (r.A.sensor == "DIST") needDIST = true
        if (r.A.sensor == "TEMP") needTEMP = true
        if (r.A.sensor == "VIB") needVIB = true
        if (r.hasB) {
            if (r.B.sensor == "DIST") needDIST = true
            if (r.B.sensor == "TEMP") needTEMP = true
            if (r.B.sensor == "VIB") needVIB = true
        }
    }
    // Active motion with *_UNTIL is represented by temp rule; nothing extra.
}

function sampleSensors(now: number) {
    // DIST @ ~20–25 Hz
    if (needDIST && now - lastDistMs >= 40) {
        lastDistMs = now
        let cm = getDistanceCm()
        if (cm >= 0) {
            if (prevDist >= 0 && Math.abs(cm - prevDist) > 30) {
                // jump reject: keep previous if absurd jump
                S_DIST = prevDist
            } else {
                S_DIST = cm
                prevDist = cm
            }
        }
    }
    // TEMP @ ~5–8 Hz
    if (needTEMP && now - lastTempMs >= 150) {
        lastTempMs = now
        S_TEMP = input.temperature()
    }
    // VIB @ ~50 Hz
    if (needVIB && now - lastVibMs >= 20) {
        lastVibMs = now
        // Normalize acceleration magnitude to ~0..100 scale
        let mag = input.acceleration(Dimension.Strength) // ~0..2048
        S_VIB = Math.min(100, Math.idiv(mag * 100, 2048))
    }
}

// Helper to read a sensor snapshot
function readSensor(s: SensorId): number {
    if (s == "DIST") return S_DIST
    if (s == "TEMP") return S_TEMP
    return S_VIB
}

// ===================== 6) Rule evaluation =======================================
function clauseTrue(c: Clause, now: number): boolean {
    let v = readSensor(c.sensor)
    if (v < 0 && c.sensor == "DIST") return false  // unknown distance -> don't trip

    // Hysteresis: adjust threshold depending on direction/op when not armed
    let thr = c.threshold
    // We maintain "armed" semantics: trip when armed, re-arm when back across hys
    let passed = false
    switch (c.op) {
        case "<": passed = (v < thr); break
        case "<=": passed = (v <= thr); break
        case ">": passed = (v > thr); break
        case ">=": passed = (v >= thr); break
        case "=": passed = (v == thr); break
    }

    // EDGE filter
    if (c.edge == 1 /*UP*/) {
        let prev = c.last
        c.last = v
        if (!(prev < thr && v >= thr)) passed = false
    } else if (c.edge == 2 /*DOWN*/) {
        let prev = c.last
        c.last = v
        if (!(prev > thr && v <= thr)) passed = false
    } else {
        c.last = v
    }

    // FOR window
    if (passed) c.upMs += TICK_MS
    else c.upMs = 0

    return (c.upMs >= c.forMs)
}

function evalRules(now: number) {
    // Remove expired temp rules (for *_UNTIL)
    for (let r of rules) if (r.active && r.expiresAt > 0 && now >= r.expiresAt) {
        r.active = false
    }

    for (let r of rules) {
        if (!r.active) continue
        if (now < r.cooldownUntil) continue

        // Evaluate A (& B)
        let aTrue = clauseTrue(r.A, now)
        let bTrue = r.hasB ? clauseTrue(r.B, now) : false
        let result = false
        if (r.logic == "A") result = aTrue
        else if (r.logic == "A_AND_B") result = aTrue && bTrue
        else result = aTrue || bTrue

        if (result) {
            // Fire actions: STOP should preempt immediately
            if (r.actions.length > 0) {
                let first = r.actions[0]
                if (first == "STOP") {
                    // Preempt
                    clearMotion()
                    // Clear queue or not? We'll clear to be safe in class.
                    actionQueue = []
                    // Execute STOP immediately
                    halt()
                    ack("STOP")
                    done("GUARD_TRIPPED")
                    publishEvent("EVT", eventNameForRule(r))
                } else {
                    // Insert at head to run next
                    for (let i = r.actions.length - 1; i >= 0; i--) {
                        enqueueFront(r.actions[i])
                    }
                    publishEvent("EVT", eventNameForRule(r))
                }
            } else {
                publishEvent("EVT", eventNameForRule(r))
            }

            r.cooldownUntil = now + r.cooldownMs
            if (r.oneShot) r.active = false
        }
    }
}
function eventNameForRule(r: Rule): string {
    // Minimal, readable event
    if (r.A.sensor == "DIST") return `OBSTACLE ${S_DIST}`
    if (r.A.sensor == "TEMP") return `TEMP_TRIP ${S_TEMP}`
    if (r.A.sensor == "VIB") return `VIB_TRIP ${S_VIB}`
    return "RULE_TRIP"
}

// ===================== 7) Action Runner =========================================
function enqueueAction(tok: string) {
    if (actionQueue.length >= MAX_QUEUE) { warn("QUEUE_FULL"); return }
    actionQueue.push(tok)
    ack(tok)
}
function enqueueFront(tok: string) {
    if (actionQueue.length >= MAX_QUEUE) { warn("QUEUE_FULL"); return }
    actionQueue.unshift(tok)
    ack(tok)
}
function clearMotion() {
    if (activeMotion) {
        halt()
        activeMotion = ""
        motionUntilMs = 0
    }
}
function startMotion(tok: string, now: number) {
    // tok like "FWD:1.5" | "LEFT:0.5"
    let parts = tok.split(":")
    let name = parts[0]
    let dur = 1
    if (parts.length > 1) {
        let f = parseFloat(parts[1])
        if (!isNaN(f)) dur = Math.max(0, f)
    }
    if (name == "FWD") forward(drivePwm)
    else if (name == "BWD") backward(drivePwm)
    else if (name == "LEFT") turnLeft(TURN_PPM)
    else if (name == "RIGHT") turnRight(TURN_PPM)

    activeMotion = tok
    motionUntilMs = now + Math.idiv(Math.round(dur * 1000), 1) + MOTOR_SPINUP_MS
}
function runActions(now: number) {
    // If motion active: check timeout
    if (activeMotion) {
        if (now >= motionUntilMs) {
            halt()
            done(activeMotion)
            activeMotion = ""
            motionUntilMs = 0
        }
        return
    }
    // No active motion: pull next action
    if (actionQueue.length == 0) return
    let tok = actionQueue.shift()
    if (!tok) return
    if (tok == "STOP") {
        clearMotion()
        halt()
        done("STOP")
        return
    }
    if (startsWith(tok, "PLAY ")) {
        // Non-blocking melody
        let s = tok.substr(5) // "DO RE MI"
        // Map simple solfege to note string (C D E F G A B = DO RE MI FA SO LA TI)
        // We'll use a basic mapping in C major, 4/4, 120 bpm
        let mapped = s.split("DO").join("C").split("RE").join("D").split("MI").join("E")
            .split("FA").join("F").split("SO").join("G").split("LA").join("A")
            .split("TI").join("B")
        music.setBuiltInSpeakerEnabled(true)
        music.startMelody(mapped.split(" "), MelodyOptions.Once)
        done(tok)
        return
    }
    // MOTION token
    startMotion(tok, now)
}

// ===================== 8) Parser + Compiler =====================================
// Tiny tokenizer + instruction handlers
function handleLine(lineRaw: string) {
    let s = lineRaw.trim()
    if (!s) return
    // Multiple instructions separated by ';'
    let parts = s.split(";")
    for (let i = 0; i < parts.length; i++) {
        let p = parts[i].trim()
        if (!p) continue
        if (!dispatchInstruction(p)) {
            warn(`unknown ${p}`)
        }
    }
}

function dispatchInstruction(p: string): boolean {
    // Simple classifiers
    if (p == "STOP") { clearMotion(); halt(); ack("STOP"); done("STOP"); return true }
    if (p == "DIST?") { let cm = getDistanceCm(); dist(cm); ack("DIST?"); return true }
    if (p == "STATUS") { emitStatus(); return true }
    if (startsWith(p, "PLAY ")) { enqueueAction(p); return true }
    if (startsWith(p, "FWD_UNTIL:")) { return compileUntil(p) }
    if (startsWith(p, "FWD:") || startsWith(p, "BWD:") || startsWith(p, "LEFT:") || startsWith(p, "RIGHT:")) {
        enqueueAction(p)
        return true
    }
    if (startsWith(p, "UNWATCH ")) { return cmdUnwatch(p) }
    if (startsWith(p, "WATCH1 ") || startsWith(p, "WATCH ")) { return cmdWatch(p) }
    if (startsWith(p, "MODE ")) { return cmdMode(p) }
    return false
}

function emitStatus() {
    let arr: string[] = []
    for (let r of rules) if (r.active) {
        let lhs = `${r.A.sensor}${r.A.op}${r.A.threshold}`
        if (r.hasB) {
            let rhs = `${r.B.sensor}${r.B.op}${r.B.threshold}`
            let mid = r.logic == "A_AND_B" ? " AND " : (r.logic == "A_OR_B" ? " OR " : " ")
            lhs = `(${lhs}${mid}${rhs})`
        }
        arr.push(`R${r.id}:${lhs}->${r.actions.join("+")}`)
    }
    publishEvent("SYS", `STATUS rules=[${arr.join(",")}] qlen=${actionQueue.length} active=${activeMotion}`)
}

function cmdMode(p: string): boolean {
    if (p == "MODE CLEAR") {
        // remove MODE rule
        for (let r of rules) if (r.id == MODE_RULE_ID) { r.active = false }
        ack(p)
        return true
    }
    if (startsWith(p, "MODE OBSTACLE_STOP ")) {
        let cm = parseFloat(p.substr("MODE OBSTACLE_STOP ".length))
        if (isNaN(cm)) { warn("bad mode"); return true }
        // Upsert special rule
        let r = rules.find(x => x.id == MODE_RULE_ID)
        if (!r) { r = new Rule(MODE_RULE_ID); rules.push(r) }
        r.active = true; r.oneShot = false; r.cooldownMs = 200
        r.A = new Clause(); r.A.sensor = "DIST"; r.A.op = "<"; r.A.threshold = cm
        r.A.forMs = 0; r.A.hys = 1; r.hasB = false; r.logic = "A"
        r.actions = ["STOP"]
        ack(p)
        recomputeNeeds()
        return true
    }
    return false
}

function cmdUnwatch(p: string): boolean {
    if (p == "UNWATCH ALL") {
        for (let r of rules) r.active = false
        ack(p); recomputeNeeds(); return true
    }
    // UNWATCH DIST|TEMP|VIB
    let sensor = p.substr("UNWATCH ".length)
    for (let r of rules) if (r.active) {
        if ((r.A.sensor == sensor) || (r.hasB && r.B.sensor == sensor)) {
            r.active = false
        }
    }
    ack(p); recomputeNeeds(); return true
}

function parseClause(txt: string, out: Clause): boolean {
    // Expect SENSOR OP NUM (e.g., DIST<10)
    let sensorStr = "";
    if (startsWith(txt, "DIST")) sensorStr = "DIST";
    else if (startsWith(txt, "TEMP")) sensorStr = "TEMP";
    else if (startsWith(txt, "VIB")) sensorStr = "VIB";
    else return false;

    let rest = txt.substr(sensorStr.length);
    let opStr = "";
    if (startsWith(rest, "<=")) opStr = "<=";
    else if (startsWith(rest, ">=")) opStr = ">=";
    else if (startsWith(rest, "<")) opStr = "<";
    else if (startsWith(rest, ">")) opStr = ">";
    else if (startsWith(rest, "=")) opStr = "=";
    else return false;

    let numStr = rest.substr(opStr.length);
    let num = parseFloat(numStr);
    if (isNaN(num)) return false;

    out.sensor = sensorStr as SensorId;
    out.op = opStr as Op;
    out.threshold = num;
    return true;
}

function cmdWatch(p: string): boolean {
    // WATCH[1]? COND [FLAGS] -> ACTION[; ACTION?]
    let oneShot = startsWith(p, "WATCH1 ")
    let body = oneShot ? p.substr(7) : p.substr(6)
    let arrow = body.indexOf("->")
    if (arrow < 0) { warn("watch no arrow"); return true }
    let condPart = body.substr(0, arrow).trim()
    let actionPart = body.substr(arrow + 2).trim()

    // Split FLAGS (FOR/HYS/COOLDOWN/EDGE) from cond if appended at end
    // We parse flags manually by splitting on spaces.
    let forMs = 0, hys = 0, cooldown = 500, edge = 0
    let parts = condPart.split(" ")
    let remainingCond = ""
    for (let part of parts) {
        if (startsWith(part, "FOR:")) {
            forMs = parseFloat(part.substr(4))
        } else if (startsWith(part, "HYS:")) {
            hys = parseFloat(part.substr(4))
        } else if (startsWith(part, "COOLDOWN:")) {
            cooldown = parseFloat(part.substr(9))
        } else if (startsWith(part, "EDGE:")) {
            let val = part.substr(5).toUpperCase()
            if (val == "UP") edge = 1
            else if (val == "DOWN") edge = 2
        } else {
            remainingCond += part + " "
        }
    }
    condPart = remainingCond.trim()

    // Helper to remove parentheses, as replace with regex is not supported
    function removeParens(s: string): string {
        return s.split("(").join("").split(")").join("")
    }

    // Parse COND with optional AND/OR (one only)
    let logic: Logic = "A"
    let hasB = false
    let partA = condPart
    let partB = ""
    if (condPart.indexOf(" AND ") >= 0) {
        let spl = condPart.split(" AND ")
        partA = removeParens(spl[0]).trim()
        partB = removeParens(spl[1]).trim()
        logic = "A_AND_B"; hasB = true
    } else if (condPart.indexOf(" OR ") >= 0) {
        let spl = condPart.split(" OR ")
        partA = removeParens(spl[0]).trim()
        partB = removeParens(spl[1]).trim()
        logic = "A_OR_B"; hasB = true
    } else {
        partA = removeParens(condPart).trim()
    }

    let r = new Rule(nextRuleId++)
    if (nextRuleId > 900) nextRuleId = 1 // wrap before MODE id
    if (!parseClause(partA, r.A)) { warn("bad clause A"); return true }
    r.A.forMs = forMs; r.A.hys = hys; r.A.edge = edge
    if (hasB) {
        if (!parseClause(partB, r.B)) { warn("bad clause B"); return true }
        r.B.forMs = forMs; r.B.hys = hys; r.B.edge = edge
    }
    r.hasB = hasB; r.logic = logic
    r.cooldownMs = cooldown; r.oneShot = oneShot
    r.expiresAt = 0

    // ACTIONSEQ: 1 or 2 steps separated by ';'
    let actParts = actionPart.split(";")
    for (let i = 0; i < actParts.length && i < 2; i++) {
        let t = actParts[i].trim()
        if (!t) continue
        r.actions.push(t)
    }
    if (r.actions.length == 0) { warn("watch no action"); return true }

    rules.push(r)
    ack((oneShot ? "WATCH1 " : "WATCH ") + condPart + " -> " + r.actions.join(" ; "))
    recomputeNeeds()
    return true
}

function compileUntil(p: string): boolean {
    // FWD_UNTIL:<COND>,TO:<seconds>
    // We implement only FWD_UNTIL for now (matches validator). Add others later similarly.
    let prefix = "FWD_UNTIL:";
    let body = p.substr(prefix.length);
    // ===== FIX: Replaced unsupported lastIndexOf with indexOf =====
    let toIndex = body.indexOf(",TO:");
    if (toIndex === -1) {
        warn("bad until"); return true
    }

    let cond = body.substr(0, toIndex).trim()
    let secStr = body.substr(toIndex + ",TO:".length);
    let sec = parseFloat(secStr)
    if (isNaN(sec) || sec <= 0) sec = 1

    // Enqueue motion
    enqueueAction(`FWD:${sec}`)

    // Install temp WATCH1 rule that triggers STOP; expires after sec
    let temporary = new Rule(nextRuleId++)
    temporary.oneShot = true
    temporary.cooldownMs = 0
    temporary.expiresAt = input.runningTime() + Math.idiv(Math.round(sec * 1000), 1)
    temporary.actions = ["STOP"]

    // Parse cond with optional AND/OR
    let logic: Logic = "A"
    let hasB = false
    let partA = cond, partB = ""
    if (cond.indexOf(" AND ") >= 0) {
        let spl = cond.split(" AND ")
        partA = spl[0].split("(").join("").split(")").join("").trim()
        partB = spl[1].split("(").join("").split(")").join("").trim()
        logic = "A_AND_B"; hasB = true
    } else if (cond.indexOf(" OR ") >= 0) {
        let spl = cond.split(" OR ")
        partA = spl[0].split("(").join("").split(")").join("").trim()
        partB = spl[1].split("(").join("").split(")").join("").trim()
        logic = "A_OR_B"; hasB = true
    } else {
        partA = cond.split("(").join("").split(")").join("").trim()
    }
    if (!parseClause(partA, temporary.A)) { warn("bad until clause A"); return true }
    if (hasB) {
        if (!parseClause(partB, temporary.B)) { warn("bad until clause B"); return true }
    }
    temporary.hasB = hasB; temporary.logic = logic

    rules.push(temporary)
    ack(p)
    recomputeNeeds()
    return true
}

// ===================== 9) Serial / MQTT bridge (ESP32) ==========================
input.onButtonPressed(Button.A, function () {
    basic.showIcon(IconNames.SmallHeart)
    serial.writeLine(`CFG WIFI "${WIFI_SSID}" "${WIFI_PASS}"`)
    basic.pause(200)
    serial.writeLine(`CFG MQTT "${MQTT_BROKER}" ${MQTT_PORT}`)
    basic.pause(200)
    serial.writeLine("CFG SAVE")
    basic.pause(400)
    serial.writeLine("CONNECT")
})

input.onButtonPressed(Button.B, function () {
    serial.writeLine("DISCONNECT")
    halt()
    actionQueue = []
    activeMotion = ""
    for (let r of rules) r.active = false
    recomputeNeeds()
    basic.showString("A")
})

MQTT.onEsp32DataReceived(function (raw) {
    const msg = raw.trim()
    if (!msg) return

    if (startsWith(msg, "SYS ")) {
        if (msg.includes("wifi connecting")) {
            basic.showLeds(`
                . . . . .
                . . . . #
                . . . # .
                # . # . .
                . # . . .
            `)
        } else if (msg.includes("mqtt connecting")) {
            basic.showLeds(`
                # . . . #
                . # . # .
                . . # . .
                . # . # .
                # . . . #
            `)
        } else if (msg.includes("MQTT CONNECTED")) {
            isConnected = true
            basic.showIcon(IconNames.Yes)
            basic.pause(400)
            // Respect TWO subscriptions only: team + class
            serial.writeLine(`SUB ${MY_CMD_TOPIC}`)
            basic.pause(150)
            serial.writeLine(`SUB ${MY_CLASS_CMD_TOPIC}`)
            basic.pause(150)
            basic.clearScreen()
            // Install default safety mode: OBSTACLE_STOP
            installOrUpdateMode(DEFAULT_STOP_CM)
        } else if (msg.includes("MQTT DISCONNECTED")) {
            isConnected = false
            basic.showIcon(IconNames.No)
            basic.pause(300)
            basic.clearScreen()
            halt()
        }
        return
    }
    if (startsWith(msg, "ERR ")) {
        basic.showIcon(IconNames.Sad); basic.pause(800); basic.clearScreen()
        return
    }
    if (startsWith(msg, "ACK ")) return

    // Payload from MQTT -> parse as commands
    if (isConnected) {
        handleLine(msg.toUpperCase())
    }
})

// Helper to (re)install MODE OBSTACLE_STOP rule at boot/connect
function installOrUpdateMode(cm: number) {
    let r = rules.find(x => x.id == MODE_RULE_ID)
    if (!r) { r = new Rule(MODE_RULE_ID); rules.push(r) }
    r.active = true; r.oneShot = false; r.cooldownMs = 200
    r.A = new Clause(); r.A.sensor = "DIST"; r.A.op = "<"; r.A.threshold = cm
    r.A.hys = 1; r.A.forMs = 0; r.hasB = false; r.logic = "A"
    r.actions = ["STOP"]
    recomputeNeeds()
    ack(`MODE OBSTACLE_STOP ${cm}`)
}

// ===================== 10) Init & Main loop =====================================
serial.redirect(SerialPin.P2, SerialPin.P1, BaudRate.BaudRate115200)
halt()
basic.showString("A")

basic.forever(function () {
    let now = input.runningTime()

    // Heartbeat
    if (now % 4000 < TICK_MS) heartbeat()

    // Adaptive idle: if no rules active and no motion -> do minimal work
    let anyActiveRule = false
    for (let r of rules) if (r.active) { anyActiveRule = true; break }

    if (!anyActiveRule && !activeMotion) {
        // No sampling; just drain action queue if any (e.g., STOP/PLAY)
        if (actionQueue.length > 0) runActions(now)
        basic.pause(TICK_MS)
        return
    }

    // Active behavior:
    recomputeNeeds()
    sampleSensors(now)
    evalRules(now)
    runActions(now)

    basic.pause(TICK_MS)
})