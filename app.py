import streamlit as st
from run_kpmg_nexus import DLPScanner, NexusComplianceBoard

# Page config
st.set_page_config(page_title="KPMG Nexus Gateway", page_icon="🛡️")

st.title("🛡️ KPMG Nexus: Enterprise AI Gateway")
st.subheader("Secure Data Governance & Compliance Audit")

# Inputs
user_input = st.text_area("Enter Client Prompt:", height=150)
if st.button("Process & Sanitize"):
    if user_input:
        dlp = DLPScanner()
        swarm = NexusComplianceBoard()
        
        # 1. DLP
        is_sensitive, flags, redacted = dlp.scan_and_redact(user_input)
        
        if is_sensitive:
            st.warning(f"PII Detected: {', '.join(flags)}")
            st.code(redacted, language="text")
        else:
            st.success("No PII detected.")
            redacted = user_input
            
        # 2. Swarm Synthesis
        with st.spinner("Compliance Swarm analyzing..."):
            brief = swarm.process(redacted)
            st.markdown("### Executive Brief")
            st.write(brief)
    else:
        st.error("Please enter a prompt.")
