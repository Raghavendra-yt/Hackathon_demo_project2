"""
Unit Tests: Recall Result Parsing
Validates:
- Valid Hindsight Recall response
- Multiple RecallResult objects
- Empty results (empty list, None, empty dict)
- Missing optional fields (no tags, scores, context)
- Metadata and context extraction
- Malformed/unknown result objects
- Guarantee: No raw Python object repr is returned
- Guarantee: Every memory is converted into a clean serializable structure
- Guarantee: Missing optional fields do not crash the API
"""

import pytest
from hindsight_client import RecallResponse, RecallResult
from backend.memory import parse_recall_results


def test_valid_recall_response_multiple_objects():
    """Verify parsing a valid RecallResponse with multiple RecallResult objects."""
    r1 = RecallResult(
        id="mem_001",
        text="INC-184: Checkout API 504 timeouts due to Redis connection pool exhaustion.",
        type="experience",
        context="DevOps Incident Triage - Checkout",
        metadata={
            "incident_id": "INC-184",
            "service": "Checkout API",
            "severity": "P1",
            "root_cause": "Redis connection pool exhaustion",
            "remediation": "Increased max-active from 50 to 200"
        },
        tags=["checkout", "redis", "p1"]
    )
    r2 = RecallResult(
        id="mem_002",
        text="INC-127: Payment timeouts during traffic spike.",
        type="experience",
        context="DevOps Incident Triage - Payment",
        metadata={
            "incident_id": "INC-127",
            "service": "Payment Service",
            "severity": "P1",
            "root_cause": "Distributed lock contention on Redis",
            "remediation": "Isolated lock manager to dedicated Redis instance"
        },
        tags=["payment", "redis", "p1"]
    )

    sdk_response = RecallResponse(results=[r1, r2])
    parsed = parse_recall_results(sdk_response)

    assert len(parsed) == 2
    assert parsed[0]["id"] == "mem_001"
    assert parsed[0]["incident_id"] == "INC-184"
    assert parsed[0]["service"] == "Checkout API"
    assert parsed[0]["severity"] == "P1"
    assert "Redis" in parsed[0]["root_cause"]
    assert "200" in parsed[0]["remediation"]

    assert parsed[1]["id"] == "mem_002"
    assert parsed[1]["incident_id"] == "INC-127"
    assert parsed[1]["service"] == "Payment Service"


def test_empty_recall_results():
    """Verify empty or None recall results do not crash and return empty list."""
    assert parse_recall_results(None) == []
    assert parse_recall_results([]) == []
    assert parse_recall_results(RecallResponse(results=[])) == []
    assert parse_recall_results({"results": []}) == []
    assert parse_recall_results({}) == []


def test_missing_optional_fields():
    """Verify RecallResult objects with missing optional fields parse cleanly without crashing."""
    r = RecallResult(
        id="mem_minimal",
        text="Incident without metadata or context"
    )
    parsed = parse_recall_results(RecallResponse(results=[r]))

    assert len(parsed) == 1
    item = parsed[0]
    assert item["id"] == "mem_minimal"
    assert item["text"] == "Incident without metadata or context"
    assert item["type"] == "experience"
    assert item["metadata"] == {}
    assert item["tags"] == []
    assert isinstance(item["incident_id"], str)
    assert isinstance(item["service"], str)
    assert isinstance(item["severity"], str)


def test_metadata_and_context_extraction():
    """Verify structured metadata fields are properly mapped to top-level incident keys."""
    r = RecallResult(
        id="mem_full",
        text="INC-300: Kafka consumer lag leading to notification delay.",
        context="Notification Service",
        metadata={
            "incident_id": "INC-300",
            "service": "Notification Service",
            "severity": "P2",
            "status": "resolved",
            "symptoms": "Messages delayed by >15 minutes",
            "root_cause": "Consumer partition rebalance storm",
            "remediation": "Tuned max.poll.interval.ms to 300000ms"
        },
        tags=["kafka", "notification"]
    )
    parsed = parse_recall_results(RecallResponse(results=[r]))

    assert len(parsed) == 1
    item = parsed[0]
    assert item["incident_id"] == "INC-300"
    assert item["service"] == "Notification Service"
    assert item["severity"] == "P2"
    assert item["symptom"] == "Messages delayed by >15 minutes"
    assert item["root_cause"] == "Consumer partition rebalance storm"
    assert "300000ms" in item["remediation"]


def test_no_raw_python_repr_returned():
    """Verify raw Python object repr strings (e.g. '<RecallResult ...>') are filtered or never leaked."""
    r_bad = RecallResult(
        id="mem_bad",
        text="<RecallResult id='mem_bad' text='...'>",
        type="experience"
    )
    parsed = parse_recall_results(RecallResponse(results=[r_bad]))
    # Must reject raw string dump of RecallResult
    assert len(parsed) == 0


def test_clean_serializable_structure():
    """Verify parsed memories are 100% JSON-serializable standard Python dicts."""
    import json
    r = RecallResult(
        id="mem_json",
        text="Database pool exhaustion on Postgres",
        metadata={"service": "postgres", "incident_id": "INC-142"}
    )
    parsed = parse_recall_results(RecallResponse(results=[r]))
    assert len(parsed) == 1

    # Must serialize to JSON without error
    json_str = json.dumps(parsed)
    assert "INC-142" in json_str
    assert "postgres" in json_str
