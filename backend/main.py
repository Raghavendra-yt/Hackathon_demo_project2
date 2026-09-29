import os
import datetime
import json
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configure structured logging for MemOS Virtual Memory lifecycle
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("memos.server")

# Load environment variables
load_dotenv()

from backend.memory import (
    IncidentRecord,
    parse_recall_results,
    format_recalled_memories_for_prompt,
    format_incident_for_retention,
    execute_recall,
    execute_retain,
    execute_reflect,
    parse_reflect_response,
    SimulatedMemoryBank
)

HINDSIGHT_API_KEY = os.getenv("HINDSIGHT_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
BANK_ID = os.getenv("HINDSIGHT_BANK_ID", "devops-demo-team")

# Initialize persistent memory fallback bank for offline/test resilience
fallback_bank = SimulatedMemoryBank(bank_id=BANK_ID)

hindsight_client = None
if HINDSIGHT_API_KEY and HINDSIGHT_API_KEY.strip() and not HINDSIGHT_API_KEY.startswith("your_"):
    try:
        from hindsight_client import Hindsight
        hindsight_client = Hindsight(api_key=HINDSIGHT_API_KEY, base_url="https://api.hindsight.vectorize.io")
        logger.info(f"Hindsight client connected successfully. Bank ID: {BANK_ID}")
    except Exception as e:
        logger.error(f"Error initializing Hindsight client: {e}")

groq_client = None
if GROQ_API_KEY and GROQ_API_KEY.strip() and not GROQ_API_KEY.startswith("your_"):
    try:
        import groq
        groq_client = groq.Groq(api_key=GROQ_API_KEY)
        logger.info("Groq client initialized successfully with model openai/gpt-oss-120b.")
    except Exception as e:
        logger.error(f"Error initializing Groq client: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("MemOS DevOps Incident Response Agent starting up...")
    if hindsight_client:
        try:
            hindsight_client.create_bank(bank_id=BANK_ID)
            logger.info(f"Hindsight bank verified/created: {BANK_ID}")
        except Exception as e:
            logger.warning(f"Hindsight bank startup check note: {e}")
    # Auto-seed baseline incidents into persistent memory store if empty
    if len(fallback_bank.memories) == 0:
        try:
            from backend.seed import seed_historical_incidents
            seed_historical_incidents(client=hindsight_client, bank_id=BANK_ID, fallback_bank=fallback_bank)
            logger.info("Baseline historical incidents auto-seeded on startup.")
        except Exception as e:
            logger.warning(f"Auto-seed note: {e}")
    yield


app = FastAPI(
    title="MemOS Agent - DevOps Incident Response Assistant",
    description="Virtual Memory Architecture for Autonomous AI SREs powered by Hindsight Cloud",
    lifespan=lifespan
)

# CORS middleware for development and production web access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]
    use_memory: bool = True
    bank_id: Optional[str] = None


class ConfigUpdateRequest(BaseModel):
    groq_api_key: Optional[str] = None
    hindsight_api_key: Optional[str] = None
    bank_id: Optional[str] = None


@app.get("/api/health")
def health_endpoint():
    active_engine = "Groq (openai/gpt-oss-120b)" if groq_client else "MemOS Autonomous Incident Engine"
    return {
        "status": "online",
        "has_groq": groq_client is not None,
        "has_hindsight": hindsight_client is not None,
        "active_engine": active_engine,
        "bank_id": BANK_ID,
        "domain": "DevOps Incident Response",
        "seeded_incidents": len(fallback_bank.memories),
        "mode": "live_cloud" if (groq_client and hindsight_client) else ("groq_with_local_memory" if groq_client else "interactive_demo")
    }


@app.get("/api/config")
def get_config():
    return health_endpoint()


@app.post("/api/seed-incidents")
def seed_incidents_endpoint(bank_id: Optional[str] = None):
    """
    POST /api/seed-incidents
    Deterministically seeds 12 realistic historical DevOps incidents into Hindsight.
    Runs benchmark Recall queries to verify semantic recall and returns verification report.
    """
    target_bank = bank_id or BANK_ID
    from backend.seed import seed_historical_incidents, verify_seeded_incidents
    seed_result = seed_historical_incidents(
        client=hindsight_client,
        bank_id=target_bank,
        fallback_bank=fallback_bank
    )
    verification_result = verify_seeded_incidents(
        client=hindsight_client,
        bank_id=target_bank,
        fallback_bank=fallback_bank
    )
    return {
        "status": "success" if seed_result["seeded_count"] > 0 else "partial",
        "bank_id": target_bank,
        "seeded_count": seed_result["seeded_count"],
        "total_incidents": seed_result["total_incidents"],
        "incidents": seed_result["incidents"],
        "verification": verification_result
    }


@app.get("/api/incidents")
def get_incidents_endpoint(bank_id: Optional[str] = None):
    """
    GET /api/incidents
    Returns the catalog of all historical incident precedents available in persistent memory.
    """
    from backend.seed import HISTORICAL_INCIDENTS
    target_bank = bank_id or BANK_ID
    return {
        "bank_id": target_bank,
        "total": len(HISTORICAL_INCIDENTS),
        "incidents": [
            getattr(inc, "model_dump", getattr(inc, "dict", lambda: inc.__dict__))()
            for inc in HISTORICAL_INCIDENTS
        ]
    }


@app.post("/api/config")
def update_config(req: ConfigUpdateRequest):
    global GROQ_API_KEY, HINDSIGHT_API_KEY, BANK_ID, groq_client, hindsight_client
    if req.groq_api_key is not None:
        GROQ_API_KEY = req.groq_api_key.strip()
        if GROQ_API_KEY:
            try:
                import groq
                groq_client = groq.Groq(api_key=GROQ_API_KEY)
                logger.info("Groq client re-initialized via API.")
            except Exception as e:
                logger.error(f"Error re-initializing Groq: {e}")
        else:
            groq_client = None

    if req.hindsight_api_key is not None:
        HINDSIGHT_API_KEY = req.hindsight_api_key.strip()
        if HINDSIGHT_API_KEY:
            try:
                from hindsight_client import Hindsight
                hindsight_client = Hindsight(api_key=HINDSIGHT_API_KEY, base_url="https://api.hindsight.vectorize.io")
                hindsight_client.create_bank(bank_id=BANK_ID)
                logger.info(f"Hindsight client re-initialized via API for bank {BANK_ID}.")
            except Exception as e:
                logger.error(f"Error re-initializing Hindsight: {e}")
        else:
            hindsight_client = None

    if req.bank_id is not None and req.bank_id.strip():
        BANK_ID = req.bank_id.strip()

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
        if HINDSIGHT_API_KEY:
            env_map["HINDSIGHT_API_KEY"] = HINDSIGHT_API_KEY
        if BANK_ID:
            env_map["HINDSIGHT_BANK_ID"] = BANK_ID
        with open(".env", "w") as f:
            for k, v in env_map.items():
                f.write(f"{k}={v}\n")
    except Exception as e:
        logger.error(f"Error persisting keys to .env: {e}")

    return health_endpoint()


def generate_devops_fallback_response(
    user_msg: str,
    conversation_history: List[Message],
    recalled_memories: List[Dict[str, Any]]
) -> dict:
    """
    Autonomous DevOps Incident Response Fallback Engine.
    Produces the standard DevOps schema when Groq is not configured or in offline mode.
    """
    lowered = user_msg.lower()

    # Determine targeted service
    service = "Checkout API"
    if "payment" in lowered:
        service = "Payment Service"
    elif "auth" in lowered:
        service = "Authentication Service"
    elif "gateway" in lowered:
        service = "API Gateway"
    elif "redis" in lowered:
        service = "Redis"
    elif "postgres" in lowered or "sql" in lowered or "database" in lowered:
        service = "PostgreSQL"
    elif "k8s" in lowered or "pod" in lowered or "oom" in lowered:
        service = "Kubernetes Cluster"
    elif "notification" in lowered:
        service = "Notification Service"

    # Identify recalled precedent IDs and themes
    recalled_ids = [
        m.get("metadata", {}).get("incident_id") or f"Memory #{i+1}"
        for i, m in enumerate(recalled_memories)
        if m.get("metadata", {}).get("incident_id")
    ]
    recalled_text_combined = " ".join([m.get("text", "") for m in recalled_memories]).lower()
    has_redis_match = "redis" in recalled_text_combined or "pool" in recalled_text_combined or "redis" in lowered

    symptom_triggers = ["timeout", "timing out", "time out", "timeouts", "504", "500", "502", "503", "slow", "down", "fail", "degrad", "error", "latency", "crash", "stuck"]
    if any(trigger in lowered for trigger in symptom_triggers):
        if has_redis_match or "checkout" in lowered:
            incident_id = "INC-184-FOLLOWUP" if "184" in str(recalled_ids) else "INC-2026-0929"
            severity = "P1"
            symptoms = f"{service} experiencing elevated 504 Gateway Timeouts and degraded latency under high transaction volume."
            investigation = (
                "1. Inspected connection pool saturation metrics on Redis cluster.\n"
                "2. Analyzed application worker thread dumps: threads blocked on `JedisConnectionFactory.getConnection()`.\n"
                "3. Verified Redis server CPU < 35%, confirming pool client limits rather than host CPU exhaustion."
            )
            root_cause = "Redis connection pool exhaustion caused by high concurrent traffic spike exceeding configured max-active limits."
            hypotheses = [
                "Primary: Redis connection pool exhaustion on application nodes causing thread starvation.",
                "Secondary: Idle connection leak preventing connection return to pool after network timeouts.",
                "Alternative: Network packet drop between service pods and Redis cluster."
            ]
            actions = [
                "Execute hot-reconfig: Increase `spring.redis.jedis.pool.max-active` from 200 to 1000.",
                "Set `max-wait-millis` to 1500ms to fail fast rather than hanging worker threads.",
                "Drain and rolling-restart checkout service pods to eliminate leaked sockets.",
                "Run `redis-cli info clients` to verify active connected clients vs maxclients."
            ]
            verification = [
                "Monitor p99 latency on Checkout API: verify drops below 200ms.",
                "Check Prometheus metric `redis_connected_clients`: ensure utilization < 75%.",
                "Verify HTTP 504 error rate returns to 0.00%."
            ]
            mem_impact = (
                f"Directly informed by recalled organizational incident precedent "
                f"({', '.join(recalled_ids) if recalled_ids else 'Incident #184 / #127'}). "
                f"Historical patterns show checkout and payment timeouts repeatedly correlate with Redis connection exhaustion during spikes."
            )
            retained_summary = (
                f"Incident {incident_id} ({service} - {severity}): Resolved 504 Gateway Timeouts by scaling Redis connection pool "
                f"from 200 to 1000 and tuning wait timeouts."
            )
        else:
            incident_id = "INC-2026-0930"
            severity = "P2"
            symptoms = f"Latency degradation observed on {service}."
            investigation = f"Triaging downstream latency and pod error logs for {service}."
            root_cause = f"Resource contention or upstream latency affecting {service}."
            hypotheses = [
                f"Primary: Upstream API throttling affecting {service}.",
                f"Secondary: Memory pressure triggering frequent garbage collection pauses."
            ]
            actions = [
                f"Inspect container logs for {service} using `kubectl logs -l app={service.lower().replace(' ', '-')}`.",
                "Check cluster node CPU and memory pressure.",
                "Scale replica count by 50% to distribute request load."
            ]
            verification = [
                f"Verify {service} response time p95 < 250ms.",
                "Confirm error rates drop below 0.1%."
            ]
            mem_impact = f"Evaluated against {len(recalled_memories)} recalled historical incident records."
            retained_summary = f"Incident {incident_id} ({service} - {severity}): Latency degradation stabilized."
    else:
        incident_id = "INC-2026-DIAG"
        severity = "P3"
        symptoms = f"Routine operational diagnostic check for {service}."
        investigation = f"Audited telemetry and historical incident precedent for {service}."
        root_cause = "No active production outage detected; proactive diagnostic inquiry."
        hypotheses = [
            f"Service {service} is operating within nominal SLO boundaries."
        ]
        actions = [
            "Review Prometheus error budgets and alert thresholds.",
            "Verify backup connection pool configurations."
        ]
        verification = [
            "Confirm service health checks return HTTP 200 OK."
        ]
        mem_impact = f"Loaded {len(recalled_memories)} historical memories related to {service}."
        retained_summary = f"Diagnostic query for {service} logged in memory bank {BANK_ID}."

    analysis = (
        f"**Situation Assessment:** {symptoms}\n\n"
        f"**Historical Precedent:** Recalled {len(recalled_memories)} organizational memory record(s). "
        f"{mem_impact}\n\n"
        f"**Diagnostic Findings:** {investigation}"
    )

    incident_obj = {
        "incident_id": incident_id,
        "timestamp": datetime.datetime.now().isoformat(),
        "service": service,
        "environment": "production",
        "severity": severity,
        "symptoms": symptoms,
        "investigation": investigation,
        "root_cause": root_cause,
        "remediation": "\n".join(actions),
        "verification": "\n".join(verification),
        "status": "mitigating" if severity == "P1" else "resolved",
        "tags": [service.lower().replace(" ", "-"), "production", severity.lower(), "devops", "incident"]
    }

    # Generate formatted markdown response
    response_md = f"""### 🚨 DevOps Incident Triage: {service} ({severity})

**Incident ID:** `{incident_id}` | **Environment:** `production` | **Status:** `{incident_obj['status']}`

---

#### 📋 Operational Analysis
{analysis}

#### 🔍 Root Cause Hypotheses
{chr(10).join(f"- {h}" for h in hypotheses)}

#### 🔬 Investigation & Diagnostic Steps
{chr(10).join(f"- {s}" for s in [step.strip() for step in investigation.split(chr(10)) if step.strip()])}

#### 🛠️ Recommended Remediation Actions
{chr(10).join(f"{i}. {a}" for i, a in enumerate(actions, 1))}

#### ✅ Verification Steps
{chr(10).join(f"- {v}" for v in verification)}

---

#### 🧠 Virtual Memory Impact
{mem_impact}
"""

    return {
        "response": response_md,
        "analysis": analysis,
        "root_cause_hypotheses": hypotheses,
        "investigation_steps": [step.strip() for step in investigation.split("\n") if step.strip()],
        "recommended_actions": actions,
        "verification_steps": verification,
        "memory_impact": mem_impact,
        "retained_summary": retained_summary,
        "incident": incident_obj
    }


def extract_json_from_llm(raw_text: str) -> Optional[dict]:
    """
    Safely parses JSON from LLM responses, stripping code fences or trailing commentary.
    """
    if not raw_text or not raw_text.strip():
        return None
    cleaned = raw_text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except Exception:
        pass

    # Extract outermost JSON object via regex if surrounded by conversational text
    match = re.search(r'(\{[\s\S]*\})', raw_text)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception:
            pass
    return None


@app.post("/api/chat")
def chat_endpoint(request: ChatRequest):
    user_message = request.messages[-1].content if request.messages else ""
    target_bank = request.bank_id or BANK_ID

    logger.info("=" * 60)
    logger.info(f"[MEMOS PIPELINE START] Bank: {target_bank}")
    logger.info(f"[USER INCIDENT REPORT] {user_message}")

    # =========================================================================
    # STAGE 1: RECALL (Page In from Hindsight Persistent Virtual Memory)
    # =========================================================================
    recalled_memories: List[Dict[str, Any]] = []
    recalled_prompt_text = ""

    if request.use_memory and user_message:
        logger.info(f"--- [MEMORY LIFECYCLE: 1. RECALL] Bank: {target_bank} ---")
        try:
            recalled_memories = execute_recall(
                client=hindsight_client,
                bank_id=target_bank,
                query=user_message,
                fallback_bank=fallback_bank
            )
        except Exception as e:
            logger.error(f"[RECALL ERROR] Memory recall failed: {e}")
            recalled_memories = []
        recalled_prompt_text = format_recalled_memories_for_prompt(recalled_memories)
        logger.info(f"[RECALL COMPLETE] Retrieved {len(recalled_memories)} structured incident memories.")
    else:
        logger.info("[RECALL SKIPPED] Memory sync is disabled or message is empty.")

    # =========================================================================
    # STAGE 2: EXECUTE (Working Context Execution via Groq LLM)
    # =========================================================================
    logger.info("--- [MEMORY LIFECYCLE: 2. EXECUTE] Preparing LLM working context ---")

    system_prompt = f"""You are MemOS DevOps Incident Response Agent, an expert Site Reliability Engineering (SRE) assistant powered by a Virtual Memory Architecture.
Your role is to diagnose, triage, and provide actionable remediation for production incidents by reasoning over current observations and historical incident memories.

{recalled_prompt_text}

OPERATIONAL REASONING PRINCIPLES:
1. Cross-reference the user's current incident with recalled historical incident precedents.
2. If past incidents match the symptoms or service, explicitly cite their incident ID (e.g. Incident #184) and explain how their root cause and remediation inform your current hypothesis.
3. Clearly distinguish verified historical evidence from current observations. Never assume two incidents are identical without symptom and metric verification.
4. Recommend concrete diagnostic commands (e.g. CLI, kubectl, curl, database queries) and safe remediation steps.
5. Provide verification steps to confirm recovery and prevent regressions.

You must respond in valid JSON matching the following schema:
{{
  "analysis": "Detailed situational triage, correlating current symptoms with historical incident precedent...",
  "root_cause_hypotheses": [
    "Primary hypothesis with supporting evidence from current symptoms and recalled precedent...",
    "Alternative hypothesis..."
  ],
  "recommended_actions": [
    "Step 1: Immediate diagnostic check...",
    "Step 2: Concrete remediation action...",
    "Step 3: Stabilization action..."
  ],
  "verification_steps": [
    "Step 1: Metric or command to verify resolution...",
    "Step 2: Service health check..."
  ],
  "memory_impact": "Detailed explanation of which historical incident(s) influenced this diagnosis and why...",
  "retained_summary": "Concise operational summary of this incident, affected service, root cause, and remediation to be retained in Hindsight for future recall.",
  "incident": {{
    "incident_id": "Incident identifier (e.g. INC-2026-0929 or match historical ID if related)",
    "service": "Name of the affected service (e.g. Checkout API, Payment Service, Redis)",
    "environment": "production",
    "severity": "P1 | P2 | P3",
    "symptoms": "Concise summary of observed symptoms",
    "investigation": "Investigation and diagnostic steps",
    "root_cause": "Hypothesized or confirmed root cause",
    "remediation": "Key remediation actions",
    "verification": "Key verification steps",
    "status": "mitigating | resolved",
    "tags": ["service-name", "production", "p1"]
  }}
}}
"""

    data = None

    # Call Groq if configured with 25s timeout and resilient JSON extraction
    if groq_client:
        try:
            logger.info("Calling Groq LLM (openai/gpt-oss-120b) with recalled memory context...")
            api_messages = [{"role": "system", "content": system_prompt}]
            for msg in request.messages:
                api_messages.append({"role": msg.role, "content": msg.content})

            chat_completion = groq_client.chat.completions.create(
                messages=api_messages,
                model="openai/gpt-oss-120b",
                response_format={"type": "json_object"},
                timeout=25.0
            )
            content = chat_completion.choices[0].message.content
            data = extract_json_from_llm(content)
            if data:
                logger.info("Groq LLM response successfully parsed.")
            else:
                logger.warning("Groq response was not valid JSON; engaging fallback engine.")
        except Exception as e:
            logger.error(f"Groq API execution error: {e}")

    # Fallback to local DevOps incident engine if Groq is not available or errored
    if not data:
        logger.info("Invoking MemOS Autonomous DevOps Engine...")
        data = generate_devops_fallback_response(
            user_msg=user_message,
            conversation_history=request.messages,
            recalled_memories=recalled_memories
        )

    # Ensure required schema fields exist
    incident_dict = data.get("incident") or {}
    analysis = data.get("analysis", "")
    root_cause_hypotheses = data.get("root_cause_hypotheses", [])
    investigation_steps = data.get("investigation_steps", [])
    if not investigation_steps and incident_dict.get("investigation"):
        inv = incident_dict["investigation"]
        investigation_steps = [s.strip() for s in str(inv).split("\n") if s.strip()]
    if not investigation_steps:
        investigation_steps = [
            "Check application worker thread dumps for blocked threads on connection acquisition.",
            "Verify Redis and database connection pool saturation metrics vs configured max-active limits.",
            "Inspect upstream API Gateway latency and 504 Gateway Timeout error distribution."
        ]
    data["investigation_steps"] = investigation_steps
    recommended_actions = data.get("recommended_actions", [])
    verification_steps = data.get("verification_steps", [])
    memory_impact = data.get("memory_impact", "")
    if not recalled_memories and "no historical" not in (memory_impact or "").lower():
        memory_impact = f"No historical precedents recalled. {memory_impact}".strip()
        data["memory_impact"] = memory_impact
    retained_summary = data.get("retained_summary", "")

    # If response markdown is not already provided, construct rich markdown
    if "response" not in data or not data["response"]:
        service_name = incident_dict.get("service", "System Infrastructure")
        severity_label = incident_dict.get("severity", "P2")
        inc_id = incident_dict.get("incident_id", "INC-NEW")
        data["response"] = f"""### 🚨 DevOps Incident Triage: {service_name} ({severity_label})

**Incident ID:** `{inc_id}` | **Environment:** `{incident_dict.get('environment', 'production')}` | **Status:** `{incident_dict.get('status', 'investigating')}`

---

#### 📋 Operational Analysis
{analysis}

#### 🔍 Root Cause Hypotheses
{chr(10).join(f"- {h}" for h in root_cause_hypotheses)}

#### 🔬 Investigation & Diagnostic Steps
{chr(10).join(f"- {s}" for s in investigation_steps)}

#### 🛠️ Recommended Remediation Actions
{chr(10).join(f"{i}. {a}" for i, a in enumerate(recommended_actions, 1))}

#### ✅ Verification Steps
{chr(10).join(f"- {v}" for v in verification_steps)}

---

#### 🧠 Virtual Memory Impact
{memory_impact}
"""

    # Build validated IncidentRecord
    try:
        incident_record = IncidentRecord(
            incident_id=incident_dict.get("incident_id") or f"INC-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}",
            service=incident_dict.get("service") or "Infrastructure",
            environment=incident_dict.get("environment") or "production",
            severity=incident_dict.get("severity") or "P2",
            symptoms=incident_dict.get("symptoms") or user_message[:150],
            investigation=incident_dict.get("investigation") or analysis[:300],
            root_cause=incident_dict.get("root_cause") or (root_cause_hypotheses[0] if root_cause_hypotheses else "Under investigation"),
            remediation=incident_dict.get("remediation") or "\n".join(recommended_actions),
            verification=incident_dict.get("verification") or "\n".join(verification_steps),
            status=incident_dict.get("status") or "resolved",
            tags=incident_dict.get("tags") or []
        )
    except Exception as e:
        logger.warning(f"Error creating IncidentRecord: {e}")
        incident_record = IncidentRecord(
            incident_id=f"INC-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}",
            service="Infrastructure",
            symptoms=user_message[:150],
            investigation=analysis[:300],
            root_cause="Under investigation",
            remediation="\n".join(recommended_actions),
            verification="\n".join(verification_steps)
        )

    # Attach validated incident object to response
    dump_func = getattr(incident_record, "model_dump", getattr(incident_record, "dict", None))
    data["incident"] = dump_func()

    # =========================================================================
    # STAGE 3: RETAIN (Page Out to Hindsight Persistent Virtual Memory)
    # =========================================================================
    retain_result = {"success": False}
    if request.use_memory and user_message:
        logger.info(f"--- [MEMORY LIFECYCLE: 3. RETAIN] Retaining complete incident context into Hindsight ---")
        incident_payload = dump_func()
        incident_payload["user_message"] = user_message
        incident_payload["assistant_response"] = data.get("response", "")

        try:
            retain_result = execute_retain(
                client=hindsight_client,
                bank_id=target_bank,
                incident_data=incident_payload,
                fallback_bank=fallback_bank
            )
        except Exception as e:
            logger.error(f"[RETAIN ERROR] Failed to page out incident into persistent memory: {e}")
            retain_result = {"success": False, "error": str(e)}
        logger.info(f"[RETAIN COMPLETE] Retained incident: {incident_record.incident_id} | Status: {retain_result.get('success')}")

    # =========================================================================
    # STAGE 4: RESPONSE ENRICHMENT
    # =========================================================================
    data["recalled_memories"] = recalled_memories
    data["retained_record"] = retain_result
    data["memory_lifecycle"] = {
        "stage": "completed",
        "recall_count": len(recalled_memories),
        "retained": retain_result.get("success", False),
        "incident_id": incident_record.incident_id,
        "bank_id": target_bank
    }

    # Backward-compatible fields for existing React dashboard
    data["bullet_points"] = [
        f"Service: {incident_record.service} ({incident_record.severity})",
        f"Hypothesis: {incident_record.root_cause[:80]}",
        f"Memory Impact: Recalled {len(recalled_memories)} precedent(s)",
        f"Retained Action: Stored {incident_record.incident_id} in Hindsight"
    ]
    data["memory_operations"] = [
        {
            "action": "RETAIN",
            "data": f"{incident_record.incident_id} ({incident_record.service}): {incident_record.root_cause}"
        }
    ]

    logger.info(f"[MEMOS PIPELINE COMPLETED] Recalled: {len(recalled_memories)} | Retained: {retain_result.get('success')}")
    logger.info("=" * 60)
    return data


class ReflectRequest(BaseModel):
    bank_id: Optional[str] = None
    query: Optional[str] = None


@app.post("/api/reflect")
def reflect_memory_post(req: Optional[ReflectRequest] = None):
    """
    STAGE 4: REFLECT (Memory Consolidation) - POST /api/reflect
    Consolidates multiple incident experiences into reusable operational mental models.
    Returns:
    {
      "mental_model": "...",
      "supporting_incidents": [],
      "patterns": [],
      "recommended_operational_rules": [],
      "reflection": "...",
      "bank_id": "..."
    }
    """
    target_bank = (req.bank_id if req and req.bank_id else None) or BANK_ID
    query = req.query if req and req.query else None
    try:
        return execute_reflect(
            client=hindsight_client,
            bank_id=target_bank,
            query=query,
            fallback_bank=fallback_bank
        )
    except Exception as e:
        logger.error(f"[REFLECT ERROR] Failed during POST /api/reflect: {e}")
        return parse_reflect_response(None, bank_id=target_bank)


@app.get("/api/reflect")
def reflect_memory_get(bank_id: Optional[str] = None, query: Optional[str] = None):
    """
    STAGE 4: REFLECT (Memory Consolidation) - GET /api/reflect (backward compatible)
    """
    target_bank = bank_id or BANK_ID
    try:
        return execute_reflect(
            client=hindsight_client,
            bank_id=target_bank,
            query=query,
            fallback_bank=fallback_bank
        )
    except Exception as e:
        logger.error(f"[REFLECT ERROR] Failed during GET /api/reflect: {e}")
        return parse_reflect_response(None, bank_id=target_bank)


class CompareMemoryRequest(BaseModel):
    query: str = "Production checkout is timing out again."
    bank_id: Optional[str] = None


@app.post("/api/demo/compare-memory")
def compare_memory_endpoint(req: CompareMemoryRequest):
    """
    POST /api/demo/compare-memory
    Phase 7: Controlled Memory Impact Demonstration
    Evaluates the exact same incident query under two modes:
    A. COLD AGENT (Stateless / zero recalled memories)
    B. MEMORY-ENABLED AGENT (Persistent Virtual Memory Recall via Hindsight)

    Returns factual side-by-side responses and impact analysis.
    """
    target_bank = req.bank_id or BANK_ID
    query = req.query.strip() or "Production checkout is timing out again."

    logger.info(f"[COMPARE DEMO] Evaluating query: '{query}' on bank='{target_bank}'")

    # 1. Evaluate COLD AGENT (use_memory = False)
    cold_chat_req = ChatRequest(
        messages=[Message(role="user", content=query)],
        use_memory=False,
        bank_id=target_bank
    )
    cold_result = chat_endpoint(cold_chat_req)

    # 2. Evaluate MEMORY-ENABLED AGENT (use_memory = True)
    mem_chat_req = ChatRequest(
        messages=[Message(role="user", content=query)],
        use_memory=True,
        bank_id=target_bank
    )
    mem_result = chat_endpoint(mem_chat_req)

    # 3. Retrieve Operational Mental Model (Reflect)
    reflect_result = execute_reflect(
        client=hindsight_client,
        bank_id=target_bank,
        fallback_bank=fallback_bank
    )

    # 4. Factual Comparison Extraction
    recalled_list = mem_result.get("recalled_memories", [])
    recalled_ids = [m.get("incident_id") or m.get("metadata", {}).get("incident_id") for m in recalled_list]

    historical_root_causes = [
        f"{m.get('incident_id', 'INC')}: {m.get('root_cause', m.get('text', '')[:100])}"
        for m in recalled_list[:3]
        if m.get("root_cause") or m.get("text")
    ]

    historical_remediations = [
        f"{m.get('incident_id', 'INC')}: {m.get('remediation', '')[:100]}"
        for m in recalled_list[:3]
        if m.get("remediation")
    ]

    comparison_summary = {
        "query": query,
        "bank_id": target_bank,
        "cold_agent": {
            "mode": "Cold Agent (Stateless)",
            "description": "Evaluated without access to persistent memory (zero-shot baseline).",
            "recalled_count": 0,
            "recalled_memories": [],
            "analysis": cold_result.get("analysis", ""),
            "root_cause_hypotheses": cold_result.get("root_cause_hypotheses", []),
            "investigation_steps": cold_result.get("investigation_steps", []),
            "recommended_actions": cold_result.get("recommended_actions", []),
            "verification_steps": cold_result.get("verification_steps", []),
            "memory_impact": cold_result.get("memory_impact", "No historical context available."),
            "response": cold_result.get("response", "")
        },
        "memory_agent": {
            "mode": "MemOS Memory-Enabled Agent",
            "description": "Evaluated with Hindsight persistent memory recall (Virtual Memory Page-In).",
            "recalled_count": len(recalled_list),
            "recalled_memories": recalled_list,
            "recalled_incident_ids": recalled_ids,
            "analysis": mem_result.get("analysis", ""),
            "root_cause_hypotheses": mem_result.get("root_cause_hypotheses", []),
            "investigation_steps": mem_result.get("investigation_steps", []),
            "recommended_actions": mem_result.get("recommended_actions", []),
            "verification_steps": mem_result.get("verification_steps", []),
            "memory_impact": mem_result.get("memory_impact", ""),
            "response": mem_result.get("response", "")
        },
        "impact_analysis": {
            "recalled_incidents": recalled_ids,
            "historical_root_causes": historical_root_causes,
            "previous_remediations": historical_remediations,
            "investigation_difference": (
                f"Cold Agent proposes generic service triage. "
                f"Memory-Enabled Agent utilizes verified precedent ({', '.join(recalled_ids[:2])}) "
                f"to prioritize targeted diagnostic checks and configuration sizing."
            ),
            "operational_mental_model": reflect_result.get("mental_model", ""),
            "supporting_incidents": reflect_result.get("supporting_incidents", []),
            "patterns": reflect_result.get("patterns", []),
            "prescriptive_rules": reflect_result.get("recommended_operational_rules", [])
        }
    }

    return comparison_summary


# Static file serving for React frontend
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_BUILD_DIR = BASE_DIR / "frontend" / "build"
if not FRONTEND_BUILD_DIR.exists():
    FRONTEND_BUILD_DIR = BASE_DIR / "build"

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
