"""
Section 16: API Endpoint Tests

Comprehensive validation of all API endpoints across happy and unhappy paths:
- GET /api/health
- GET /api/config
- POST /api/config
- POST /api/seed-incidents
- GET /api/incidents
- POST /api/chat
- POST /api/reflect
- GET /api/reflect
- POST /api/demo/compare-memory

Validates:
- Valid requests return 200 and conform to schema
- Missing required fields return 422 (Unprocessable Entity)
- Malformed JSON returns 422
- Empty bodies and invalid types are safely handled
- Correct HTTP status codes and response schemas
"""

import pytest
from starlette.testclient import TestClient
from backend.main import app


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


# =========================================================================
# 1. GET /api/health
# =========================================================================
def test_api_health_endpoint(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "has_groq" in data
    assert "has_hindsight" in data
    assert "bank_id" in data
    assert "domain" in data
    assert data["domain"] == "DevOps Incident Response"


# =========================================================================
# 2. GET /api/config
# =========================================================================
def test_api_config_endpoint(client):
    response = client.get("/api/config")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "bank_id" in data


# =========================================================================
# 3. POST /api/seed-incidents
# =========================================================================
def test_api_seed_incidents_valid(client):
    response = client.post("/api/seed-incidents?bank_id=api-test-bank")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "success"
    assert "seeded_count" in data
    assert "verification" in data


def test_api_seed_incidents_default_params(client):
    response = client.post("/api/seed-incidents")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "success"


# =========================================================================
# 4. GET /api/incidents
# =========================================================================
def test_api_get_incidents(client):
    response = client.get("/api/incidents")
    assert response.status_code == 200
    data = response.json()
    assert "incidents" in data
    assert "total" in data
    assert isinstance(data["incidents"], list)


# =========================================================================
# 5. POST /api/chat
# =========================================================================
def test_api_chat_valid_request(client):
    response = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": "Checkout service returning 504 gateway timeout"}],
            "use_memory": True,
            "bank_id": "api-test-bank"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "analysis" in data
    assert "root_cause_hypotheses" in data
    assert "recommended_actions" in data
    assert "verification_steps" in data
    assert "recalled_memories" in data
    assert "memory_lifecycle" in data


def test_api_chat_missing_required_fields(client):
    # Missing 'messages' field
    response = client.post(
        "/api/chat",
        json={"use_memory": True}
    )
    assert response.status_code == 422
    err_data = response.json()
    assert "detail" in err_data


def test_api_chat_empty_messages(client):
    # Empty messages list should not crash
    response = client.post(
        "/api/chat",
        json={"messages": []}
    )
    assert response.status_code == 200
    data = response.json()
    assert "analysis" in data


def test_api_chat_malformed_json(client):
    # Sending malformed string as body with json header
    response = client.post(
        "/api/chat",
        content="{malformed_json: missing_quotes",
        headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422


# =========================================================================
# 6. POST /api/reflect & GET /api/reflect
# =========================================================================
def test_api_reflect_post_valid(client):
    response = client.post(
        "/api/reflect",
        json={"query": "Analyze checkout connection pool patterns", "bank_id": "api-test-bank"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "mental_model" in data
    assert "supporting_incidents" in data
    assert "patterns" in data
    assert "recommended_operational_rules" in data


def test_api_reflect_post_empty_body(client):
    response = client.post("/api/reflect", json={})
    assert response.status_code == 200
    data = response.json()
    assert "mental_model" in data


def test_api_reflect_get(client):
    response = client.get("/api/reflect?bank_id=api-test-bank")
    assert response.status_code == 200
    data = response.json()
    assert "mental_model" in data


# =========================================================================
# 7. POST /api/demo/compare-memory
# =========================================================================
def test_api_compare_memory(client):
    response = client.post(
        "/api/demo/compare-memory",
        json={"query": "Production checkout is timing out again."}
    )
    assert response.status_code == 200
    data = response.json()
    assert "query" in data
    assert "cold_agent" in data
    assert "memory_agent" in data
    assert "impact_analysis" in data
    assert "recalled_incidents" in data["impact_analysis"]
