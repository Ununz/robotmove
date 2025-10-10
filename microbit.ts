// =================================================================
// MQTT-Controlled Robot for BBC Micro:bit + ESP32
// =================================================================
// Architecture:
//   1. Configuration - WiFi/MQTT settings (EDIT THIS SECTION)
//   2. Motor Control - Hardware interface
//   3. Communication - MQTT messaging
//   4. Button Controls - User interface
//   5. Command Processing - Parse & validate commands
//   6. Command Execution - Execute & monitor commands
//   7. Main Loop - Orchestration
//
// To add new command: Update Section 5 (registry) & Section 6 (execution)
// =================================================================

// =================================================================
// --- 1. ส่วนตั้งค่าหลัก (แก้ไขเฉพาะส่วนนี้สำหรับหุ่นยนต์แต่ละตัว) ---
// =================================================================

let WIFI_SSID = "iPhone X"
let WIFI_PASS = "StylorSL"
let MQTT_BROKER = "broker.hivemq.com"
let MQTT_PORT = 1883

// *** กำหนด Topic ทั้งหมดที่นี่ ***
// 1. Base Topic ของหุ่นยนต์ตัวนี้ (ไม่มี /cmd หรือ /evt)
let MY_BASE_TOPIC = "nlbot/classA/TEAM01-AB15"
// 2. Topic ที่จะใช้ส่งสถานะกลับไป (/evt)
let MY_EVT_TOPIC = MY_BASE_TOPIC + "/evt"
// 3. Topic ที่จะรับคำสั่งส่วนตัว
let MY_CMD_TOPIC = MY_BASE_TOPIC + "/cmd"
// 4. Topic ที่จะรับคำสั่งระดับคลาส
let MY_CLASS_CMD_TOPIC = "nlbot/classA/cmd"
// 5. Topic ที่จะรับคำสั่ง Broadcast ทั้งหมด
let ALL_CMD_TOPIC = "nlbot/all/cmd"

// ตั้งค่าหุ่นยนต์
let drivePwm = 60
let TURN_PPM = 60
let US_TRIG = DigitalPin.P16
let US_ECHO = DigitalPin.P0
let STOP_DISTANCE_CM = 15

// Motor timing compensation
let MOTOR_SPINUP_MS = 150  // Calibrate: time for motor to reach full speed

// =================================================================
// --- 2. ฟังก์ชันควบคุมมอเตอร์และเซ็นเซอร์ (ไม่ต้องแก้ไข) ---
// =================================================================

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
function getDistanceCm(): number {
    pins.digitalWritePin(US_TRIG, 0)
    control.waitMicros(2)
    pins.digitalWritePin(US_TRIG, 1)
    control.waitMicros(10)
    pins.digitalWritePin(US_TRIG, 0)
    const d = pins.pulseIn(US_ECHO, PulseValue.High, 30000)
    const cm = d <= 0 ? -1 : Math.round(d / 58)
    return cm
}
function startsWith(s: string, prefix: string): boolean {
    return s.length >= prefix.length && s.indexOf(prefix) == 0
}

// =================================================================
// --- 3. Communication Layer (ESP32 & MQTT) ---
// =================================================================

// ตัวแปรสถานะ
let isConnected = false
let activeCommand = ""
let cmdQueue: string[] = []
let endTimeMs = 0
let stopRequested = false

// ฟังก์ชันส่งข้อความกลับผ่าน MQTT
function publishEvent(eventType: string, message: string) {
    if (isConnected) serial.writeLine(`PUB ${MY_EVT_TOPIC} ${eventType} ${message}`)
}

function done(x: string) {
    publishEvent("DONE", x)
}
function ack(x: string) {
    publishEvent("ACK", x)
}
function warn(x: string) {
    publishEvent("WARN", x)
}
function dist(cm: number) {
    publishEvent("DIST", `${cm}`)
}
function sys(msg: string) {
    publishEvent("SYS", msg)
}
function heartbeat() {
    sys(`heartbeat ${input.runningTime()}`)
}

// =================================================================
// --- 4. การควบคุมผ่านปุ่มกด และการรับข้อมูล ---
// =================================================================

// ปุ่ม A: สำหรับตั้งค่าและสั่งเชื่อมต่อ
input.onButtonPressed(Button.A, function () {
    basic.showIcon(IconNames.SmallHeart) // ใช้ไอคอนนาฬิกาที่ถูกต้อง

    serial.writeLine(`CFG WIFI "${WIFI_SSID}" "${WIFI_PASS}"`)
    basic.pause(200)
    serial.writeLine(`CFG MQTT "${MQTT_BROKER}" ${MQTT_PORT}`)
    basic.pause(200)
    serial.writeLine("CFG SAVE")
    basic.pause(500)
    serial.writeLine("CONNECT")
})

// ปุ่ม B: สำหรับตัดการเชื่อมต่อ
input.onButtonPressed(Button.B, function () {
    serial.writeLine("DISCONNECT")
    halt()
    activeCommand = ""
    cmdQueue = []
    basic.showString("A")
})

// ตัวรับข้อมูลจาก ESP32
MQTT.onEsp32DataReceived(function (raw) {
    const msg = raw.trim()
    if (!msg) { return }

    // --- จัดการข้อความ SYS จาก ESP32 ---
    if (startsWith(msg, "SYS ")) {
        if (msg.includes("wifi connecting")) {
            // *** FIXED: แก้ไขรูปแบบการแสดงผล LED ให้ถูกต้อง ***
            basic.showLeds(`
                . . . . .
                . . . . #
                . . . # .
                # . # . .
                . # . . .
                `)
        } else if (msg.includes("mqtt connecting")) {
            // *** FIXED: แก้ไขรูปแบบการแสดงผล LED ให้ถูกต้อง ***
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
            basic.pause(500)
            // เมื่อเชื่อมต่อสำเร็จ สั่ง Subscribe
            serial.writeLine(`SUB ${MY_CMD_TOPIC}`)
            basic.pause(150)
            serial.writeLine(`SUB ${MY_CLASS_CMD_TOPIC}`)
            basic.pause(150)
            serial.writeLine(`SUB ${ALL_CMD_TOPIC}`)
            basic.pause(300)
            basic.clearScreen()
        } else if (msg.includes("MQTT DISCONNECTED")) {
            isConnected = false
            basic.showIcon(IconNames.No)
            basic.pause(300)
            basic.clearScreen()
        }
        return
    }

    // --- จัดการข้อความ ERR จาก ESP32 ---
    if (startsWith(msg, "ERR ")) {
        basic.showIcon(IconNames.Sad)
        basic.pause(1000)
        basic.clearScreen()
        return
    }

    // --- กรองข้อความ ACK ---
    if (startsWith(msg, "ACK ")) {
        return
    }

    // ถ้าไม่ใช่ข้อความระบบข้างบน ก็คือ Payload คำสั่งจาก MQTT
    if (isConnected) {
        parseAndQueue(msg.toUpperCase())
    }
})

// =================================================================
// --- 5. Command Processing Layer ---
// =================================================================

// Command registry - เพิ่มคำสั่งใหม่ที่นี่
function isTimedCommand(cmdName: string): boolean {
    return ["FWD", "BWD", "LEFT", "RIGHT"].indexOf(cmdName) >= 0
}

function isImmediateCommand(cmdName: string): boolean {
    return cmdName == "STOP" || cmdName == "DIST?"
}

function isValidCommand(cmdName: string): boolean {
    return isTimedCommand(cmdName) || isImmediateCommand(cmdName)
}

function requiresObstacleCheck(cmdName: string): boolean {
    return cmdName == "FWD"
}

// Execute immediate commands (ไม่เข้าคิว)
function executeImmediateCommand(cmdName: string) {
    if (cmdName == "STOP") {
        stopRequested = true
        halt()
        cmdQueue = []
        activeCommand = ""
        ack("STOP")
        done("STOP")
    } else if (cmdName == "DIST?") {
        let cm = getDistanceCm()
        dist(cm)
    }
}

// Parse incoming command string
function parseAndQueue(line: string) {
    const s = line.trim()
    if (!s) { return }

    // Extract command name and duration
    let parts = s.split(":")
    let cmdName = parts[0]
    let duration = 1

    if (parts.length > 1) {
        let parsedDuration = parseFloat(parts[1])
        if (!isNaN(parsedDuration)) {
            duration = parsedDuration
        }
    }

    // Validate command
    if (!isValidCommand(cmdName)) {
        warn(`unknown ${s}`)
        return
    }

    // Handle immediate commands
    if (isImmediateCommand(cmdName)) {
        executeImmediateCommand(cmdName)
        return
    }

    // Queue timed commands
    if (isTimedCommand(cmdName)) {
        ack(s)
        cmdQueue.push(`${cmdName}:${duration}`)
    }
}

// --- ส่วนของการเริ่มต้น ---
serial.redirect(
    SerialPin.P2,
    SerialPin.P1,
    BaudRate.BaudRate115200
)
halt()
basic.showString("A")

// =================================================================
// --- 6. Command Execution Functions ---
// =================================================================

function executeCommand(cmdName: string, duration: number) {
    if (cmdName == "FWD") {
        forward(drivePwm)
    } else if (cmdName == "BWD") {
        backward(drivePwm)
    } else if (cmdName == "LEFT") {
        turnLeft(TURN_PPM)
    } else if (cmdName == "RIGHT") {
        turnRight(TURN_PPM)
    }

    // Set end time - add spinup compensation for accurate movement duration
    if (duration > 0) {
        endTimeMs = input.runningTime() + duration * 1000 + MOTOR_SPINUP_MS
    } else {
        endTimeMs = 2147483647
    }
}

function checkObstacleDetection(): boolean {
    if (activeCommand && requiresObstacleCheck(activeCommand.split(":")[0])) {
        let distance = getDistanceCm()
        if (distance > 0 && distance < STOP_DISTANCE_CM) {
            halt()
            warn(`OBSTACLE at ${distance}cm`)
            basic.pause(50)
            done(activeCommand)
            activeCommand = ""
            cmdQueue = []
            basic.showIcon(IconNames.No)
            basic.pause(500)
            basic.clearScreen()
            return true
        }
    }
    return false
}

function checkCommandTimeout(): boolean {
    if (input.runningTime() >= endTimeMs) {
        halt()
        done(activeCommand)
        activeCommand = ""
        return true
    }
    return false
}

function processNextCommand() {
    if (cmdQueue.length == 0) return

    let cmd = cmdQueue.shift()
    if (!cmd) return

    let parts = cmd.split(":")
    let cmdName = parts[0]
    let duration = parseFloat(parts[1])

    activeCommand = cmd
    executeCommand(cmdName, duration)
}

// =================================================================
// --- 7. Main Loop (Execution Engine) ---
// =================================================================

// --- Runner (ลูปการทำงานหลัก) ---
basic.forever(function () {
    // Priority 1: Handle STOP request immediately
    if (stopRequested) {
        stopRequested = false
        halt()
        cmdQueue = []
        activeCommand = ""
        return
    }

    // Priority 2: Send heartbeat
    if (input.runningTime() % 4000 < 50) {
        heartbeat()
    }

    // Priority 3: Monitor active command
    if (activeCommand) {
        // Check for obstacles
        if (checkObstacleDetection()) {
            return
        }

        // Check if command is complete
        if (checkCommandTimeout()) {
            // Command completed, will process next in next iteration
        }
        return
    }

    // Priority 4: Execute next command from queue
    processNextCommand()
})