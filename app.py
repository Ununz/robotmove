# app.py — LLM-agnostic translator with a simple provider toggle (GROQ / OPENAI)
# Minimal changes: same endpoints/behavior; just add a tiny provider switch and keep the rest unchanged.

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json, re, os
from dotenv import load_dotenv

# Load .env when present (development convenience)
load_dotenv()

# =========================
# LLM PROVIDER TOGGLE (configured via environment variables)
# - Set PROVIDER to either "GROQ" or "OPENAI" in environment or .env
# - Set GROQ_API_KEY / OPENAI_API_KEY and optional PORT
PROVIDER = os.getenv("PROVIDER", "GROQ")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

PROVIDERS = {
    "GROQ": {
        "api_key": GROQ_API_KEY,
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.1-8b-instant",
    },
    "OPENAI": {
        "api_key": OPENAI_API_KEY,
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
}

# Port (can be overridden with env var PORT)
PORT = int(os.getenv("PORT", "8787"))

# Unified OpenAI-compatible client (works for both Groq and OpenAI)
try:
    from openai import OpenAI
    _cfg = PROVIDERS.get(PROVIDER, PROVIDERS["GROQ"])
    client = OpenAI(api_key=_cfg["api_key"], base_url=_cfg["base_url"]) if _cfg["api_key"] else None
    MODEL_NAME = _cfg["model"]
except Exception:
    client = None
    MODEL_NAME = None

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

# ---- Prompt (LLM must return ONLY a JSON object) ----
PROMPT = """You are an expert and creative robot command choreographer. Your task is to convert free-form user text (in Thai or English) into a structured JSON array of command objects.

Your entire response MUST be a single, valid JSON object in the format: {"commands": [ {<command_object_1>}, {<command_object_2>}, ... ]}.

Each command object in the array must have these fields:
- "action": (string, required) "forward", "backward", "left", "right", "stop", or "distance".
- "duration_s": (number, required) Duration in seconds.

Core Rules:
1.  **Standard Duration**: If the user specifies a time (e.g., "5 seconds", "10 วิ"), use that value for `duration_s`. If no time is specified, default to 1.0.
2.  **Indefinite Duration**: For continuous actions (e.g., "go forward until...", "เดินไปเรื่อยๆ"), you MUST use `duration_s: 0`.
3.  **Specific Actions**: For "stop" and "distance", `duration_s` MUST always be `0`.
4.  **Multiple Commands**: Deconstruct sequential user commands (e.g., "go forward then turn left") into a separate object for each action in the array.
5.  **Safety First**: If a command is unclear, ambiguous, or unsafe (e.g., "fly", "jump"), return an empty commands array: {"commands": []}.

**Creative Interpretation Rule:**
6.  **Complex Maneuvers**: For abstract commands like "dance", "spin around", "celebrate", or "เต้น", you must creatively choreograph a sequence of basic movements.
    -   **Use ONLY the 4 basic actions**: "forward", "backward", "left", "right".
    -   **Use short durations**: Each step in the sequence should have a short duration (e.g., between 0.4 and 1.2 seconds) to create a dynamic effect.
    -   **Be Creative**: The exact sequence can be different each time to seem more natural and less repetitive. Create a short sequence of 3 to 5 steps.

Examples:
- User: "go forward for 30 seconds"
  -> {"commands": [{"action": "forward", "duration_s": 30.0}]}
- User: "หยุด"
  -> {"commands": [{"action": "stop", "duration_s": 0}]}
- User: "เดินหน้าไปเรื่อยๆ เลย"
  -> {"commands": [{"action": "forward", "duration_s": 0}]}
- User: "what is the distance?"
  -> {"commands": [{"action": "distance", "duration_s": 0}]}
- User: "fly to the moon"
  -> {"commands": []}

Creative Examples:
- User: "dance for me" / "เต้นให้ดูหน่อย"
  -> {"commands": [{"action": "right", "duration_s": 0.8}, {"action": "left", "duration_s": 0.8}, {"action": "forward", "duration_s": 0.5}, {"action": "backward", "duration_s": 0.5}]}
  (Note: Another valid response could be a different sequence, e.g., left, right, backward, forward)
- User: "spin in a circle" / "หมุนเป็นวงกลม"
  -> {"commands": [{"action": "right", "duration_s": 0.7}, {"action": "right", "duration_s": 0.7}, {"action": "right", "duration_s": 0.7}, {"action": "right", "duration_s": 0.7}]}
- User: "move back and forth" / "ขยับไปมา"
  -> {"commands": [{"action": "forward", "duration_s": 1.0}, {"action": "backward", "duration_s": 1.0}]}
"""

def llm_translate(text: str):
    """Ask the LLM to produce {"commands":[{"action":"...","duration_s":...}, ...]}."""
    if not client or not MODEL_NAME:
        return None, "LLM disabled"
    try:
        resp = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[{"role":"system","content":PROMPT},{"role":"user","content":text}],
            temperature=0.2, max_tokens=200
        )
        content = (resp.choices[0].message.content or "").strip()
        # Strip possible code fences
        if content.startswith("```"):
            content = re.sub(r"^```[a-zA-Z0-9_-]*\n?|```\s*$", "", content).strip()
        data = json.loads(content)
        return data, None
    except Exception as e:
        return None, str(e)

def to_legacy_commands(obj):
    """Convert {"commands":[{"action":"forward","duration_s":1.5},...]}
       → {"commands":["FWD:1.5","RIGHT:0.8","STOP","DIST?"]} with NO duration limit."""
    out = []
    cmds = (obj or {}).get("commands", [])
    if not isinstance(cmds, list):
        return {"commands": []}
    for c in cmds:
        act = str(c.get("action","")).strip().lower()
        dur = c.get("duration_s", 1.0)
        try: dur = float(dur)
        except: dur = 1.0
        # No cap: honor requested duration
        dur = max(0.0, dur)
        if act == "stop":
            out.append("STOP")
        elif act in ("forward","backward","left","right"):
            op = {"forward":"FWD","backward":"BWD","left":"LEFT","right":"RIGHT"}[act]
            out.append(f"{op}:{dur:.3g}")
        elif act in ("distance","dist","measure"):
            out.append("DIST?")
    return {"commands": out}

# Fallback rules if LLM disabled/errors
def fallback_rules(text: str):
    s = re.sub(r"\s+"," ", text.strip().lower())
    parts = re.split(r"[;,]| then | และ | แล้ว ", s)
    res = []
    def secs(chunk, default=1.0):
        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|วินาที)\b", chunk)
        return float(m.group(1)) if m else default
    for p in parts:
        if not p: continue

        # Distance queries (EN/TH + raw DIST?)
        if p in ("dist","dist?") or "distance" in p or "measure" in p or "วัดระยะ" in p or "ระยะ" in p or "ระยะทาง" in p:
            res.append("DIST?"); continue

        if any(k in p for k in ("stop","หยุด")):
            res.append("STOP"); continue
        if any(k in p for k in ("forward","go forward","ahead","ไปข้างหน้า","เดินหน้า")):
            res.append(f"FWD:{max(secs(p,1.0),0.0)}"); continue
        if any(k in p for k in ("back","backward","go back","ถอยหลัง")):
            res.append(f"BWD:{max(secs(p,1.0),0.0)}"); continue
        if any(k in p for k in ("left","turn left","เลี้ยวซ้าย")):
            res.append(f"LEFT:{max(secs(p,1.0),0.0)}"); continue
        if any(k in p for k in ("right","turn right","เลี้ยวขวา")):
            res.append(f"RIGHT:{max(secs(p,1.0),0.0)}"); continue

        # Accept raw command lines, including DIST?
        m = re.match(r"^(FWD|BWD|LEFT|RIGHT|STOP|DIST\??)(?::(\d+(?:\.\d+)?))?$", p.strip().upper())
        if m:
            op, sec = m.group(1), m.group(2)
            if op.startswith("DIST"):
                res.append("DIST?")
            else:
                res.append(op if not sec else f"{op}:{max(float(sec),0.0)}")
    return {"commands": res}

@app.get("/")
def root():
    return send_from_directory(".", "index.html")

@app.post("/translate")
def translate():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"commands": []})
    obj, err = llm_translate(text)
    if err or not obj:
        return jsonify(fallback_rules(text))
    return jsonify(to_legacy_commands(obj))

@app.get("/health")
def health():
    return jsonify({"ok": True})

if __name__ == "__main__":
    print(f"Starting Robot Control Backend on port {PORT} with provider={PROVIDER}, model={MODEL_NAME}")
    app.run(host="127.0.0.1", port=PORT, debug=True)