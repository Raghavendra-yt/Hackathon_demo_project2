"""
Phase 7: Backend Tests for Memory Impact Demonstration

Tests the controlled side-by-side evaluation endpoint:
  POST /api/demo/compare-memory

Validates factual differences between:
  A. COLD AGENT (Stateless / zero recalled memories)
  B. MEMORY-ENABLED AGENT (Persistent Virtual Memory Recall via Hindsight)
"""

import sys
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import pytest
from starlette.testclient import TestClient
from backend.main import app


@pytest.fixture(scope="module")
def client():
    # Ensure baseline incidents are seeded before running comparison tests
    c = TestClient(app)
    c.post("/api/seed-incidents?bank_id=devops-demo-team")
    return c


def test_compare_memory_checkout_scenario(client):
    """
    Test side-by-side comparison for checkout timeout scenario:
    'Production checkout is timing out again.'
    """
    query = "Production checkout is timing out again."
    resp = client.post("/api/demo/compare-memory", json={
        "query": query,
        "bank_id": "devops-demo-team"
    })
    assert resp.status_code == 200, f"Compare memory failed: {resp.text}"
    data = resp.json()

    assert data["query"] == query
    assert data["bank_id"] == "devops-demo-team"

    # 1. Assert COLD AGENT properties
    cold = data["cold_agent"]
    assert cold["recalled_count"] == 0
    assert len(cold["recalled_memories"]) == 0
    assert len(cold["analysis"]) > 20
    assert len(cold["root_cause_hypotheses"]) >= 1
    assert len(cold["recommended_actions"]) >= 1
    assert len(cold["verification_steps"]) >= 1

    # 2. Assert MEMORY-ENABLED AGENT properties
    mem = data["memory_agent"]
    assert mem["recalled_count"] > 0
    assert len(mem["recalled_memories"]) > 0
    assert len(mem["recalled_incident_ids"]) > 0
    # Must retrieve INC-184 or checkout/Redis precedent
    recalled_ids_str = str(mem["recalled_incident_ids"])
    recalled_text_str = str(mem["recalled_memories"]).lower()
    assert ("INC-184" in recalled_ids_str or "checkout" in recalled_text_str or "redis" in recalled_text_str)
    assert len(mem["analysis"]) > 20
    assert len(mem["root_cause_hypotheses"]) >= 1
    assert len(mem["recommended_actions"]) >= 1
    assert len(mem["verification_steps"]) >= 1
    assert len(mem["memory_impact"]) > 10

    # 3. Assert FACTUAL IMPACT ANALYSIS
    impact = data["impact_analysis"]
    assert len(impact["recalled_incidents"]) > 0
    assert len(impact["historical_root_causes"]) > 0
    assert len(impact["previous_remediations"]) > 0
    assert len(impact["investigation_difference"]) > 20
    assert len(impact["operational_mental_model"]) > 20
    assert len(impact["supporting_incidents"]) > 0


def test_compare_memory_payment_scenario(client):
    """
    Test side-by-side comparison for payment service timeout scenario:
    'Payment Service is returning 504 timeouts on /api/v1/charge.'
    """
    query = "Payment Service is returning 504 timeouts on /api/v1/charge."
    resp = client.post("/api/demo/compare-memory", json={
        "query": query,
        "bank_id": "devops-demo-team"
    })
    assert resp.status_code == 200, f"Compare memory failed: {resp.text}"
    data = resp.json()

    cold = data["cold_agent"]
    mem = data["memory_agent"]

    assert cold["recalled_count"] == 0
    assert mem["recalled_count"] > 0
    # Should recall payment/Redis precedent (e.g. INC-127 or INC-195)
    recalled_str = str(mem["recalled_incident_ids"]) + " " + str(mem["recalled_memories"]).lower()
    assert ("inc-127" in recalled_str.lower() or "payment" in recalled_str.lower() or "inc-195" in recalled_str.lower())
    assert len(data["impact_analysis"]["historical_root_causes"]) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
