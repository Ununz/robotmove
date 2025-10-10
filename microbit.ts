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

// =================================================================
// --- 2. ฟังก์ชันควบคุมมอเตอร์และเซ็นเซอร์ (ไม่ต้องแก้ไข) ---
// =================================================================

function turnLeft(pwm: number) {
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 1)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 1)
}
function backward(pwm: number) {
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 0)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 1)
}
function turnRight(pwm: number) {
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 0)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 0)
}
function forward(pwm: number) {
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 1)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 0)
}
function halt() {
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
// --- 3. ฟังก์ชันสื่อสารกับ ESP32 (Command-based) ---
// =================================================================

// ตัวแปรสถานะ
let isConnected = false
let activeCommand = ""
let cmdQueue: string[] = []
let endTimeMs = 0

// ฟังก์ชันเหล่านี้จะสร้าง "คำสั่ง PUB" ให้ ESP32 นำไป Publish
function done(x: string) {
    if (isConnected) serial.writeLine(`PUB ${MY_EVT_TOPIC} DONE ${x}`)
}
function ack(x: string) {
    if (isConnected) serial.writeLine(`PUB ${MY_EVT_TOPIC} ACK ${x}`)
}
function warn(x: string) {
    if (isConnected) serial.writeLine(`PUB ${MY_EVT_TOPIC} ${x}`)
}
function dist(cm: number) {
    if (isConnected) serial.writeLine(`PUB ${MY_EVT_TOPIC} DIST ${cm}`)
}
function sys(msg: string) {
    if (isConnected) serial.writeLine(`PUB ${MY_EVT_TOPIC} SYS ${msg}`)
}
function heartbeat() {
    if (isConnected) sys(`heartbeat ${input.runningTime()}`)
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
// --- 5. การประมวลผลคำสั่ง และการทำงานหลัก ---
// =================================================================

function parseAndQueue(line: string) {
    const s = line.trim()
    if (!s) { return }

    if (startsWith(s, "STOP")) {
        halt()
        cmdQueue = []
        activeCommand = ""
        ack("STOP")
        done("STOP")
        return
    }

    if (startsWith(s, "DIST?")) {
        let cm = getDistanceCm()
        dist(cm)
        return
    }

    let op = s
    let sec = 1
    let parts = s.split(":")
    if (parts.length > 1) {
        let v = parseFloat(parts[1])
        if (!(isNaN(v))) { sec = v }
        op = parts[0]
    }

    if (["FWD", "BWD", "LEFT", "RIGHT"].indexOf(op) < 0) {
        warn(`WARN unknown ${s}`)
        return
    }

    ack(s)
    cmdQueue.push(`${op}:${sec}`)
}

// --- ส่วนของการเริ่มต้น ---
serial.redirect(
    SerialPin.P2,
    SerialPin.P1,
    BaudRate.BaudRate115200
)
halt()
basic.showString("A")

// --- Runner (ลูปการทำงานหลัก) ---
basic.forever(function () {
    // ส่ง Heartbeat ทุก 4 วินาที
    if (input.runningTime() % 4000 < 50) {
        heartbeat()
    }

    // จัดการคำสั่งที่กำลังทำงาน
    if (activeCommand) {
        // ตรวจสอบสิ่งกีดขวาง
        if (activeCommand.includes("FWD")) {
            let distance = getDistanceCm()
            if (distance > 0 && distance < STOP_DISTANCE_CM) {
                halt()
                warn(`WARN OBSTACLE at ${distance}cm`)
                basic.pause(50)
                done(activeCommand)
                activeCommand = ""
                cmdQueue = []
                basic.showIcon(IconNames.No)
                basic.pause(500)
                basic.clearScreen()
                return
            }
        }

        // ตรวจสอบหมดเวลา
        if (input.runningTime() >= endTimeMs) {
            halt()
            done(activeCommand)
            activeCommand = ""
            basic.clearScreen()
        }
        return
    }

    // ดึงคำสั่งใหม่จากคิวมาทำงาน
    if (cmdQueue.length > 0) {
        let cmd = cmdQueue.shift()
        if (cmd) {
            let parts = cmd.split(":")
            let op = parts[0]
            let sec = parseFloat(parts[1])

            if (sec > 0) {
                endTimeMs = input.runningTime() + sec * 1000
            } else {
                endTimeMs = 2147483647 // เวลาสูงสุดที่เป็นไปได้ (เหมือนไม่มีที่สิ้นสุด)
            }

            activeCommand = cmd
            if (op == "FWD") {
                basic.showArrow(ArrowNames.South)
                forward(drivePwm)
            } else if (op == "BWD") {
                basic.showArrow(ArrowNames.North)
                backward(drivePwm)
            } else if (op == "LEFT") {
                basic.showArrow(ArrowNames.East)
                turnLeft(TURN_PPM)
            } else if (op == "RIGHT") {
                basic.showArrow(ArrowNames.West)
                turnRight(TURN_PPM)
            } else {
                halt()
                activeCommand = ""
            }
        }
    }
})