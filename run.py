import os
import sys
from pathlib import Path

# Ensure project root is in sys.path and is current working directory
subfolder = Path(__file__).resolve().parent / "Hackathon_demo_project1-main"
PROJECT_ROOT = subfolder if subfolder.exists() else Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))
os.chdir(str(PROJECT_ROOT))

if __name__ == "__main__":
    import uvicorn
    print(f"Starting MemOS Agent server from {PROJECT_ROOT} on http://127.0.0.1:8000 ...")
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)
