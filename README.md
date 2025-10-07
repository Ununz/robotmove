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

---

If you want, I can also:
- Create the GitHub repo for you via the GitHub API (you'll need to provide a personal access token), or
- Add a small `LICENSE` file and tweak `README.md` language, or
- Automatically run the local `git` commands here (I couldn't earlier because the environment required agreeing to Xcode license).

Which would you like next?