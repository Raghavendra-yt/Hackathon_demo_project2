"""
Section 11: Empty Memory Test

Validates agent behavior when querying an incident with no historical precedent:
Query: "Production image processing service is failing because of an unknown GPU driver error."
- Recall returns zero or no relevant memories.
- LLM still produces a valid operational response.
- Response contains analysis, hypotheses, actions, and verification.
- No fake historical incident precedent is created.
- Formatted recalled memory block gracefully handles empty memory.
"""

import pytest
from starlette.testclient import TestClient
from backend.main import app
from backend.memory import (
    execute_recall,
    format_recalled_memories_for_prompt,
    SimulatedMemoryBank
)
from backend.main import hindsight_client, fallback_bank


def test_empty_memory_query_and_clean_llm_response():
    """
    Verify querying an incident with no historical precedent returns 0 memories,
    does not invent fake historical incidents, and LLM still generates valid operational guidance.
    """
    empty_bank_id = "test-empty-bank-isolated"
    novel_query = "Production image processing service is failing because of an unknown GPU driver error."

    # 1. Verify Recall on empty bank returns 0 memories
    recalled = execute_recall(
        client=hindsight_client,
        query=novel_query,
        bank_id=empty_bank_id,
        fallback_bank=fallback_bank
    )
    assert len(recalled) == 0, "Recall on an empty bank should return 0 memories"

    # 2. Verify format_recalled_memories_for_prompt produces the clean empty notice
    prompt_context = format_recalled_memories_for_prompt(recalled)
    assert "No prior historical incidents found" in prompt_context
    assert "=== END HISTORICAL MEMORIES ===" in prompt_context

    # 3. Call /api/chat with empty bank
    client = TestClient(app)
    response = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": novel_query}],
            "use_memory": True,
            "bank_id": empty_bank_id
        }
    )

    assert response.status_code == 200
    data = response.json()

    # Verify zero recalled memories were returned in response
    assert len(data.get("recalled_memories", [])) == 0

    # Verify LLM produced valid operational response structure despite empty memory
    assert "analysis" in data and len(data["analysis"]) > 0
    assert "root_cause_hypotheses" in data and len(data["root_cause_hypotheses"]) > 0
    assert "recommended_actions" in data and len(data["recommended_actions"]) > 0
    assert "verification_steps" in data and len(data["verification_steps"]) > 0

    # Verify the response acknowledges 0 historical memories / no precedent exists
    memory_impact = data.get("memory_impact", "").lower()
    analysis = data.get("analysis", "").lower()
    combined_response = memory_impact + " " + analysis
    assert (
        "0 recalled" in combined_response or
        "recalled 0" in combined_response or
        "no prior" in combined_response or
        "first occurrence" in combined_response or
        "stateless" in combined_response or
        "no historical" in combined_response
    )
