import requests
import os

# Configuration for Standalone Deployment
# Users can point this to any OpenAI-compatible endpoint (Azure, AWS, or local Ollama)
API_ENDPOINT = os.getenv("NEXUS_API_URL", "https://api.openai.com/v1/chat/completions")
API_KEY = os.getenv("NEXUS_API_KEY", "YOUR_KEY_HERE")

def call_llm(messages):
    """
    Generic bridge that works with standard LLM providers.
    No local Aegis/Chimera Swarm required.
    """
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "gpt-4o", # Or any other standard model
        "messages": messages
    }
    
    response = requests.post(API_ENDPOINT, headers=headers, json=payload)
    return response.json()["choices"][0]["message"]["content"]

def main():
    print("--- KPMG NEXUS: STANDALONE MODE ---")
    user_input = input("Enter prompt: ")
    messages = [{"role": "user", "content": user_input}]
    
    print("[*] Contacting LLM service...")
    try:
        response = call_llm(messages)
        print(f"\n[+] Response:\n{response}")
    except Exception as e:
        print(f"[-] Failed: {e}")
        print("[!] Hint: Ensure NEXUS_API_URL and NEXUS_API_KEY are set.")

if __name__ == "__main__":
    main()
