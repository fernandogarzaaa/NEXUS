# KPMG Nexus: Enterprise AI Gateway (Standalone Edition)

## Overview
Project **KPMG-Nexus** is an enterprise-grade AI Gateway architected for security, compliance, and cost-efficiency. It provides a secure bridge between your internal business applications and your chosen AI model provider (Azure, AWS, or OpenAI), ensuring that sensitive data is audited and redacted *before* it leaves your infrastructure.

## Key Features
- **PII/DLP Interceptor:** Automatically scans outgoing prompts for PII (emails, credit cards, SSNs) and redacts sensitive information.
- **Compliance Swarm:** A multi-agent reasoning board that evaluates AI outputs for regulatory risk and ethical compliance.
- **Cloud-Agnostic Routing:** Decouples your application logic from specific LLM providers; switch between Azure OpenAI, AWS Bedrock, or local models via simple environment variables.

## Getting Started

### Prerequisites
- Python 3.10+
- `pip`

### 1. Installation
Clone the repository and install the dependencies:
```bash
pip install requests fastapi uvicorn pydantic
```

### 2. Configuration
The gateway is designed to be cloud-agnostic. Set your credentials using environment variables:

**On Windows (PowerShell):**
```powershell
$env:NEXUS_API_URL="https://your-api-endpoint.com/v1/chat/completions"
$env:NEXUS_API_KEY="your-secret-api-key"
```

**On Linux/macOS:**
```bash
export NEXUS_API_URL="https://your-api-endpoint.com/v1/chat/completions"
export NEXUS_API_KEY="your-secret-api-key"
```

### 3. Running the Sandbox
To run the compliance gateway simulation, execute:
```bash
python nexus_standalone.py
```
This script will:
1. Scan the input for PII.
2. If PII is found, redact it locally.
3. Forward the sanitized prompt to your configured AI gateway.
4. Return an audited, enterprise-ready brief.

## Security & Governance
This tool is built for enterprise environments. It serves as a middle-layer "Compliance Gatekeeper." No raw data is logged by default, and all redaction happens in-memory.

## Licensing & Usage
This is a proprietary enterprise architecture developed for KPMG Philippines internal technical validation. 
