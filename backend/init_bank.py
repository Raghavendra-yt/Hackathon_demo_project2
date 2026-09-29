import os
from dotenv import load_dotenv
from hindsight_client import Hindsight

load_dotenv()
HINDSIGHT_API_KEY = os.getenv("HINDSIGHT_API_KEY")
BANK_ID = os.getenv("HINDSIGHT_BANK_ID", "devops-demo-team")

if HINDSIGHT_API_KEY and not HINDSIGHT_API_KEY.startswith("your_"):
    client = Hindsight(api_key=HINDSIGHT_API_KEY, base_url="https://api.hindsight.vectorize.io")
    try:
        client.create_bank(bank_id=BANK_ID)
        print(f"Hindsight Bank '{BANK_ID}' created successfully.")
    except Exception as e:
        print(f"Hindsight Bank Check/Create Note: {e}")
else:
    print("HINDSIGHT_API_KEY not configured. Set HINDSIGHT_API_KEY in .env")
