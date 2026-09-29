"""
Unit & Integration Tests for MemOS DevOps Incident Response Agent
Validates:
- IncidentRecord Pydantic data model
- DevOps response schema (analysis, root_cause_hypotheses, recommended_actions, verification_steps, memory_impact, retained_summary, incident)
- Operational Recall, Retain, and Reflect memory cycles
- Production checkout timeout reasoning scenario using historical precedent
"""

import sys
import os
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import pytest
from hindsight_client import RecallResponse, RecallResult
from backend.memory import (
    IncidentRecord,
    parse_recall_results,
    format_recalled_memories_for_prompt,
    format_incident_for_retention,
    execute_recall,
    execute_retain,
    SimulatedMemoryBank
)
from backend.main import app, generate_devops_fallback_response
from starlette.testclient import TestClient


def test_incident_record_model():
    """Verify IncidentRecord schema fields and validation."""
    inc = IncidentRecord(
        incident_id="INC-184",
        service="Checkout API",
        environment="production",
        severity="P1",
        symptoms="504 Gateway Timeouts under sudden traffic spike",
        root_cause="Redis connection pool exhaustion (maxclients reached)",
        investigation="Active connections hit 1000/1000 limit with queue depth > 400",
        remediation="Scaled maxclients to 10000 and increased client pool max-active to 1000",
        verification="Checked redis-cli info clients and verified checkout error rate < 0.05%",
        status="resolved",
        tags=["checkout-api", "redis", "p1", "production"]
    )

    assert inc.incident_id == "INC-184"
    assert inc.service == "Checkout API"
    assert inc.severity == "P1"
    assert inc.status == "resolved"
    assert "redis" in inc.tags
    assert len(inc.timestamp) > 0
    assert "INC-184" in inc.to_summary()


def test_parse_recall_results_with_real_sdk_objects():
    """
    Extract actual RecallResult objects from response.results collection.
    Ensure text, type, context, and metadata are extracted without raw Python repr strings.
    """
    res1 = RecallResult(
        id="mem_101",
        text="Incident #101: Redis connection pool exhaustion causing Checkout timeouts.",
        type="experience",
        context="DevOps Incident Triage - Redis",
        metadata={"service": "redis", "severity": "P1", "incident_id": "INC-101"},
        tags=["redis", "checkout", "p1"]
    )
    res2 = RecallResult(
        id="mem_184",
        text="Incident #184: Payment gateway timeout due to downstream Redis connection exhaustion.",
        type="experience",
        context="DevOps Incident Triage - Payment",
        metadata={"service": "payment-service", "severity": "P1", "incident_id": "INC-184"},
        tags=["payment", "redis", "p1"]
    )

    sdk_response = RecallResponse(results=[res1, res2])
    parsed = parse_recall_results(sdk_response)

    assert len(parsed) == 2
    item1 = parsed[0]
    assert item1["id"] == "mem_101"
    assert "Incident #101: Redis connection pool exhaustion" in item1["text"]
    assert item1["type"] == "experience"
    assert item1["context"] == "DevOps Incident Triage - Redis"
    assert item1["metadata"]["service"] == "redis"
    assert item1["metadata"]["severity"] == "P1"

    for item in parsed:
        assert not item["text"].startswith("<RecallResult")
        assert not item["text"].startswith("results=[")


def test_format_incident_with_incident_record():
    """Verify complete incident payload formatting for Hindsight Retain."""
    inc = IncidentRecord(
        incident_id="INC-203",
        service="Redis Cluster",
        environment="production",
        severity="P1",
        symptoms="Redis memory exhaustion and connection drops",
        root_cause="Lack of TTL on session tokens caused volatile memory exhaustion",
        investigation="Inspected memory usage with `redis-cli info memory`",
        remediation="Applied volatile-lru eviction policy and enforced 24h TTL on session keys",
        verification="Memory utilization stabilized at 62%",
        status="resolved",
        tags=["redis", "cache", "p1"]
    )

    formatted = format_incident_for_retention(inc)

    content = formatted["content"]
    assert "INCIDENT RECORD: INC-203" in content
    assert "Service: Redis Cluster" in content
    assert "Severity: P1" in content
    assert "Status: resolved" in content
    assert "Lack of TTL on session tokens" in content
    assert "Applied volatile-lru eviction policy" in content
    assert formatted["metadata"]["incident_id"] == "INC-203"
    assert formatted["metadata"]["service"] == "Redis Cluster"
    assert "redis-cluster" in formatted["tags"]


def test_devops_schema_contract():
    """
    Verify that /api/chat adheres strictly to the DevOps incident triage schema:
    {
      "analysis": "...",
      "root_cause_hypotheses": [],
      "recommended_actions": [],
      "verification_steps": [],
      "memory_impact": "...",
      "retained_summary": "...",
      "incident": { ... }
    }
    """
    client = TestClient(app)

    response = client.post("/api/chat", json={
        "messages": [
            {"role": "user", "content": "Payment Service API is returning 500 errors on charge attempts."}
        ],
        "use_memory": True
    })

    assert response.status_code == 200
    data = response.json()

    # Verify all required DevOps schema fields
    assert "analysis" in data, "Must return 'analysis'"
    assert "root_cause_hypotheses" in data, "Must return 'root_cause_hypotheses'"
    assert isinstance(data["root_cause_hypotheses"], list)
    assert len(data["root_cause_hypotheses"]) > 0

    assert "recommended_actions" in data, "Must return 'recommended_actions'"
    assert isinstance(data["recommended_actions"], list)
    assert len(data["recommended_actions"]) > 0

    assert "verification_steps" in data, "Must return 'verification_steps'"
    assert isinstance(data["verification_steps"], list)
    assert len(data["verification_steps"]) > 0

    assert "memory_impact" in data, "Must return 'memory_impact'"
    assert isinstance(data["memory_impact"], str)

    assert "retained_summary" in data, "Must return 'retained_summary'"
    assert isinstance(data["retained_summary"], str)

    assert "incident" in data, "Must return structured 'incident' record"
    inc = data["incident"]
    assert "incident_id" in inc
    assert "service" in inc
    assert "severity" in inc
    assert "root_cause" in inc
    assert "remediation" in inc
    assert "verification" in inc

    # Verify virtual memory fields
    assert "recalled_memories" in data
    assert "memory_lifecycle" in data
    assert data["memory_lifecycle"]["stage"] == "completed"
    assert data["memory_lifecycle"]["retained"] is True


def test_devops_historical_reasoning_checkout_scenario():
    """
    End-to-End Scenario:
    User query: 'Production checkout is timing out again.'
    1. Pre-seed memory bank with Incident #184 (Redis connection exhaustion).
    2. User sends the query.
    3. Recall retrieves Incident #184.
    4. Agent reasons using historical precedent.
    5. Agent recommends troubleshooting actions & explains memory impact.
    6. Agent retains new incident.
    """
    bank = SimulatedMemoryBank(bank_id="devops-scenario-team")

    # 1. Pre-seed Incident #184
    inc_184 = IncidentRecord(
        incident_id="INC-184",
        service="Checkout API",
        environment="production",
        severity="P1",
        symptoms="Checkout 504 Gateway Timeouts during flash sale traffic surge",
        root_cause="Redis connection pool exhaustion causing thread starvation on checkout pods",
        investigation="Redis active connection count pegged at 100%. Pod thread dump showed threads waiting on pool.",
        remediation="Scaled maxclients to 10000, tuned connection pool timeout to 1500ms, restarted checkout pods.",
        verification="Error rate normalized to 0.01% within 3 minutes.",
        status="resolved",
        tags=["checkout", "redis", "p1"]
    )
    execute_retain(client=None, bank_id="devops-scenario-team", incident_data=inc_184, fallback_bank=bank)

    # 2. Execute Recall with query
    query = "Production checkout is timing out again."
    recalled = execute_recall(client=None, bank_id="devops-scenario-team", query=query, fallback_bank=bank)

    assert len(recalled) > 0, "Must recall previous checkout incident"
    top_memory = recalled[0]
    assert "INC-184" in top_memory["text"] or "Checkout" in top_memory["text"]
    assert "Redis" in top_memory["text"]

    # 3. Feed into DevOps Engine
    fallback_res = generate_devops_fallback_response(
        user_msg=query,
        conversation_history=[],
        recalled_memories=recalled
    )

    # 4. Verify reasoning
    assert "INC-184" in fallback_res["memory_impact"] or "historical" in fallback_res["memory_impact"].lower()
    assert any("redis" in h.lower() for h in fallback_res["root_cause_hypotheses"])
    assert any("redis" in a.lower() for a in fallback_res["recommended_actions"])
    assert len(fallback_res["verification_steps"]) > 0

    # 5. Retain new incident
    new_inc = fallback_res["incident"]
    retain_res = execute_retain(client=None, bank_id="devops-scenario-team", incident_data=new_inc, fallback_bank=bank)
    assert retain_res["success"] is True

    # 6. Verify subsequent recall includes both
    all_recalled = execute_recall(client=None, bank_id="devops-scenario-team", query="checkout redis timeouts", fallback_bank=bank)
    assert len(all_recalled) >= 2, "Both historical and newly retained incident must now be recalled"


def test_parse_reflect_response_with_sdk_objects():
    """
    Phase 4: Verify parsing of genuine Hindsight SDK ReflectResponse,
    extracting mental_model, supporting_incidents, patterns, and recommended_operational_rules.
    """
    from backend.memory import parse_reflect_response
    from hindsight_client import ReflectResponse
    from hindsight_client_api.models.reflect_based_on import ReflectBasedOn
    from hindsight_client_api.models.reflect_fact import ReflectFact

    facts = [
        ReflectFact(id="f1", text="INC-184: Checkout 504 caused by Redis pool exhaustion", type="experience"),
        ReflectFact(id="f2", text="INC-127: Payment timeouts during traffic surge", type="experience")
    ]
    rbo = ReflectBasedOn(memories=facts)
    reflect_text = (
        "Consolidated Operational Incident Mental Model:\n\n"
        "Recurring Patterns:\n"
        "- Checkout timeouts frequently correlate with Redis connection saturation during traffic spikes.\n"
        "- Database connection slot exhaustion results from unindexed analytics queries locking the orders table.\n\n"
        "Recommended Operational Rules:\n"
        "- Rule 1: Always verify Redis connection pool metrics before altering application code.\n"
        "- Rule 2: Isolate critical transactional dependencies into dedicated connection pools."
    )
    sdk_resp = ReflectResponse(text=reflect_text, based_on=rbo)

    parsed = parse_reflect_response(sdk_resp, bank_id="test-bank")

    assert "mental_model" in parsed
    assert isinstance(parsed["mental_model"], str)
    assert len(parsed["mental_model"]) > 20

    assert "supporting_incidents" in parsed
    assert isinstance(parsed["supporting_incidents"], list)
    assert "INC-184" in parsed["supporting_incidents"]
    assert "INC-127" in parsed["supporting_incidents"]
    for inc in parsed["supporting_incidents"]:
        assert not inc.startswith("<ReflectFact"), "Raw object repr must not be exposed"

    assert "patterns" in parsed
    assert len(parsed["patterns"]) >= 2
    assert any("redis" in p.lower() for p in parsed["patterns"])

    assert "recommended_operational_rules" in parsed
    assert len(parsed["recommended_operational_rules"]) >= 2
    assert any("rule" in r.lower() for r in parsed["recommended_operational_rules"])


def test_api_reflect_operational_mental_model():
    """Verify POST and GET /api/reflect endpoints return consolidated DevOps mental models."""
    client = TestClient(app)

    # 1. Test POST /api/reflect
    post_res = client.post("/api/reflect", json={"bank_id": "test-bank"})
    assert post_res.status_code == 200
    post_data = post_res.json()

    assert "mental_model" in post_data
    assert "supporting_incidents" in post_data
    assert "patterns" in post_data
    assert "recommended_operational_rules" in post_data
    assert isinstance(post_data["supporting_incidents"], list)
    assert isinstance(post_data["patterns"], list)
    assert isinstance(post_data["recommended_operational_rules"], list)
    assert len(post_data["supporting_incidents"]) > 0
    assert len(post_data["patterns"]) > 0
    assert len(post_data["recommended_operational_rules"]) > 0

    # 2. Test GET /api/reflect (backward compatible)
    get_res = client.get("/api/reflect?bank_id=test-bank")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert "mental_model" in get_data
    assert "supporting_incidents" in get_data

    # Must focus on operational concepts, not emotions
    ref_text = post_data.get("reflection", "") + post_data.get("mental_model", "")
    assert "redis" in ref_text.lower() or "checkout" in ref_text.lower() or "incident" in ref_text.lower()
    assert "emotion" not in ref_text.lower()
    assert "feeling" not in ref_text.lower()
    assert "psychological" not in ref_text.lower()


def test_seed_historical_incidents_and_verification():
    """
    Phase 3: Verify deterministic seed of 12 historical incidents and benchmark Recall.
    Queries:
    - 'checkout timeout'
    - 'Redis connection exhaustion'
    - 'payment latency'
    """
    from backend.seed import seed_historical_incidents, verify_seeded_incidents, HISTORICAL_INCIDENTS

    bank = SimulatedMemoryBank(bank_id="test-seed-bank")
    seed_report = seed_historical_incidents(client=None, bank_id="test-seed-bank", fallback_bank=bank)

    assert seed_report["status"] == "success"
    assert seed_report["seeded_count"] == len(HISTORICAL_INCIDENTS)
    assert seed_report["seeded_count"] >= 12

    # Run verification queries
    verify_report = verify_seeded_incidents(client=None, bank_id="test-seed-bank", fallback_bank=bank)
    assert verify_report["verification_status"] == "passed"

    # Verify specific queries
    results_map = {r["query"]: r for r in verify_report["results"]}

    checkout_res = results_map.get("checkout timeout")
    assert checkout_res is not None
    assert checkout_res["recalled_count"] > 0
    assert "INC-184" in checkout_res["matched_precedents"]

    redis_res = results_map.get("Redis connection exhaustion")
    assert redis_res is not None
    assert redis_res["recalled_count"] > 0
    assert any(inc_id in redis_res["matched_precedents"] for inc_id in ["INC-101", "INC-184", "INC-127"])

    payment_res = results_map.get("payment latency")
    assert payment_res is not None
    assert payment_res["recalled_count"] > 0
    assert "INC-127" in payment_res["matched_precedents"]


def test_post_seed_incidents_endpoint():
    """Verify POST /api/seed-incidents endpoint."""
    client = TestClient(app)

    response = client.post("/api/seed-incidents?bank_id=api-test-bank")
    assert response.status_code == 200
    data = response.json()

    assert data["status"] == "success"
    assert data["seeded_count"] >= 12
    assert "verification" in data
    assert data["verification"]["verification_status"] == "passed"
    assert len(data["verification"]["results"]) >= 5
