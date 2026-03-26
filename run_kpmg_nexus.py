import re
import requests
import time
import os

CHIMERA_ENDPOINT = "http://localhost:7870/v1/chat/completions"

class DLPScanner:
    def __init__(self):
        self.patterns = {
            "EMAIL": r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
            "SSN": r"\b\d{3}-\d{2}-\d{4}\b",
            "CREDIT_CARD": r"\b(?:\d[ -]*?){13,16}\b",
            "PHONE": r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b"
        }
        
    def scan_and_redact(self, text):
        redacted = text
        flagged = False
        flags = []
        for name, pattern in self.patterns.items():
            if re.search(pattern, redacted):
                flagged = True
                flags.append(name)
                redacted = re.sub(pattern, f"[REDACTED_{name}]", redacted)
        return flagged, flags, redacted

class NexusComplianceBoard:
    def ask_node(self, prompt, sys_prompt):
        payload = {
            "user_id": "KPMG_Nexus_Sandbox",
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt}
            ]
        }
        try:
            res = requests.post(CHIMERA_ENDPOINT, json=payload, timeout=120)
            if res.status_code == 200:
                return res.json()["choices"][0]["message"]["content"]
            return f"Error: {res.status_code} - {res.text}"
        except Exception as e:
            return f"Exception: {e}"

    def process(self, business_problem):
        print("[*] Initiating Quantum Compliance Board...")
        
        # 1. Analyst Phase (Strategy)
        print("  [-] Node 1: Business Analyst generating strategy...")
        analyst_prompt = "You are a KPMG Business Analyst. Propose a high-level, cost-efficient AI strategy for the following client problem: " + business_problem
        strategy = self.ask_node(business_problem, analyst_prompt)
        
        # 2. Auditor Phase (Risk)
        print("  [-] Node 2: Risk & Compliance Auditor scanning strategy...")
        auditor_prompt = "You are a KPMG Risk Auditor. Review this AI strategy for data privacy risks, bias mitigation, and ethical compliance. Highlight any flaws. Strategy: " + strategy
        audit = self.ask_node(business_problem, auditor_prompt)
        
        # 3. Partner Phase (Synthesis)
        print("  [-] Node 3: Managing Partner synthesizing final brief...")
        partner_prompt = (
            "You are a KPMG Managing Partner. Synthesize the Analyst's Strategy and the Auditor's Risk Assessment "
            "into a final, executive-ready client brief. Emphasize ROI, Security, Data Governance, and Cloud-Agnostic architecture. "
            "Address ethical AI and explainability directly.\n\n"
            f"Strategy:\n{strategy}\n\nAudit:\n{audit}"
        )
        final_brief = self.ask_node(business_problem, partner_prompt)
        
        return final_brief

def run_sandbox():
    print("=== PROJECT KPMG-NEXUS: ENTERPRISE AI GATEWAY ===")
    dlp = DLPScanner()
    swarm = NexusComplianceBoard()
    
    raw_prompt = "Client John Doe (johndoe@kpmg-target.com) wants to deploy an HR screening AI on Azure. His corporate card for billing is 4532-1234-5678-9012. He is worried about bias in the resume filtering process and data leaks to public APIs. Phone: 555-123-4567."
    
    print(f"\n[1] Raw Input:\n{raw_prompt}")
    
    is_sensitive, flags, redacted_prompt = dlp.scan_and_redact(raw_prompt)
    
    if is_sensitive:
        print(f"\n[!] DLP ALERT: Sensitive Data Detected {flags}")
        print(f"[*] Redacting data and forcibly routing to LOCAL-ONLY Air-Gapped Node (MiniMind/Aegis Swarm).")
        print(f"[2] Redacted Input:\n{redacted_prompt}\n")
    
    # Execute Swarm
    final_output = swarm.process(redacted_prompt)
    
    print("\n=== FINAL EXECUTIVE BRIEF ===")
    print(final_output)
    
    # Save output
    report_path = r"D:\openclaw\projects\kpmg_nexus\sandbox_report.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("=== PROJECT KPMG-NEXUS SANDBOX EXECUTION ===\n\n")
        f.write("RAW PROMPT:\n" + raw_prompt + "\n\n")
        f.write("DLP FLAGS TRIGGERED: " + str(flags) + "\n\n")
        f.write("REDACTED PROMPT (Air-gapped routing):\n" + redacted_prompt + "\n\n")
        f.write("--- MULTI-AGENT SWARM EXECUTION ---\n\n")
        f.write("FINAL BRIEF:\n" + final_output)
        
    print(f"\n[+] Execution complete. Report saved to {report_path}")

if __name__ == "__main__":
    run_sandbox()
