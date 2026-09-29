"""
Unit Tests: LLM Response Parsing
Validates:
- Valid structured JSON
- JSON wrapped inside markdown code fences (```json ... ```)
- Malformed JSON syntax
- Missing fields and unexpected extra fields
- Empty LLM response
- Controlled fallback generation without API crash
"""

import pytest
from backend.main import extract_json_from_llm, generate_devops_fallback_response


def test_valid_structured_json():
    """Verify parsing clean, standard JSON text."""
    raw = '{"analysis": "Valid triage", "root_cause_hypotheses": ["Redis saturation"], "recommended_actions": ["Scale pool"], "verification_steps": ["Check latency"]}'
    parsed = extract_json_from_llm(raw)
    assert parsed is not None
    assert parsed["analysis"] == "Valid triage"
    assert parsed["root_cause_hypotheses"] == ["Redis saturation"]


def test_json_inside_markdown_fences():
    """Verify extracting JSON enclosed within ```json and ``` code blocks."""
    raw_fenced = """```json
{
  "analysis": "Markdown fenced triage",
  "root_cause_hypotheses": ["Connection pool exhaustion"],
  "recommended_actions": ["Increase max-active to 500"],
  "verification_steps": ["Check metrics"]
}
```"""
    parsed = extract_json_from_llm(raw_fenced)
    assert parsed is not None
    assert parsed["analysis"] == "Markdown fenced triage"
    assert parsed["recommended_actions"] == ["Increase max-active to 500"]

    raw_plain_fenced = """```
{"analysis": "Plain fenced triage", "root_cause_hypotheses": []}
```"""
    parsed_plain = extract_json_from_llm(raw_plain_fenced)
    assert parsed_plain is not None
    assert parsed_plain["analysis"] == "Plain fenced triage"


def test_malformed_json_returns_none_safely():
    """Verify malformed JSON does not raise an exception, returning None."""
    broken = '{"analysis": "unterminated string...'
    assert extract_json_from_llm(broken) is None

    garbage = 'This is plain text with no JSON at all.'
    assert extract_json_from_llm(garbage) is None


def test_empty_llm_response():
    """Verify empty or None LLM responses return None safely."""
    assert extract_json_from_llm("") is None
    assert extract_json_from_llm("   \n\t  ") is None
    assert extract_json_from_llm(None) is None


def test_fallback_engine_on_malformed_or_missing_llm_output():
    """Verify the autonomous DevOps engine generates a valid structured response when LLM output fails."""
    user_query = "Production checkout is timing out again."
    recalled_sample = [{
        "incident_id": "INC-184",
        "service": "Checkout API",
        "severity": "P1",
        "root_cause": "Redis connection pool exhaustion",
        "text": "INC-184: Redis connection pool exhaustion during flash traffic"
    }]

    fallback_data = generate_devops_fallback_response(
        user_msg=user_query,
        conversation_history=[],
        recalled_memories=recalled_sample
    )

    assert fallback_data is not None
    assert "analysis" in fallback_data
    assert "root_cause_hypotheses" in fallback_data
    assert isinstance(fallback_data["root_cause_hypotheses"], list)
    assert len(fallback_data["root_cause_hypotheses"]) > 0

    assert "recommended_actions" in fallback_data
    assert len(fallback_data["recommended_actions"]) > 0

    assert "verification_steps" in fallback_data
    assert len(fallback_data["verification_steps"]) > 0

    assert "memory_impact" in fallback_data
    assert "incident" in fallback_data
    assert fallback_data["incident"]["service"] == "Checkout API"
