# Emotionally Aware AI Memory Agent

An AI agent that learns from user interactions, tracks emotions, needs, and conversation themes, and adaptively updates its memory. Powered by Hindsight Cloud for memory persistence and Groq for fast LLM inference.

## Architecture

- **Backend:** FastAPI (Python)
- **Frontend:** React + Tailwind CSS
- **Memory:** Hindsight Cloud (`hindsight-client`)
- **LLM:** Groq (`openai/gpt-oss-120b`)

## Setup

1. Clone the repository.
2. Create a `.env` file in the root directory and add the following:
   ```
   HINDSIGHT_API_KEY=your_hindsight_key
   GROQ_API_KEY=your_groq_key
   PORT=8000
   ```
3. Install backend dependencies: `pip install -r requirements.txt`
4. Start the backend: `python backend/main.py`
5. Start the frontend: `cd frontend && npm start`

## Hindsight Integration

This agent uses Hindsight Cloud to remember past conversations:
- **Retain:** After each turn, the agent identifies facts to CREATE, UPDATE, or DELETE and stores them.
- **Recall:** When a user chats, the agent retrieves past similar issues and historical solutions to provide personalized responses.
- **Reflect:** The agent can synthesize learnings from all past conversations via `/api/reflect`.
