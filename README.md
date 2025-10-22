# GigoNLbot_V4

Natural Language → Robot Command Translator with MQTT Dashboard

A complete robotics control system featuring:
- Flask backend with LLM integration (GROQ/OpenAI)
- Natural language command translation
- MQTT-based robot communication via HiveMQ Cloud
- Real-time admin dashboard for monitoring and control
- Micro:bit firmware for robot hardware

## Repository URL format to send to students

https://github.com/<your-username>/<repo-name>

Replace `<your-username>` and `<repo-name>` with your GitHub account and the repository name. Students will run:

```bash
git clone https://github.com/<your-username>/<repo-name>
cd <repo-name>
```

Quick start (for students)

1. Copy example env and edit the keys:

```bash
cp .env.example .env
# Edit .env and fill in GROQ_API_KEY or OPENAI_API_KEY and set PROVIDER accordingly
```

2. (Optional but recommended) Create virtual environment and install:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. Run the app:

```bash
python app.py
```

4. Open the UI in a browser:

```
http://127.0.0.1:8787
```

## Project Structure

- `app.py` - Flask backend with LLM translation engine
- `index.html` - Main user interface for sending commands
- `admin.html` - Teacher dashboard for monitoring all robots
- `microbit.ts` - Micro:bit firmware (TypeScript)
- `static/` - Static assets (images, etc.)
- `.env` - Environment configuration (API keys, provider selection)
- `requirements.txt` - Python dependencies

## How you (instructor) create the GitHub repo and push (one-time):

Using GitHub website:
- Create a new repository named `<repo-name>` under your account.
- Follow the web UI instructions to push an existing repository from the command line.

Using gh (GitHub CLI) if installed:

```bash
# initialize locally if you haven't yet
git init
git add --all
git commit -m "Initial: env-based config, README, .gitignore, example env"
# create a private repo (or remove --private for public)
gh repo create <your-username>/<repo-name> --private --source=. --remote=origin
# push the default branch
git push -u origin main
```

If you encounter macOS Xcode/git errors:
- You may be prompted to accept the Xcode license. Run:

```bash
sudo xcodebuild -license
```

or follow the system prompt and accept.

What URL to send students

Once pushed, send them the HTTPS URL exactly like this:

```
https://github.com/<your-username>/<repo-name>
```

Advanced: expose local app to students (optional)

If you want students to access your running instance over the internet for demo purposes, use a tunneling service (eg. ngrok). Example:

```bash
ngrok http 8787
```

Then send the generated `https://*.ngrok.app` URL to students.

## MQTT Setup

### HiveMQ Cloud Broker Configuration

The system uses HiveMQ Cloud for real-time robot communication:

- **Broker:** `a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud`
- **Ports:** 
  - `8883` (MQTTS - for firmware/backend)
  - `8884` (WSS - for web dashboards)
- **Credentials:** 
  - Username: `teacher`
  - Password: `Stylor123`
- **Web clients URL:** `wss://a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud:8884/mqtt`

### Admin Dashboard (`admin.html`)

Real-time monitoring and control interface for instructors:

1. Open `admin.html` in a browser (or serve via `python -m http.server 8787`)
2. Connection settings are pre-configured with HiveMQ credentials
3. Click **Connect** to start monitoring
4. Features:
   - Live robot status tracking
   - Team activity monitoring
   - Broadcast commands to all robots
   - Send targeted commands to specific teams
   - Real-time event logging with filters

### MQTT Topic Structure

- Root topic: `nlbot`
- Team topics: `nlbot/classA/TEAM01/evt` (events from robots)
- Command topics: `nlbot/classA/TEAM01/cmd` (commands to robots)

### Verify MQTT Connection (Optional)

```bash
python - <<'PY'
import ssl
import time
import paho.mqtt.client as mqtt

BROKER = "a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud"

connected = False

client = mqtt.Client(client_id="admin-doc-check", protocol=mqtt.MQTTv5, transport="websockets")
client.username_pw_set("teacher", "Stylor123")
client.tls_set(cert_reqs=ssl.CERT_REQUIRED)

def on_connect(_client, _userdata, _flags, reason_code, _properties):
    global connected
    print("Connected with:", reason_code.getName())
    connected = True
    _client.disconnect()

client.on_connect = on_connect
client.connect(BROKER, 8884, keepalive=60)

start = time.time()
while not connected and time.time() - start < 10:
	client.loop(timeout=1.0)
	time.sleep(0.1)

if not connected:
	raise SystemExit("Connection failed")
PY
```

You should see `Connected with: Success` if the credentials are accepted.

## Features

### Natural Language Processing
- Supports Thai and English commands
- LLM-powered command interpretation (GROQ or OpenAI)
- Fallback rule-based parsing
- Creative choreography for complex maneuvers (dance, spin, etc.)

### Robot Control
- Basic movements: forward, backward, left, right, stop
- Timed movements with duration control
- Distance measurement queries
- Continuous movement mode (duration: 0)

### Admin Dashboard
- Real-time monitoring of all connected robots
- Live event logging with customizable filters
- Broadcast commands to all teams
- Targeted commands to selected teams
- Team status tracking (active/idle)
- Watchlist feature for focused monitoring

### Micro:bit Integration
- TypeScript firmware for Micro:bit controllers
- MQTT communication with ESP32 bridge
- Command execution and acknowledgment
- Heartbeat system for connectivity monitoring

## Environment Variables

Configure in `.env` file:

```bash
# LLM Provider (GROQ or OPENAI)
PROVIDER=GROQ

# API Keys
GROQ_API_KEY=your_groq_key_here
OPENAI_API_KEY=your_openai_key_here

# Server Port (optional, defaults to 8787)
PORT=8787
```

## License

This project is for educational purposes.

---