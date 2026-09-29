"""
Integration Tests: Reflect Consolidation and Future Recall
Validates:
- Seeding related incidents across services and failure modes
- Execution of Reflect memory consolidation
- Verification of mental models, supporting incidents, failure patterns, and rules
- Reflect -> Future Recall: Using consolidated operational knowledge for future diagnostic inquiries
- Absence of raw Hindsight SDK objects
"""

import pytest
from starlette.testclient import TestClient
from backend.main import app
from backend.memory import (
    IncidentRecord,
    execute_retain,
    execute_reflect,
    execute_recall,
    SimulatedMemoryBank
)


def test_reflect_memory_consolidation_across_related_incidents():
    """
    Section 8: Reflect Tests
    Seed related incidents, consolidate via Reflect, and verify operational knowledge synthesis.
    """
    client = TestClient(app)
    bank_id = "test-bank-reflect-consolidation"
    from backend.main import fallback_bank

    # 1. Seed several related incidents
    incidents = [
        IncidentRecord(
            incident_id="INC-REF-01",
            service="Checkout API",
            severity="P1",
            symptoms="Checkout 504 Gateway Timeouts under traffic surge",
            investigation="Worker threads blocked on Jedis connection acquisition",
            root_cause="Redis connection pool exhaustion during traffic surge",
            remediation="Increased Jedis max-active from 50 to 250",
            verification="Errors dropped to 0%"
        ),
        IncidentRecord(
            incident_id="INC-REF-02",
            service="Checkout API",
            severity="P2",
            symptoms="Checkout latency degraded to 1200ms",
            investigation="Redis active connection count pegged near max clients",
            root_cause="Redis connection saturation causing queueing delay",
            remediation="Tuned max-wait-millis to 1000ms and scaled connection pool",
            verification="Latency normalized to 180ms"
        ),
        IncidentRecord(
            incident_id="INC-REF-03",
            service="Payment Service",
            severity="P1",
            symptoms="Payment processing timeout on charge",
            investigation="Blocked on RedissonLock tryLock",
            root_cause="Distributed lock contention on Redis shared pool",
            remediation="Isolated distributed lock manager into dedicated Redis instance",
            verification="Lock acquisition latency dropped to 4ms"
        ),
        IncidentRecord(
            incident_id="INC-REF-04",
            service="Checkout API",
            severity="P1",
            symptoms="Checkout database transactions timing out",
            investigation="Postgres active connections at max (500/500)",
            root_cause="Database connection pool exhaustion due to slow queries",
            remediation="Added statement timeout and scaled PgBouncer pool",
            verification="Connection utilization stabilized at 40%"
        )
    ]

    for inc in incidents:
        execute_retain(client=None, bank_id=bank_id, incident_data=inc, fallback_bank=fallback_bank)

    # 2. Run Reflect
    reflect_data = execute_reflect(client=None, bank_id=bank_id, fallback_bank=fallback_bank)

    # 3. Assertions
    assert "mental_model" in reflect_data
    assert isinstance(reflect_data["mental_model"], str)
    assert len(reflect_data["mental_model"]) > 20

    assert "supporting_incidents" in reflect_data
    assert isinstance(reflect_data["supporting_incidents"], list)
    assert len(reflect_data["supporting_incidents"]) > 0

    assert "patterns" in reflect_data
    assert isinstance(reflect_data["patterns"], list)
    assert len(reflect_data["patterns"]) >= 2
    # Must identify operational concepts (Redis, connection, pool, checkout)
    patterns_text = " ".join(reflect_data["patterns"]).lower()
    assert any(term in patterns_text for term in ["redis", "pool", "connection", "checkout", "timeout"])

    assert "recommended_operational_rules" in reflect_data
    assert len(reflect_data["recommended_operational_rules"]) >= 2

    # Verify no raw SDK repr objects leaked
    for item in reflect_data["supporting_incidents"]:
        assert not str(item).startswith("<ReflectFact")


def test_reflect_to_future_recall_guidance():
    """
    Section 9: Reflect -> Future Recall Test
    Verifies that consolidated operational experience is usable for future guidance questions.
    """
    client = TestClient(app)
    bank_id = "test-bank-reflect-consolidation"
    from backend.main import fallback_bank

    future_query = "What should I check first when checkout starts timing out?"

    # Query the memory-enabled chat pipeline with the guidance inquiry
    chat_resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": future_query}],
        "use_memory": True,
        "bank_id": bank_id
    })
    assert chat_resp.status_code == 200
    data = chat_resp.json()

    # Must recall accumulated experience
    assert len(data.get("recalled_memories", [])) > 0
    # Must recommend concrete operational checks based on accumulated experience
    actions_text = " ".join(data.get("recommended_actions", [])).lower()
    assert any(term in actions_text for term in ["redis", "connection", "pool", "metrics", "log", "thread"])
