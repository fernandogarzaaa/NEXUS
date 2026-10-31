# Ops documents for retrieval

Every `.md` or `.txt` file in this directory (except this README) is
indexed by the knowledge layer (`lib/knowledge/`), split into sections at
markdown headings. Answers cite the file, the section and the file's
modification time. Point `NEXUS_OPS_DOCS_DIR` at another directory to
index Senor Tech's own runbooks instead.

`exception-handling.md` describes how NEXUS itself handles exceptions,
taken from the agent and policy code in this repository. It is not a Senor
document; replace or extend it with supplied ops docs.
