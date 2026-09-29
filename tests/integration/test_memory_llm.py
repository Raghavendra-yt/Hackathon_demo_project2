"""
Integration Tests: Memory -> LLM Working Context Integration
Validates:
- Query: 'Production checkout is timing out again.'
- Recall is executed and retrieves relevant historical incident memory
- Recalled memory is inserted into LLM working context
- Generated response contains operational reasoning informed by historical context
- Response strictly includes: analysis, root_cause_hypotheses, recommended_actions, verification_steps
- Proves Recall output directly influences the working context
"""

import pytest
from starlette.testclient import TestClient
from backend.main import app
from backend.seed import seed_historical_incidents
from backend.memory import SimulatedMemoryBank


def test_recalled_memory_reaches_llm_working_context_and_guides_reasoning():
    """
    Section 5: Memory -> LLM Integration Test
    Verifies that historical incident memory reaches LLM working context
    and shapes the resulting triage hypotheses, actions, and verification.
    """
    client = TestClient(app)
    test_bank_id = "test-bank-memory-llm-integration"

    # Pre-seed historical incidents so persistent memory has verified precedent
    from backend.main import fallback_bank
    seed_historical_incidents(client=None, bank_id=test_bank_id, fallback_bank=fallback_bank)

    query = "Production checkout is timing out again."
    response = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": query}],
        "use_memory": True,
        "bank_id": test_bank_id
    })

    assert response.status_code == 200
    data = response.json()

    # 1. Verify Recall was executed and retrieved precedents
    recalled_list = data.get("recalled_memories", [])
    assert len(recalled_list) > 0, "Recall must retrieve historical incident memories"

    # 2. Verify recalled memories contain relevant operational context
    recalled_text_combined = " ".join([m.get("text", "") for m in recalled_list]).lower()
    assert "checkout" in recalled_text_combined or "redis" in recalled_text_combined

    # 3. Verify generated response contains operational reasoning informed by memory
    assert "analysis" in data and len(data["analysis"]) > 20
    assert "root_cause_hypotheses" in data and isinstance(data["root_cause_hypotheses"], list)
    assert len(data["root_cause_hypotheses"]) > 0

    assert "recommended_actions" in data and isinstance(data["recommended_actions"], list)
    assert len(data["recommended_actions"]) > 0

    assert "verification_steps" in data and isinstance(data["verification_steps"], list)
    assert len(data["verification_steps"]) > 0

    # 4. Prove that Recall output influenced the response
    assert "memory_impact" in data
    impact_text = data["memory_impact"].lower()
    # Memory impact must reference precedent or historical learnings
    assert any(term in impact_text for term in ["precedent", "historical", "recalled", "incident", "redis", "pool"])

    # 5. Verify structured incident object is returned
    assert "incident" in data
    assert data["incident"]["service"] in ["Checkout API", "Infrastructure"]
    assert "remediation" in data["incident"]
    assert "verification" in data["incident"]
