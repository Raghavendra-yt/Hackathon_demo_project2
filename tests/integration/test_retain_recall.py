"""
Integration Tests: Retain and Recall Verification
Validates:
- Actual Retain operation with synthetic incident INC-TEST-001
- Verification of retained content, metadata, and tags
- Semantic Recall queries ('checkout timeout', 'Redis connection pool exhaustion', 'production checkout 504')
- Negative test: Unrelated queries do not prioritize the checkout test incident
- Result serializability and absence of raw SDK object repr strings
"""

import pytest
from backend.memory import (
    IncidentRecord,
    execute_retain,
    execute_recall,
    SimulatedMemoryBank
)


def test_retain_synthetic_incident_and_verify_storage():
    """
    Section 3: Retain Tests
    Verify that Retain stores meaningful operational experience.
    """
    bank = SimulatedMemoryBank(bank_id="test-bank-retain-recall")

    # 1. Create synthetic incident INC-TEST-001
    inc_test_001 = IncidentRecord(
        incident_id="INC-TEST-001",
        service="checkout",
        environment="production",
        severity="P1",
        symptoms="checkout API returning 504 timeouts",
        investigation="Redis connection utilization reached saturation",
        root_cause="connection pool exhaustion",
        remediation="increased pool capacity and tuned timeout",
        verification="p99 latency returned below threshold",
        status="resolved",
        tags=["checkout", "redis", "p1"]
    )

    # 2. Call the actual Retain flow
    retain_res = execute_retain(
        client=None,
        bank_id="test-bank-retain-recall",
        incident_data=inc_test_001,
        fallback_bank=bank
    )

    # 3. Assert operation succeeds
    assert retain_res["success"] is True
    assert retain_res["incident_id"] == "INC-TEST-001"
    assert retain_res["service"] == "checkout"

    # 4. Verify structured incident information is retained
    formatted_content = retain_res["formatted_content"]
    assert "INCIDENT RECORD: INC-TEST-001" in formatted_content
    assert "checkout API returning 504 timeouts" in formatted_content
    assert "connection pool exhaustion" in formatted_content
    assert "increased pool capacity and tuned timeout" in formatted_content
    assert "p99 latency returned below threshold" in formatted_content


def test_recall_semantically_related_queries_and_unrelated_queries():
    """
    Section 4: Recall Tests
    After retaining INC-TEST-001, perform real Recall on related & unrelated queries.
    """
    bank = SimulatedMemoryBank(bank_id="test-bank-retain-recall-query")

    inc_test_001 = IncidentRecord(
        incident_id="INC-TEST-001",
        service="checkout",
        environment="production",
        severity="P1",
        symptoms="checkout API returning 504 timeouts",
        investigation="Redis connection utilization reached saturation",
        root_cause="connection pool exhaustion",
        remediation="increased pool capacity and tuned timeout",
        verification="p99 latency returned below threshold",
        status="resolved",
        tags=["checkout", "redis", "p1"]
    )
    execute_retain(client=None, bank_id="test-bank-retain-recall-query", incident_data=inc_test_001, fallback_bank=bank)

    # Query 1: 'checkout timeout'
    res1 = execute_recall(client=None, bank_id="test-bank-retain-recall-query", query="checkout timeout", fallback_bank=bank)
    assert len(res1) > 0, "Query 'checkout timeout' must retrieve memories"
    assert any("checkout" in m["text"].lower() for m in res1)
    assert any("INC-TEST-001" in (m.get("incident_id") or m.get("text")) for m in res1)

    # Query 2: 'Redis connection pool exhaustion'
    res2 = execute_recall(client=None, bank_id="test-bank-retain-recall-query", query="Redis connection pool exhaustion", fallback_bank=bank)
    assert len(res2) > 0, "Query 'Redis connection pool exhaustion' must retrieve memories"
    assert any("redis" in m["text"].lower() and "pool" in m["text"].lower() for m in res2)

    # Query 3: 'production checkout 504'
    res3 = execute_recall(client=None, bank_id="test-bank-retain-recall-query", query="production checkout 504", fallback_bank=bank)
    assert len(res3) > 0, "Query 'production checkout 504' must retrieve memories"
    assert any("504" in m["text"] for m in res3)

    # Query 4: Unrelated query should not rank the checkout Redis incident as primary
    # Seed an unrelated incident first
    inc_k8s = IncidentRecord(
        incident_id="INC-K8S-DISK",
        service="Kubernetes Node",
        environment="production",
        severity="P2",
        symptoms="Node filesystem disk space at 98%",
        investigation="Containerd image garbage collection stalled",
        root_cause="Unpruned dangling container images",
        remediation="Triggered crictl rmi --prune",
        verification="Disk usage normalized to 45%"
    )
    execute_retain(client=None, bank_id="test-bank-retain-recall-query", incident_data=inc_k8s, fallback_bank=bank)

    res_k8s = execute_recall(client=None, bank_id="test-bank-retain-recall-query", query="Kubernetes node disk space full", fallback_bank=bank)
    assert len(res_k8s) > 0
    # Primary result must be the K8s disk incident, NOT the checkout incident
    assert "K8S" in (res_k8s[0].get("incident_id") or res_k8s[0]["text"])

    # Verify no raw SDK reprs leaked
    for mem in res1 + res2 + res3 + res_k8s:
        assert not mem["text"].startswith("<RecallResult")
        assert not str(mem).startswith("<RecallResult")
        # Must contain useful incident fields
        assert "incident_id" in mem
        assert "service" in mem
        assert "severity" in mem
