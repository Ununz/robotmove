// Wifi_MQTT_Bridge_v2_3.ino — ESP32-C3 bridge (HiveMQ Cloud)
// - UART commands from micro:bit: CFG WIFI / CFG MQTT / CFG SAVE / CONNECT / SUB / PUB ...
// - Uses MQTT over TLS (port 8883). Default enables TLS (encryption).
// - For quickest success in class, this version enables encrypted TLS with certificate verification disabled.
//   If you want full verification, replace net.setInsecure(); with net.setCACert(root_ca) and ensure time sync.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <time.h>

// ---------------------- USER-CONFIG DEFAULTS (overridable via UART CFG) ----------------------
Preferences prefs;

String WIFI_SSID = "";
String WIFI_PASS = "";

// Use your HiveMQ Cloud cluster host here OR override from micro:bit via CFG
String MQTT_HOST = "a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud";
uint16_t MQTT_PORT = 8883;

// Optional auth (override from micro:bit via CFG)
String MQTT_USER = "teacher";
String MQTT_PASS = "Stylor123";

// UART wiring to micro:bit (cross TX<->RX and share GND)
const int UART_TX_PIN = 10;   // ESP32-C3 TX -> micro:bit RX (P1)
const int UART_RX_PIN = 9;    // ESP32-C3 RX <- micro:bit TX (P2)
HardwareSerial uart(1);

// MQTT client (TLS)
WiFiClientSecure net;
PubSubClient mqtt(net);

// Receive buffer for UART lines
static String rxBuf;

// (Optional) Root CA for full TLS verification (Let’s Encrypt ISRG Root X1).
// If you want strict verification, uncomment the next block and call net.setCACert(root_ca) in ensureMqtt().
// static const char* root_ca = R"PEM(
// -----BEGIN CERTIFICATE-----
// MIIFazCCA1OgAwIBAgISA5A1...
// -----END CERTIFICATE-----
// )PEM";

// ---------------------- SMALL STRING TOKENIZER (supports quoted values) ----------------------
struct Tokens {
  String t[8];
  int n = 0;
};

Tokens splitTokensQuoted(const String& line) {
  Tokens out;
  bool inQ = false;
  String cur;
  for (size_t i = 0; i < line.length(); ++i) {
    char c = line[i];
    if (c == '"') { inQ = !inQ; continue; }
    if (!inQ && isspace((unsigned char)c)) {
      if (cur.length()) {
        if (out.n < 8) out.t[out.n++] = cur;
        cur = "";
      }
    } else {
      cur += c;
    }
  }
  if (cur.length() && out.n < 8) out.t[out.n++] = cur;
  return out;
}

// ---------------------- UTIL ----------------------
void uartPrintln(const String& s) {
  uart.print(s);
  uart.print('\n');
}

void loadPrefs() {
  prefs.begin("gigo-bridge", true);
  WIFI_SSID = prefs.getString("ssid", WIFI_SSID);
  WIFI_PASS = prefs.getString("pass", WIFI_PASS);
  MQTT_HOST = prefs.getString("mhost", MQTT_HOST);
  MQTT_PORT = prefs.getUShort("mport", MQTT_PORT);
  MQTT_USER = prefs.getString("muser", MQTT_USER);
  MQTT_PASS = prefs.getString("mpass", MQTT_PASS);
  prefs.end();
}

void savePrefs() {
  prefs.begin("gigo-bridge", false);
  prefs.putString("ssid", WIFI_SSID);
  prefs.putString("pass", WIFI_PASS);
  prefs.putString("mhost", MQTT_HOST);
  prefs.putUShort("mport", MQTT_PORT);
  prefs.putString("muser", MQTT_USER);
  prefs.putString("mpass", MQTT_PASS);
  prefs.end();
}

// ---------------------- WIFI ----------------------
void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (WIFI_SSID.isEmpty()) { uartPrintln("ERR wifi ssid empty"); return; }

  uartPrintln("SYS wifi connecting...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID.c_str(), WIFI_PASS.c_str());
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(200);
  }
  if (WiFi.status() == WL_CONNECTED)
    uartPrintln("SYS wifi connected " + WiFi.localIP().toString());
  else
    uartPrintln("ERR wifi connect failed");
}

// ---------------------- MQTT ----------------------
void onMqttMessage(char* /*topic*/, byte* payload, unsigned int len) {
  for (unsigned int i = 0; i < len; ++i) uart.write(payload[i]);
  if (len == 0 || payload[len - 1] != '\n') uart.write('\n');
}

void ensureMqtt() {
  if (WiFi.status() != WL_CONNECTED) {
    uartPrintln("ERR wifi not connected, cannot connect MQTT");
    return;
  }
  if (mqtt.connected()) return;

  uartPrintln("SYS MQTT connecting...");

  // TLS setup
  // QUICK SUCCESS (encryption but no cert verification):
  net.setInsecure();

  // STRICT SECURITY (uncomment if you added a correct root_ca above):
  // net.setCACert(root_ca);

  mqtt.setServer(MQTT_HOST.c_str(), MQTT_PORT);
  mqtt.setKeepAlive(60);
  mqtt.setBufferSize(2048); // generous for classroom payloads

  String cid = "c3-" + String((uint32_t)esp_random(), HEX);
  bool connected = false;

  if (MQTT_USER.length() > 0) {
    connected = mqtt.connect(cid.c_str(), MQTT_USER.c_str(), MQTT_PASS.c_str());
  } else {
    connected = mqtt.connect(cid.c_str());
  }

  if (connected) {
    uartPrintln("SYS MQTT CONNECTED");
  } else {
    uartPrintln("ERR MQTT connect failed (code: " + String(mqtt.state()) + ")");
  }
}

// ---------------------- COMMAND HANDLERS ----------------------
void handleCfg(const Tokens& tk) {
  if (tk.n < 2) { uartPrintln("ERR CFG format"); return; }

  if (tk.t[1] == "WIFI") {
    if (tk.n >= 4) {
      WIFI_SSID = tk.t[2];
      WIFI_PASS = tk.t[3];
      uartPrintln("ACK CFG WIFI");
    } else {
      uartPrintln("ERR CFG WIFI need \"ssid\" \"pass\"");
    }
  } else if (tk.t[1] == "MQTT") {
    // Format 1: CFG MQTT "host" port
    // Format 2: CFG MQTT "host" port "username" "password"
    if (tk.n >= 4) {
      MQTT_HOST = tk.t[2];
      MQTT_PORT = (uint16_t)atoi(tk.t[3].c_str());
      if (tk.n >= 6) {
        MQTT_USER = tk.t[4];
        MQTT_PASS = tk.t[5];
        uartPrintln("ACK CFG MQTT with auth");
      } else {
        MQTT_USER = "";
        MQTT_PASS = "";
        uartPrintln("ACK CFG MQTT");
      }
    } else {
      uartPrintln("ERR CFG MQTT need \"host\" port [\"user\" \"pass\"]");
    }
  } else if (tk.t[1] == "SAVE") {
    savePrefs();
    uartPrintln("ACK CFG SAVE");
  } else if (tk.t[1] == "SHOW") {
    uartPrintln("CFG WIFI " + WIFI_SSID + " ********");
    uartPrintln("CFG MQTT " + MQTT_HOST + " " + String(MQTT_PORT));
    if (MQTT_USER.length() > 0) {
      uartPrintln("CFG AUTH " + MQTT_USER + " ********");
    }
  } else {
    uartPrintln("ERR CFG unknown");
  }
}

// ---------------------- UART LOOP ----------------------
void handleUartLine(String line) {
  line.trim();
  if (!line.length()) return;

  Tokens tk = splitTokensQuoted(line);
  if (tk.n == 0) return;

  String cmd = tk.t[0];
  cmd.toUpperCase();

  if (cmd == "CFG") {
    handleCfg(tk);
  } else if (cmd == "CONNECT") {
    ensureWifi();
    ensureMqtt();
  } else if (cmd == "DISCONNECT") {
    if (mqtt.connected()) mqtt.disconnect();
    if (WiFi.status() == WL_CONNECTED) WiFi.disconnect();
    uartPrintln("SYS MQTT DISCONNECTED");
  } else if (cmd == "SUB") {
    if (tk.n >= 2) {
      if (mqtt.connected()) {
        if (mqtt.subscribe(tk.t[1].c_str()))
          uartPrintln("ACK SUB " + tk.t[1]);
        else
          uartPrintln("ERR SUB failed " + tk.t[1]);
      } else {
        uartPrintln("ERR MQTT not connected, cannot SUB");
      }
    }
  } else if (cmd == "PUB") {
    if (tk.n >= 3) {
      if (mqtt.connected()) {
        String topic = tk.t[1];
        String message = line.substring(line.indexOf(tk.t[2]));
        message += '\n';
        mqtt.publish(topic.c_str(), message.c_str());
      } else {
        uartPrintln("ERR MQTT not connected, cannot PUB");
      }
    }
  } else {
    uartPrintln("ERR Unknown command: " + cmd);
  }
}

// ---------------------- SETUP & LOOP ----------------------
void setup() {
  Serial.begin(115200);
  uart.begin(115200, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);

  mqtt.setCallback(onMqttMessage);
  loadPrefs();

  uartPrintln("SYS boot");
}

void loop() {
  // Read UART lines
  while (uart.available()) {
    char c = (char)uart.read();
    if (c == '\r') continue;
    if (c == '\n') {
      String line = rxBuf;
      rxBuf = "";
      handleUartLine(line);
    } else {
      if (rxBuf.length() < 512) rxBuf += c;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (!mqtt.connected()) {
      static unsigned long lastTry = 0;
      if (millis() - lastTry > 5000) {
        lastTry = millis();
        ensureMqtt();
      }
    } else {
      mqtt.loop();
    }
  }
}