# GigoNLbot_V4

A minimal Natural Language → Robot command translator (Flask backend + static UI).

Repository URL format to send to students

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

How you (instructor) create the GitHub repo and push (one-time):

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

## HiveMQ Cloud setup for dashboards

- **Broker:** `a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud`
- **Ports:** `8883` (MQTTS) and `8884` (WSS)
- **Credentials:** username `teacher`, password `Stylor123`
- **Web clients:** use `wss://a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud:8884/mqtt`

To connect the instructor dashboard (`admin.html`):

1. Open the file in a browser (or serve the repo via `python -m http.server 8787`).
2. Ensure the broker URL, username, and password fields match the values above.
3. Click **Connect**; the badge should flip to “Live monitoring” once authenticated.

If you need to verify connectivity without a browser, activate the virtual environment and run the quick Python check:

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

---

If you want, I can also:
- Create the GitHub repo for you via the GitHub API (you'll need to provide a personal access token), or
- Add a small `LICENSE` file and tweak `README.md` language, or
- Automatically run the local `git` commands here (I couldn't earlier because the environment required agreeing to Xcode license).

Which would you like next?