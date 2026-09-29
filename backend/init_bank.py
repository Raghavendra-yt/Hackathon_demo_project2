import os
from dotenv import load_dotenv
from hindsight_client import Hindsight

load_dotenv()
HINDSIGHT_API_KEY = os.getenv("HINDSIGHT_API_KEY")

if HINDSIGHT_API_KEY:
    client = Hindsight(api_key=HINDSIGHT_API_KEY, base_url="https://api.hindsight.vectorize.io")
    try:
        client.create_bank(bank_id="chat-memory-v1")
        print("Bank created")
    except Exception as e:
        print(f"Error: {e}")
