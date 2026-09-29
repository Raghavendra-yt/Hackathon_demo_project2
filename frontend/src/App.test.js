import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import App from './App';

jest.mock('axios');

const mockReflection = {
  mental_model: 'Checkout timeouts frequently correlate with Redis connection saturation during traffic spikes.',
  supporting_incidents: ['INC-184', 'INC-203'],
  patterns: ['Redis buffer saturation', 'Gateway cascade timeouts'],
  recommended_operational_rules: ['Check pool saturation before code changes']
};

const mockCatalog = {
  total: 1,
  incidents: [
    {
      incident_id: 'INC-184',
      service: 'Checkout API',
      severity: 'P1',
      status: 'resolved',
      symptoms: '504 gateway timeout',
      root_cause: 'Redis pool exhaustion',
      remediation: 'Increased pool to 200'
    }
  ]
};

const mockConfig = {
  status: 'online',
  has_groq: true,
  has_hindsight: true,
  bank_id: 'devops-demo-team',
  domain: 'DevOps Incident Response',
  active_engine: 'Groq (openai/gpt-oss-120b)',
  seeded_incidents: 12,
  mode: 'live_cloud'
};

const mockChatSuccess = {
  response: '### 🚨 DevOps Incident Triage: Checkout API (P1)\nRoot cause: Redis connection pool exhaustion.',
  analysis: 'Checkout API requests are timing out due to connection saturation.',
  root_cause_hypotheses: ['Redis connection pool exhaustion'],
  recommended_actions: ['Scale spring.redis.jedis.pool.max-active from 50 to 200'],
  verification_steps: ['Verify 504 error rate drops below 0.01%'],
  recalled_memories: [
    {
      id: 'mem_1',
      incident_id: 'INC-184',
      service: 'Checkout API',
      severity: 'P1',
      root_cause: 'Redis connection pool exhaustion',
      remediation: 'Increased connection pool max-active to 200',
      symptom: '504 Gateway Timeouts',
      relevance: 'High semantic similarity'
    }
  ],
  memory_lifecycle: {
    stage: 'completed',
    recall_count: 1,
    retained: true,
    incident_id: 'INC-2026-0929',
    bank_id: 'devops-demo-team'
  }
};

const mockCompareSuccess = {
  query: 'Production checkout is timing out again.',
  bank_id: 'devops-demo-team',
  cold_agent: {
    mode: 'Cold Agent (Stateless)',
    description: 'Stateless baseline',
    recalled_count: 0,
    recalled_memories: [],
    analysis: 'Generic checkout troubleshooting without historical context.',
    root_cause_hypotheses: ['Generic thread exhaustion'],
    investigation_steps: ['Check CPU and memory'],
    recommended_actions: ['Restart application pod'],
    verification_steps: ['Check pod logs'],
    memory_impact: 'No historical context available.'
  },
  memory_agent: {
    mode: 'MemOS Memory-Enabled Agent',
    description: 'Virtual Memory page-in enabled',
    recalled_count: 1,
    recalled_memories: [
      {
        incident_id: 'INC-184',
        service: 'Checkout API',
        root_cause: 'Redis connection pool exhaustion'
      }
    ],
    recalled_incident_ids: ['INC-184'],
    analysis: 'Informed by INC-184 Redis pool precedent.',
    root_cause_hypotheses: ['Redis connection pool exhaustion (similar to INC-184)'],
    investigation_steps: ['Check Redis active connections and pool saturation'],
    recommended_actions: ['Scale pool size max-active to 200'],
    verification_steps: ['Verify 504 latency returns below threshold'],
    memory_impact: 'Prior incident INC-184 directly informed root cause.'
  },
  impact_analysis: {
    recalled_incidents: ['INC-184'],
    historical_root_causes: ['INC-184: Redis connection pool exhaustion'],
    previous_remediations: ['INC-184: Increased connection pool'],
    operational_mental_model: 'Checkout timeouts correlate with Redis saturation.',
    supporting_incidents: ['INC-184'],
    patterns: ['Redis saturation under flash traffic'],
    prescriptive_rules: ['Tune connection pool before altering business logic']
  }
};

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();

  axios.get.mockImplementation((url) => {
    if (url.includes('/api/config')) {
      return Promise.resolve({ data: mockConfig });
    }
    if (url.includes('/api/incidents')) {
      return Promise.resolve({ data: mockCatalog });
    }
    if (url.includes('/api/reflect')) {
      return Promise.resolve({ data: mockReflection });
    }
    return Promise.resolve({ data: {} });
  });

  axios.post.mockImplementation((url) => {
    if (url.includes('/api/reflect')) {
      return Promise.resolve({ data: mockReflection });
    }
    if (url.includes('/api/chat')) {
      return Promise.resolve({ data: mockChatSuccess });
    }
    if (url.includes('/api/demo/compare-memory')) {
      return Promise.resolve({ data: mockCompareSuccess });
    }
    return Promise.resolve({ data: {} });
  });
});

// A. Normal Chat Render & Basic Controls
test('A. Renders header, status badge, and memory controls in Normal Chat', () => {
  render(<App />);
  expect(screen.getByText(/MemOS Agent/i)).toBeInTheDocument();
  expect(screen.getByText(/Virtual Memory Architecture for Autonomous AI Agents/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/Describe incident symptoms/i)).toBeInTheDocument();
});

// B. Loading state
test('B. Displays loading state while processing incident query', async () => {
  axios.post.mockImplementation((url) => {
    if (url.includes('/api/reflect')) return Promise.resolve({ data: mockReflection });
    if (url.includes('/api/chat')) return new Promise(() => {}); // pending
    return Promise.resolve({ data: {} });
  });

  render(<App />);
  const input = screen.getByPlaceholderText(/Describe incident symptoms/i);
  fireEvent.change(input, { target: { value: 'Production checkout is timing out' } });

  const sendBtn = screen.getByRole('button', { name: /^Triage$/i });
  fireEvent.click(sendBtn);

  expect(screen.getAllByText(/User Incident Ingestion/i).length).toBeGreaterThan(0);
});

// C. Recall results displayed
test('C. Renders actual recalled memory objects with incident_id and root_cause', async () => {
  render(<App />);
  const input = screen.getByPlaceholderText(/Describe incident symptoms/i);
  fireEvent.change(input, { target: { value: 'Production checkout is timing out again.' } });

  const sendBtn = screen.getByRole('button', { name: /^Triage$/i });
  fireEvent.click(sendBtn);

  await waitFor(() => {
    expect(screen.getAllByText(/INC-184/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Redis connection pool exhaustion/i).length).toBeGreaterThan(0);
  });
});

// D. No memories found (Zero recalled memories)
test('D. Handles empty memory gracefully when no historical precedent exists', () => {
  render(<App />);
  expect(screen.getByText(/No Precedents Recalled Yet/i)).toBeInTheDocument();
});

// E & F. LLM failure handled gracefully
test('E/F. Displays error banner when backend or LLM fails', async () => {
  axios.post.mockImplementation((url) => {
    if (url.includes('/api/reflect')) return Promise.resolve({ data: mockReflection });
    if (url.includes('/api/chat')) return Promise.reject(new Error('500 Internal Server Error'));
    return Promise.resolve({ data: {} });
  });

  render(<App />);
  const input = screen.getByPlaceholderText(/Describe incident symptoms/i);
  fireEvent.change(input, { target: { value: 'Fault query' } });
  fireEvent.click(screen.getByRole('button', { name: /^Triage$/i }));

  await waitFor(() => {
    expect(screen.getByText(/Error communicating with MemOS backend/i)).toBeInTheDocument();
  });
});

// H. Reflect result displayed
test('H. Renders operational mental model from Reflect consolidation', async () => {
  render(<App />);
  await waitFor(() => {
    expect(screen.getAllByText(/Checkout timeouts frequently correlate with Redis connection saturation/i).length).toBeGreaterThan(0);
  });
});

// J. Demo comparison modal
test('J. Opens Memory Impact comparison modal and renders Cold vs Memory-Enabled views', async () => {
  render(<App />);
  const compareBtn = screen.getByTitle(/Phase 7 Controlled Demonstration/i);
  fireEvent.click(compareBtn);

  await waitFor(() => {
    expect(screen.getByText(/Controlled Memory Impact Demonstration/i)).toBeInTheDocument();
  });

  // Run controlled comparison inside modal
  const runCompareBtn = screen.getByRole('button', { name: /Run Controlled Comparison/i });
  fireEvent.click(runCompareBtn);

  await waitFor(() => {
    expect(screen.getAllByText(/COLD AGENT/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MEMOS AGENT/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Stateless Zero-Shot/i)).toBeInTheDocument();
  });
});

// K. Lifecycle indicators
test('K. Displays complete virtual memory architecture lifecycle (RECALL, RAM, RETAIN, REFLECT)', () => {
  render(<App />);
  expect(screen.getAllByText(/RECALL/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/RAM/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/RETAIN/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/REFLECT/i).length).toBeGreaterThan(0);
});
