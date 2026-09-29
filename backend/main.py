import os
import datetime
import json
import re
import httpx
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Emotionally Aware AI Agent")

# Allow requests from any frontend port (3000, 4000, 8000, tunnels)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

HINDSIGHT_API_KEY = os.getenv("HINDSIGHT_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

hindsight_client = None
if HINDSIGHT_API_KEY and HINDSIGHT_API_KEY.strip() and not HINDSIGHT_API_KEY.startswith("your_"):
    try:
        from hindsight_client import Hindsight
        hindsight_client = Hindsight(api_key=HINDSIGHT_API_KEY, base_url="https://api.hindsight.vectorize.io")
        print("Hindsight client initialized successfully.")
    except Exception as e:
        print(f"Error initializing Hindsight client: {e}")

groq_client = None
if GROQ_API_KEY and GROQ_API_KEY.strip() and not GROQ_API_KEY.startswith("your_"):
    try:
        import groq
        groq_client = groq.Groq(api_key=GROQ_API_KEY)
        print("Groq client initialized successfully.")
    except Exception as e:
        print(f"Error initializing Groq client: {e}")

BANK_ID = "chat-memory-v1"

# In-memory store for fallback/demo mode when cloud API keys are not yet configured
SIMULATED_MEMORIES = [
    {"fact": "User prefers concise and actionable assistance.", "context": "Initial setup preference", "timestamp": "2026-09-28T20:00:00Z"},
    {"fact": "User is participating in an AI Agent hackathon project.", "context": "Hackathon workspace", "timestamp": "2026-09-28T20:10:00Z"}
]

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    use_memory: bool = True

class ConfigUpdateRequest(BaseModel):
    groq_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None
    hindsight_api_key: Optional[str] = None

@app.on_event("startup")
def startup_event():
    if hindsight_client:
        try:
            hindsight_client.create_bank(bank_id=BANK_ID)
        except Exception as e:
            print(f"Hindsight bank startup check: {e}")

@app.get("/api/health")
def health_endpoint():
    active_engine = "Groq (gpt-oss-120b)" if groq_client else ("Google Gemini (2.5-flash)" if GEMINI_API_KEY else "Interactive Emotional AI Engine")
    return {
        "status": "online",
        "has_groq": groq_client is not None,
        "has_gemini": bool(GEMINI_API_KEY),
        "has_hindsight": hindsight_client is not None,
        "active_engine": active_engine,
        "mode": "live_cloud" if (groq_client or GEMINI_API_KEY) else "interactive_demo"
    }

@app.get("/api/config")
def get_config():
    return health_endpoint()

@app.post("/api/config")
def update_config(req: ConfigUpdateRequest):
    global GROQ_API_KEY, GEMINI_API_KEY, HINDSIGHT_API_KEY, groq_client, hindsight_client
    if req.groq_api_key is not None:
        GROQ_API_KEY = req.groq_api_key.strip()
        if GROQ_API_KEY:
            try:
                import groq
                groq_client = groq.Groq(api_key=GROQ_API_KEY)
            except Exception as e:
                print(f"Error initializing Groq: {e}")
        else:
            groq_client = None

    if req.gemini_api_key is not None:
        GEMINI_API_KEY = req.gemini_api_key.strip()

    if req.hindsight_api_key is not None:
        HINDSIGHT_API_KEY = req.hindsight_api_key.strip()
        if HINDSIGHT_API_KEY:
            try:
                from hindsight_client import Hindsight
                hindsight_client = Hindsight(api_key=HINDSIGHT_API_KEY, base_url="https://api.hindsight.vectorize.io")
                hindsight_client.create_bank(bank_id=BANK_ID)
            except Exception as e:
                print(f"Error initializing Hindsight: {e}")
        else:
            hindsight_client = None

    # Persist keys to .env
    try:
        env_map = {}
        if os.path.exists(".env"):
            with open(".env", "r") as f:
                for line in f:
                    if "=" in line and not line.strip().startswith("#"):
                        k, v = line.strip().split("=", 1)
                        env_map[k.strip()] = v.strip()
        if GROQ_API_KEY:
            env_map["GROQ_API_KEY"] = GROQ_API_KEY
        if GEMINI_API_KEY:
            env_map["GEMINI_API_KEY"] = GEMINI_API_KEY
        if HINDSIGHT_API_KEY:
            env_map["HINDSIGHT_API_KEY"] = HINDSIGHT_API_KEY
        with open(".env", "w") as f:
            for k, v in env_map.items():
                f.write(f"{k}={v}\n")
    except Exception as e:
        print(f"Error persisting keys to .env: {e}")

    return health_endpoint()

def generate_fallback_response(user_msg: str, conversation_history: List[Message], use_memory: bool, recalled_context: str = "") -> dict:
    """Intelligent emotional analysis and contextual memory simulation when external API keys are pending."""
    lowered = user_msg.lower()
    
    # Emotion detection heuristics
    emotions = []
    if any(w in lowered for w in ["stress", "anxious", "worried", "nervous", "tired", "deadline", "exhausted", "hard"]):
        emotions.extend(["Stressed", "Overwhelmed", "Vulnerable"])
    elif any(w in lowered for w in ["happy", "great", "awesome", "excited", "love", "wonderful", "celebrate", "win"]):
        emotions.extend(["Joyful", "Energized", "Accomplished"])
    elif any(w in lowered for w in ["confused", "stuck", "bug", "error", "fail", "broken", "issue", "help", "fix"]):
        emotions.extend(["Frustrated", "Perplexed", "Determined"])
    elif any(w in lowered for w in ["hello", "hi", "hey", "who are you", "what can you do", "start"]):
        emotions.extend(["Curious", "Receptive", "Optimistic"])
    else:
        emotions.extend(["Reflective", "Focused", "Engaged"])

    # Identified needs heuristics
    needs = []
    if "Stressed" in emotions or "Frustrated" in emotions:
        needs.extend(["Empathy & Validation", "Step-by-step Clarification", "Pacing & Support"])
    elif "Joyful" in emotions:
        needs.extend(["Shared Celebration", "Momentum Maintenance", "Next Goals Exploration"])
    elif "Curious" in emotions:
        needs.extend(["Clear Conceptual Overview", "Capability Demonstration", "Interactive Engagement"])
    else:
        needs.extend(["Active Listening", "Adaptive Context Retention", "Insightful Solutions"])

    # Conversation themes
    themes = []
    if any(w in lowered for w in ["memory", "remember", "recall", "hindsight", "store", "forget"]):
        themes.append("Memory Persistence & Architecture")
    if any(w in lowered for w in ["emotion", "feeling", "feel", "mood", "needs"]):
        themes.append("Emotional Awareness & Sentiment Analysis")
    if any(w in lowered for w in ["project", "hackathon", "demo", "code", "app", "test", "bot"]):
        themes.append("Hackathon Demo & Application Workflow")
    if not themes:
        themes = ["General Inquiry & Collaboration", "Personal Reflection"]

    # Past memory context note
    recalled_snippet = f" (Recalled Memory: {recalled_context})" if recalled_context else ""

    # Generate empathetic response
    if "hello" in lowered or "hi" in lowered or "hey" in lowered:
        reply = (
            f"Hello! It's great to connect with you. I'm actively sensing that you're approaching this conversation "
            f"with an open and {emotions[0].lower()} mindset. How can I support your project or emotional well-being today?"
            f"{recalled_snippet}"
        )
    elif "Stressed" in emotions or "Frustrated" in emotions:
        reply = (
            f"I hear the strain in your words, and it's completely understandable to feel {emotions[0].lower()} "
            f"right now. Take a deep breath—I'm tracking your need for {needs[0].lower()}, and together we can break this down "
            f"one step at a time. What feels like the highest priority block right now?"
            f"{recalled_snippet}"
        )
    elif "Joyful" in emotions:
        reply = (
            f"That positive energy is palpable! I'm reflecting your feeling of being {emotions[0].lower()}. "
            f"Let's channel this momentum toward reaching your next milestone!"
            f"{recalled_snippet}"
        )
    else:
        reply = (
            f"I've processed your message: \"{user_msg}\". "
            f"I detect that you are {', '.join(emotions).lower()}, with an underlying need for {needs[0].lower()}. "
            f"I've updated my cognitive memory bank so our upcoming turns preserve this exact context."
            f"{recalled_snippet}"
        )

    # Memory operations
    clean_fact = re.sub(r'[^a-zA-Z0-9\s.,?!]', '', user_msg).strip()
    if len(clean_fact) > 50:
        clean_fact = clean_fact[:50] + "..."
    fact_text = f"User noted: '{clean_fact}' (Tone: {emotions[0]})"
    
    op_action = "UPDATE" if len(SIMULATED_MEMORIES) > 3 else "CREATE"
    memory_ops = [
        {
            "action": op_action,
            "data": fact_text
        }
    ]
    
    if use_memory:
        SIMULATED_MEMORIES.append({
            "fact": fact_text,
            "context": f"Themes: {', '.join(themes)}",
            "timestamp": datetime.datetime.now().isoformat()
        })

    bullet_points = [
        f"Detected emotions: {', '.join(emotions)}",
        f"Identified need: {', '.join(needs)}",
        f"Key theme: {', '.join(themes)}",
        f"Memory operation: {op_action} ({fact_text})"
    ]

    return {
        "response": reply,
        "emotions": emotions,
        "needs": needs,
        "themes": themes,
        "bullet_points": bullet_points,
        "memory_operations": memory_ops
    }

def call_gemini_api(api_key: str, system_prompt: str, messages: List[Message]) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    contents = []
    for msg in messages:
        contents.append({
            "role": "user" if msg.role == "user" else "model",
            "parts": [{"text": msg.content}]
        })
    payload = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": contents,
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }
    with httpx.Client(timeout=25.0) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(raw_text)

@app.post("/api/chat")
def chat_endpoint(request: ChatRequest):
    user_message = request.messages[-1].content if request.messages else ""
    
    # 1. Recall memory (from Hindsight Cloud or local memory bank)
    memories = ""
    if request.use_memory and user_message:
        if hindsight_client:
            try:
                recall_res = hindsight_client.recall(bank_id=BANK_ID, query=user_message)
                memories = getattr(recall_res, 'text', str(recall_res))
            except Exception as e:
                print(f"Hindsight recall error: {e}")
                memories = ""
        elif SIMULATED_MEMORIES:
            memories = "; ".join([m["fact"] for m in SIMULATED_MEMORIES[-2:]])
            
    system_prompt = f"""You are an emotionally aware AI assistant. 
You are having a conversation with a user. You must analyze the user's emotions, needs, and the main themes of the conversation.
You also have access to past memories: {memories}

You must respond in pure JSON format containing the following keys:
- "response": Your reply to the user.
- "emotions": A list of strings identifying the user's current emotions.
- "needs": A list of strings identifying what the user needs right now.
- "themes": A list of strings summarizing the main topics.
- "bullet_points": A list of 3-4 concise bullet points summarizing this interaction (emotional tone, primary intent, key takeaway, memory action).
- "memory_operations": A list of objects detailing data to Create, Update, or Delete based on this turn. Each object should have:
    - "action": "CREATE", "UPDATE", or "DELETE"
    - "data": The fact or detail being stored/changed.

Ensure your output is valid JSON.
"""

    data = None

    # 2. Try Groq if configured
    if groq_client:
        try:
            api_messages = [{"role": "system", "content": system_prompt}]
            for msg in request.messages:
                api_messages.append({"role": msg.role, "content": msg.content})
                
            chat_completion = groq_client.chat.completions.create(
                messages=api_messages,
                model="openai/gpt-oss-120b",
                response_format={"type": "json_object"}
            )
            content = chat_completion.choices[0].message.content
            data = json.loads(content)
        except Exception as e:
            print(f"Groq API error: {e}")

    # 3. Try Gemini if configured and Groq didn't run
    if not data and GEMINI_API_KEY:
        try:
            data = call_gemini_api(GEMINI_API_KEY, system_prompt, request.messages)
        except Exception as e:
            print(f"Gemini API error: {e}")

    # 4. Fallback to interactive emotion engine
    if not data:
        data = generate_fallback_response(user_message, request.messages, request.use_memory, recalled_context=memories)

    # 5. Process memory operations
    if "memory_operations" in data and request.use_memory:
        for op in data["memory_operations"]:
            action = op.get("action")
            fact = op.get("data")
            if action in ["CREATE", "UPDATE", "DELETE"] and fact:
                if hindsight_client:
                    try:
                        hindsight_client.retain(
                            bank_id=BANK_ID,
                            content=f"User Fact: {fact}",
                            context=f"Recorded during conversation about themes: {', '.join(data.get('themes', []))}"
                        )
                    except Exception as e:
                        print(f"Error retaining memory in Hindsight: {e}")
                
                # Also record locally
                SIMULATED_MEMORIES.append({
                    "fact": fact,
                    "context": f"Action: {action}",
                    "timestamp": datetime.datetime.now().isoformat()
                })
    
    return data

@app.get("/api/reflect")
def reflect_memory():
    if hindsight_client:
        try:
            response = hindsight_client.reflect(
                bank_id=BANK_ID,
                query="What are the overarching emotional themes and needs of this user over time?"
            )
            return {"reflection": getattr(response, 'text', str(response))}
        except Exception as e:
            print(f"Live reflect error: {e}")

    # Fallback / simulated reflection
    count = len(SIMULATED_MEMORIES)
    facts_summary = "; ".join([m["fact"] for m in SIMULATED_MEMORIES[-4:]])
    return {
        "reflection": (
            f"Synthesizing insights across {count} recorded interactions: "
            f"The user consistently demonstrates high intentionality and emotional self-awareness. "
            f"Core recurring needs include reassurance during high-stress problem-solving periods and "
            f"transparent memory retention. Recent contextual points tracked: {facts_summary}."
        )
    }

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_BUILD_DIR = BASE_DIR / "frontend" / "build"

if FRONTEND_BUILD_DIR.exists():
    static_dir = FRONTEND_BUILD_DIR / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        file_path = FRONTEND_BUILD_DIR / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_BUILD_DIR / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
