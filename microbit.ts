/**
 * micro:bit control for ESP32-C3 bridge via UART
 * 
 * Button A sends CFG + SAVE + CONNECT to the ESP32-C3
 * 
 * Subscribes to team/class/all topics after "MQTT CONNECTED" banner received over UART
 */

// --- Group 1: Configuration & Variables ---

// Robot settings
let MOTOR_SPINUP_MS = 150
let STOP_DISTANCE_CM = 15
let US_TRIG = DigitalPin.P16
let US_ECHO = DigitalPin.P0
let TURN_PPM = 60
let drivePwm = 60

// Network Configuration
let WIFI_SSID = "iPhone X"
let WIFI_PASS = "StylorSL"
let MQTT_BROKER = "a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud"
let MQTT_PORT = 8883
let MQTT_USERNAME = "teacher"
let MQTT_PASSWORD = "Stylor123"

// MQTT Topics
let MY_BASE_TOPIC = "nlbot/classA/TEAM01-AB10"
let MY_EVT_TOPIC = `${MY_BASE_TOPIC}/evt`
let MY_CMD_TOPIC = `${MY_BASE_TOPIC}/cmd`
let MY_CLASS_CMD_TOPIC = "nlbot/classA/cmd"
let ALL_CMD_TOPIC = "nlbot/all/cmd"

// Program State Variables
let cmdQueue: string[] = []
let activeCommand = ""
let endTimeMs = 0
let isConnected = false
let stopRequested = false
let distance = 0
let parts: string[] = []
let cmdName = ""
let duration = 0
let parsedDuration = 0
let parts2: string[] = []
let cmd = ""
let cmdName2 = ""
let duration2 = 0
let cm2 = 0

// Initial Setup
serial.redirect(SerialPin.P2, SerialPin.P1, BaudRate.BaudRate115200)
halt()
basic.showString("A")


// --- Group 2: Basic Robot Control ---

function forward(pwm: number) {
    basic.showArrow(ArrowNames.South)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 1)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 0)
}

function backward(pwm: number) {
    basic.showArrow(ArrowNames.North)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 0)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 1)
}

function turnLeft(pwm: number) {
    basic.showArrow(ArrowNames.East)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 1)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 1)
}

function turnRight(pwm: number) {
    basic.showArrow(ArrowNames.West)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, pwm, 0)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, pwm, 0)
}

function halt() {
    basic.clearScreen()
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorB, 0, 0)
    RoboticsWorkshop.DDMmotor2(MotorChannel.MotorC, 0, 0)
}


// --- Group 3: Sensor Interaction ---

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

function checkObstacleDetection(): boolean {
    if (activeCommand && requiresObstacleCheck(activeCommand.split(":")[0])) {
        distance = getDistanceCm()
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

function requiresObstacleCheck(cmdName: string): boolean {
    return cmdName == "FWD"
}


// --- Group 4: Button Controls ---

input.onButtonPressed(Button.A, function () {
    basic.showIcon(IconNames.Chessboard)
    serial.writeLine(`CFG WIFI "${WIFI_SSID}" "${WIFI_PASS}"`)
    basic.pause(200)
    serial.writeLine(`CFG MQTT "${MQTT_BROKER}" ${MQTT_PORT} "${MQTT_USERNAME}" "${MQTT_PASSWORD}"`)
    basic.pause(200)
    serial.writeLine("CFG SAVE")
    basic.pause(400)
    serial.writeLine("CONNECT")
})

input.onButtonPressed(Button.B, function () {
    serial.writeLine("DISCONNECT")
    halt()
    activeCommand = ""
    cmdQueue = []
    basic.showString("A")
})


// --- Group 5: Command Processing ---

function processNextCommand() {
    if (cmdQueue.length == 0) {
        return
    }
    cmd = cmdQueue.shift()
    if (!cmd) {
        return
    }
    parts2 = cmd.split(":")
    cmdName2 = parts2[0]
    duration2 = parseFloat(parts2[1])
    activeCommand = cmd
    executeCommand(cmdName2, duration2)
}

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

    if (duration > 0) {
        endTimeMs = input.runningTime() + duration * 1000 + MOTOR_SPINUP_MS
    } else {
        // Run forever if duration is 0 or less
        endTimeMs = 2147483647
    }
}

function executeImmediateCommand(cmdName: string) {
    if (cmdName == "STOP") {
        stopRequested = true
        halt()
        cmdQueue = []
        activeCommand = ""
        ack("STOP")
        done("STOP")
    } else if (cmdName == "DIST?") {
        cm2 = getDistanceCm()
        dist(cm2)
    }
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

function isValidCommand(cmdName: string): boolean {
    return isTimedCommand(cmdName) || isImmediateCommand(cmdName)
}

function isTimedCommand(cmdName: string): boolean {
    return ["FWD", "BWD", "LEFT", "RIGHT"].indexOf(cmdName) >= 0
}

function isImmediateCommand(cmdName: string): boolean {
    return cmdName == "STOP" || cmdName == "DIST?"
}


// --- Group 6: Communication (UART/MQTT) ---

// Receive data from ESP32
MQTT.onEsp32DataReceived(function (raw) {
    const msg = raw.trim()
    if (!msg) {
        return
    }
    if (startsWith(msg, "SYS ")) {
        if (msg.includes("wifi connecting")) {
            basic.showIcon(IconNames.Yes)
        } else if (msg.includes("mqtt connecting")) {
            basic.showIcon(IconNames.Chessboard)
        } else if (msg.includes("MQTT CONNECTED")) {
            isConnected = true
            basic.showIcon(IconNames.Yes)
            basic.pause(400)
            serial.writeLine(`SUB ${MY_CMD_TOPIC}`)
            basic.pause(120)
            serial.writeLine(`SUB ${MY_CLASS_CMD_TOPIC}`)
            basic.pause(120)
            serial.writeLine(`SUB ${ALL_CMD_TOPIC}`)
            basic.pause(200)
            basic.clearScreen()
        } else if (msg.includes("MQTT DISCONNECTED")) {
            isConnected = false
            basic.showIcon(IconNames.No)
            basic.pause(250)
            basic.clearScreen()
        }
        return
    }
    if (startsWith(msg, "ERR ")) {
        basic.showIcon(IconNames.Sad)
        basic.pause(800)
        basic.clearScreen()
        return
    }
    if (startsWith(msg, "ACK ")) {
        return
    }
    if (isConnected) {
        parseAndQueue(msg.toUpperCase())
    }
})

// Parse incoming commands and add to queue
function parseAndQueue(line: string) {
    const s = line.trim()
    if (!s) {
        return
    }
    parts = s.split(":")
    cmdName = parts[0]
    duration = 1
    if (parts.length > 1) {
        parsedDuration = parseFloat(parts[1])
        if (!isNaN(parsedDuration)) {
            duration = parsedDuration
        }
    }
    if (!isValidCommand(cmdName)) {
        warn(`unknown ${s}`)
        return
    }
    if (isImmediateCommand(cmdName)) {
        executeImmediateCommand(cmdName)
        return
    }
    if (isTimedCommand(cmdName)) {
        ack(s)
        cmdQueue.push(`${cmdName}:${duration}`)
    }
}

// Helper functions for publishing events
function publishEvent(eventType: string, message: string) {
    if (isConnected) {
        serial.writeLine(`PUB ${MY_EVT_TOPIC} ${eventType} ${message}`)
    }
}
function ack(x: string) { publishEvent("ACK", x) }
function done(x: string) { publishEvent("DONE", x) }
function warn(x: string) { publishEvent("WARN", x) }
function dist(cm: number) { publishEvent("DIST", `${cm}`) }
function sys(msg: string) { publishEvent("SYS", msg) }
function heartbeat() { sys(`heartbeat ${input.runningTime()}`) }

// Utility function
function startsWith(s: string, prefix: string): boolean {
    return s.length >= prefix.length && s.indexOf(prefix) == 0
}


// --- Group 7: Main Loop ---

basic.forever(function () {
    if (stopRequested) {
        stopRequested = false
        halt()
        cmdQueue = []
        activeCommand = ""
        return
    }

    if (input.runningTime() % 4000 < 50) {
        heartbeat()
    }

    if (activeCommand) {
        if (checkObstacleDetection()) {
            return
        }
        if (checkCommandTimeout()) {
            // Timeout handled inside the function
        }
        return
    }

    processNextCommand()
})