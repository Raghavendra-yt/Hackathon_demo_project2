"""
Integration Tests: Cold Agent vs Memory-Enabled Agent Comparison
Validates:
- Query: 'Production checkout is timing out again.'
- Cold case (use_memory=False): zero recalled memories provided to LLM
- Memory case (use_memory=True): one or more relevant historical incidents recalled and provided to LLM
- API reports the difference factually
- Verifies persistent operational experience gives additional context that a stateless agent does not have
"""

import pytest
from starlette.testclient import TestClient
from backend.main import app, BANK_ID
from backend.seed import seed_historical_incidents


def test_cold_vs_memory_comparison_reports_factual_difference():
    """
    Section 6: Cold vs Memory Test
    Execute identical incident query under Cold (stateless) and Memory-Enabled conditions.
    """
    client = TestClient(app)
    bank_id = "test-bank-cold-vs-memory"

    # Pre-seed memory bank
    from backend.main import fallback_bank
    seed_historical_incidents(client=None, bank_id=bank_id, fallback_bank=fallback_bank)

    query = "Production checkout is timing out again."

    # CASE A: Cold Agent (use_memory = False)
    cold_resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": query}],
        "use_memory": False,
        "bank_id": bank_id
    })
    assert cold_resp.status_code == 200
    cold_data = cold_resp.json()

    # Cold case must have zero recalled memories
    assert len(cold_data.get("recalled_memories", [])) == 0
    assert cold_data.get("memory_lifecycle", {}).get("recall_count") == 0

    # CASE B: Memory-Enabled Agent (use_memory = True)
    mem_resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": query}],
        "use_memory": True,
        "bank_id": bank_id
    })
    assert mem_resp.status_code == 200
    mem_data = mem_resp.json()

    # Memory case must have 1 or more recalled memories
    assert len(mem_data.get("recalled_memories", [])) > 0
    assert mem_data.get("memory_lifecycle", {}).get("recall_count") > 0

    # Test the dedicated controlled comparison endpoint
    compare_resp = client.post("/api/demo/compare-memory", json={
        "query": query,
        "bank_id": bank_id
    })
    assert compare_resp.status_code == 200
    cmp = compare_resp.json()

    assert cmp["cold_agent"]["recalled_count"] == 0
    assert cmp["memory_agent"]["recalled_count"] > 0
    assert len(cmp["impact_analysis"]["recalled_incidents"]) > 0
    assert len(cmp["impact_analysis"]["historical_root_causes"]) > 0
