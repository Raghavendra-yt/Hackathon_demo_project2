"""
Section 19: End-to-End Demo Lifecycle Test

Deterministic 10-step test proving the entire MemOS Agent Virtual Memory lifecycle:
RECALL → LLM WORKING CONTEXT → RETAIN → REFLECT → FUTURE RECALL

STEP 1: Seed historical DevOps incidents into memory bank.
STEP 2: Ask: "Production checkout is timing out again."
STEP 3: Verify Recall retrieves relevant historical experience.
STEP 4: Verify recalled memory reaches LLM working context.
STEP 5: Verify operational response contains analysis, hypotheses, actions, verification.
STEP 6: Verify interaction is retained as a new incident.
STEP 7: Run Reflect memory consolidation.
STEP 8: Verify operational mental model is synthesized with supporting incidents.
STEP 9: Run subsequent query: "What should I check first when checkout starts timing out?"
STEP 10: Verify accumulated memory remains usable for future incident response.
"""

import pytest
from starlette.testclient import TestClient
from backend.main import app, BANK_ID


def test_complete_memos_end_to_end_lifecycle():
    client = TestClient(app)
    e2e_bank = "memos-e2e-verification-bank"

    # =========================================================================
    # STEP 1: Seed historical incidents
    # =========================================================================
    seed_resp = client.post(f"/api/seed-incidents?bank_id={e2e_bank}")
    assert seed_resp.status_code == 200, "STEP 1 FAILED: Could not seed historical incidents"
    seed_data = seed_resp.json()
    assert seed_data.get("status") == "success"
    assert seed_data.get("seeded_count", 0) >= 10, "STEP 1 FAILED: Expected at least 10 seeded incidents"

    # =========================================================================
    # STEP 2: Ask primary demo query
    # =========================================================================
    demo_query = "Production checkout is timing out again."
    chat_resp = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": demo_query}],
            "use_memory": True,
            "bank_id": e2e_bank
        }
    )
    assert chat_resp.status_code == 200, "STEP 2 FAILED: Chat endpoint returned error"
    chat_data = chat_resp.json()

    # =========================================================================
    # STEP 3: Verify Recall retrieves relevant historical experience
    # =========================================================================
    recalled = chat_data.get("recalled_memories", [])
    assert len(recalled) > 0, "STEP 3 FAILED: Recall returned 0 memories for checkout timeout"
    recalled_text = " ".join([m.get("text", "") for m in recalled]).lower()
    recalled_meta = " ".join([str(m.get("metadata", {})) for m in recalled]).lower()
    combined_recalled = recalled_text + " " + recalled_meta
    assert "checkout" in combined_recalled or "redis" in combined_recalled, (
        "STEP 3 FAILED: Recalled memory does not contain relevant checkout or redis incident context"
    )

    # =========================================================================
    # STEP 4: Verify recalled memory reaches the LLM working context
    # =========================================================================
    memory_impact = chat_data.get("memory_impact", "")
    assert len(memory_impact) > 0, "STEP 4 FAILED: LLM response lacks memory_impact explanation"
    assert "recalled" in memory_impact.lower() or "incident" in memory_impact.lower() or "precedent" in memory_impact.lower(), (
        "STEP 4 FAILED: LLM response does not reflect recalled historical context"
    )

    # =========================================================================
    # STEP 5: Verify operational response structure
    # =========================================================================
    assert "analysis" in chat_data and len(chat_data["analysis"]) > 20, "STEP 5 FAILED: Analysis missing or empty"
    hypotheses = chat_data.get("root_cause_hypotheses", [])
    assert len(hypotheses) >= 1, "STEP 5 FAILED: root_cause_hypotheses missing"
    actions = chat_data.get("recommended_actions", [])
    assert len(actions) >= 1, "STEP 5 FAILED: recommended_actions missing"
    verification = chat_data.get("verification_steps", [])
    assert len(verification) >= 1, "STEP 5 FAILED: verification_steps missing"

    # =========================================================================
    # STEP 6: Verify the interaction is retained
    # =========================================================================
    lifecycle = chat_data.get("memory_lifecycle", {})
    assert lifecycle.get("retained") is True, "STEP 6 FAILED: Interaction was not retained"
    new_incident_id = lifecycle.get("incident_id")
    assert new_incident_id is not None, "STEP 6 FAILED: No incident_id assigned for retention"

    # =========================================================================
    # STEP 7: Run Reflect memory consolidation
    # =========================================================================
    reflect_resp = client.post(
        "/api/reflect",
        json={"query": "Consolidate operational failure patterns and mitigation rules", "bank_id": e2e_bank}
    )
    assert reflect_resp.status_code == 200, "STEP 7 FAILED: Reflect endpoint returned error"
    reflect_data = reflect_resp.json()

    # =========================================================================
    # STEP 8: Verify operational mental model is produced
    # =========================================================================
    mental_model = reflect_data.get("mental_model", "")
    assert len(mental_model) > 20, "STEP 8 FAILED: Mental model missing or too short"
    supporting_incidents = reflect_data.get("supporting_incidents", [])
    assert len(supporting_incidents) >= 1, "STEP 8 FAILED: No supporting incidents linked to mental model"
    patterns = reflect_data.get("patterns", [])
    assert isinstance(patterns, list), "STEP 8 FAILED: Patterns should be a list"

    # =========================================================================
    # STEP 9: Run another related query
    # =========================================================================
    followup_query = "What should I check first when checkout starts timing out?"
    followup_resp = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": followup_query}],
            "use_memory": True,
            "bank_id": e2e_bank
        }
    )
    assert followup_resp.status_code == 200, "STEP 9 FAILED: Followup chat query returned error"
    followup_data = followup_resp.json()

    # =========================================================================
    # STEP 10: Verify accumulated memory remains usable
    # =========================================================================
    followup_recalled = followup_data.get("recalled_memories", [])
    assert len(followup_recalled) > 0, "STEP 10 FAILED: Followup query failed to retrieve accumulated memories"
    followup_text = " ".join([m.get("text", "") for m in followup_recalled]).lower()
    assert "checkout" in followup_text or "redis" in followup_text or "connection" in followup_text, (
        "STEP 10 FAILED: Accumulated memories did not provide relevant operational guidance"
    )
    assert len(followup_data.get("recommended_actions", [])) > 0, (
        "STEP 10 FAILED: Followup query did not produce operational remediation actions"
    )
