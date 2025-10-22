# app.py
# ===============================================================
# FastAPI + MQTT bridge for NL→Command translation and dispatch
# Supports OpenAI or Groq LLM backends (choose via BACKEND env)
# Endpoints:
#   POST /translate  -> text -> strict robot command(s) -> MQTT
#   POST /send       -> strict command(s)              -> MQTT
# Strict command validator included (no prose allowed).
# ===============================================================

import os
import re
import time
from typing import Optional, List, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import paho.mqtt.client as mqtt

# -----------------------------
# Environment configuration
# -----------------------------
from dotenv import load_dotenv
load_dotenv()

BACKEND = os.getenv("BACKEND") or os.getenv("PROVIDER", "groq")
BACKEND = BACKEND.lower()  # "groq" | "openai"
MODEL = os.getenv("MODEL", "llama-3.1-8b-instant")       # or "gpt-4o-mini" / "gpt-5-turbo"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

MQTT_BROKER = os.getenv("MQTT_BROKER", "broker.hivemq.com")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "")
MQTT_PASS = os.getenv("MQTT_PASS", "")
DEFAULT_CMD_TOPIC = os.getenv("DEFAULT_CMD_TOPIC", "nlbot/classA/TEAM01-AB15/cmd")

ALLOW_ORIGINS = os.getenv("ALLOW_ORIGINS", "*")

# Fail fast on missing key when needed
if BACKEND == "openai" and not OPENAI_API_KEY:
    print("[WARN] BACKEND=openai but OPENAI_API_KEY is missing. /translate will 400 if used.")
if BACKEND == "groq" and not GROQ_API_KEY:
    print("[WARN] BACKEND=groq but GROQ_API_KEY is missing. /translate will 400 if used.")

# -----------------------------
# LLM client (lazy import)
# -----------------------------
_openai_client = None
_groq_client = None

def _ensure_llm():
    global _openai_client, _groq_client
    if BACKEND == "openai":
        if not OPENAI_API_KEY:
            raise HTTPException(400, detail="OPENAI_API_KEY missing for BACKEND=openai")
        if _openai_client is None:
            from openai import OpenAI  # type: ignore
            _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    elif BACKEND == "groq":
        if not GROQ_API_KEY:
            raise HTTPException(400, detail="GROQ_API_KEY missing for BACKEND=groq")
        if _groq_client is None:
            from groq import Groq  # type: ignore
            _groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        raise HTTPException(400, detail=f"Unsupported BACKEND: {BACKEND}")

SYSTEM_PROMPT = (
    "You are a translator that converts short natural-language sentences into compact robot control commands.\n"
    "Output ONLY commands in ASCII uppercase per this grammar; never explain:\n"
    "INSTRUCTION := one or more instructions separated by ';'\n"
    "- FWD:<seconds>\n- BWD:<seconds>\n- LEFT:<seconds>\n- RIGHT:<seconds>\n- STOP\n"
    "- PLAY <solfege sequence>\n"
    "- WATCH (COND) [FOR:<ms>] [HYS:<Δ>] [COOLDOWN:<ms>] -> <ACTIONSEQ>\n"
    "- WATCH1 (COND) [FOR:<ms>] [HYS:<Δ>] [COOLDOWN:<ms>] -> <ACTIONSEQ>\n"
    "- UNWATCH <SENSOR> | UNWATCH ALL\n"
    "- FWD_UNTIL:(COND),TO:<seconds>\n"
    "- MODE OBSTACLE_STOP <cm> | MODE CLEAR\n"
    "- DIST?\n- STATUS\n"
    "COND must be wrapped in parentheses: (CLAUSE) | (CLAUSE) AND (CLAUSE) | (CLAUSE) OR (CLAUSE)\n"
    "CLAUSE: DIST<|<=|>|>=<cm> | TEMP<|<=|>|>=<C> | VIB<|<=|>|>=<0..100>\n"
    "Actions: STOP | FWD:<t> | BWD:<t> | LEFT:<t> | RIGHT:<t> | PLAY <solfege> | MELODY <name>\n"
    "Examples: WATCH (DIST<=50) -> LEFT:1 | FWD_UNTIL:(TEMP>25),TO:5 | WATCH (DIST<30) AND (TEMP>20) -> STOP\n"
    "If motion has no duration in the user's request, default to 1 second. Use minimal valid commands only."
)

def llm_translate(user_text: str) -> str:
    _ensure_llm()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_text.strip()},
    ]
    kwargs = dict(
        model=MODEL,
        temperature=0.1,
        max_tokens=64,
        stop=["\n", "```"],
    )
    if BACKEND == "openai":
        resp = _openai_client.chat.completions.create(messages=messages, **kwargs)  # type: ignore
        return (resp.choices[0].message.content or "").strip()
    else:
        resp = _groq_client.chat.completions.create(messages=messages, **kwargs)  # type: ignore
        return (resp.choices[0].message.content or "").strip()

# -----------------------------
# Strict validator
# -----------------------------
# We validate per-instruction after splitting on ';'
SOLFEGE = r"(DO|RE|MI|FA|SO|LA|TI)( (DO|RE|MI|FA|SO|LA|TI))*"
NUM = r"(?:\d+(?:\.\d+)?)"
OP = r"(?:<=|>=|<|>|=)"
SENSOR = r"(?:DIST|TEMP|VIB)"
CLAUSE = rf"(?:{SENSOR}{OP}{NUM})"
COND = rf"(?:\({CLAUSE}\)(?: (?:AND|OR) \({CLAUSE}\))?)"
ACTION_STEP = rf"(?:STOP|FWD:{NUM}|BWD:{NUM}|LEFT:{NUM}|RIGHT:{NUM}|PLAY {SOLFEGE}|MELODY [A-Z0-9_\-]+)"
FLAGS = rf"(?: (?:FOR:{NUM}|HYS:{NUM}|COOLDOWN:{NUM}|EDGE:(?:UP|DOWN)))*"

RE_FWD    = re.compile(rf"^FWD:{NUM}$")
RE_BWD    = re.compile(rf"^BWD:{NUM}$")
RE_LEFT   = re.compile(rf"^LEFT:{NUM}$")
RE_RIGHT  = re.compile(rf"^RIGHT:{NUM}$")
RE_STOP   = re.compile(rf"^STOP$")
RE_PLAY   = re.compile(rf"^PLAY {SOLFEGE}$")
RE_WATCH  = re.compile(rf"^WATCH {COND}{FLAGS} -> {ACTION_STEP}(?:; ?{ACTION_STEP})?$")
RE_WATCH1 = re.compile(rf"^WATCH1 {COND}{FLAGS} -> {ACTION_STEP}(?:; ?{ACTION_STEP})?$")
RE_UNW    = re.compile(rf"^UNWATCH (?:ALL|DIST|TEMP|VIB)$")
RE_UNTIL  = re.compile(rf"^FWD_UNTIL:{COND},TO:{NUM}$")  # you can add BWD/LEFT/RIGHT variants later
RE_MODE   = re.compile(rf"^(?:MODE CLEAR|MODE OBSTACLE_STOP {NUM})$")
RE_DISTQ  = re.compile(rf"^DIST\?$")
RE_STATUS = re.compile(rf"^STATUS$")

def _canon_spaces(s: str) -> str:
    # Keep single spaces; uppercase; remove repeated spaces around punctuation.
    s = s.replace("->", " -> ").replace(",", ",").replace(";", " ; ")
    s = re.sub(r"\s+", " ", s).strip()
    return s.upper()

def validate_commands_line(cmd: str) -> Tuple[bool, Optional[str]]:
    # Split by ';' at top level (no nesting in our grammar)
    parts = [p.strip() for p in cmd.split(";") if p.strip()]
    if not parts:
        return False, "EMPTY"
    for p in parts:
        ok = any(regex.match(p) for regex in (
            RE_FWD, RE_BWD, RE_LEFT, RE_RIGHT, RE_STOP, RE_PLAY,
            RE_WATCH, RE_WATCH1, RE_UNW, RE_UNTIL, RE_MODE, RE_DISTQ, RE_STATUS
        ))
        if not ok:
            return False, f"BAD_INSTRUCTION: {p}"
    return True, None

# -----------------------------
# MQTT Client
# -----------------------------
mqtt_client = mqtt.Client()
if MQTT_USER or MQTT_PASS:
    mqtt_client.username_pw_set(MQTT_USER, MQTT_PASS)

def _on_connect(client, userdata, flags, rc, properties=None):
    print(f"[MQTT] Connected rc={rc}")

def _on_disconnect(client, userdata, rc, properties=None):
    print(f"[MQTT] Disconnected rc={rc}")

mqtt_client.on_connect = _on_connect
mqtt_client.on_disconnect = _on_disconnect
mqtt_client.connect_async(MQTT_BROKER, MQTT_PORT, keepalive=30)
mqtt_client.loop_start()

def publish_cmd(topic: str, cmd: str):
    mqtt_client.publish(topic, payload=cmd, qos=0, retain=False)

# -----------------------------
# Web app
# -----------------------------
app = FastAPI(title="Stylor NL→Command Translator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOW_ORIGINS.split(",")] if ALLOW_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranslateIn(BaseModel):
    text: str
    topic: Optional[str] = None

class SendIn(BaseModel):
    cmd: str
    topic: Optional[str] = None

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def root():
    return FileResponse("index.html")

@app.post("/translate")
def translate(inb: TranslateIn):
    txt = (inb.text or "").strip()
    if not txt:
        raise HTTPException(400, detail="Empty text")
    if len(txt) > 300:
        txt = txt[:300]
    cmd = _canon_spaces(llm_translate(txt))
    print(f"[LLM OUTPUT] Input: '{txt}' → Generated: '{cmd}'")
    ok, err = validate_commands_line(cmd)
    if not ok:
        print(f"[VALIDATION FAILED] {err}")
        raise HTTPException(400, detail=f"BAD_SYNTAX: {err}; ECHO={cmd}")
    topic = (inb.topic or DEFAULT_CMD_TOPIC).strip()
    publish_cmd(topic, cmd)
    return {"ok": True, "cmd": cmd, "topic": topic}

@app.post("/send")
def send(inb: SendIn):
    cmd = _canon_spaces(inb.cmd or "")
    if not cmd:
        raise HTTPException(400, detail="Empty cmd")
    ok, err = validate_commands_line(cmd)
    if not ok:
        raise HTTPException(400, detail=f"BAD_SYNTAX: {err}; ECHO={cmd}")
    topic = (inb.topic or DEFAULT_CMD_TOPIC).strip()
    publish_cmd(topic, cmd)
    return {"ok": True, "cmd": cmd, "topic": topic}

@app.get("/healthz")
def healthz():
    return {"ok": True, "backend": BACKEND, "model": MODEL}

# -----------------------------
# Run server
# -----------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8787"))
    print(f"Starting FastAPI server on port {port} with backend={BACKEND}, model={MODEL}")
    print(f"MQTT: {MQTT_BROKER}:{MQTT_PORT} -> topic={DEFAULT_CMD_TOPIC}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")