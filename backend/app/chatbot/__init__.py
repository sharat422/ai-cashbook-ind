"""Read-only voice/text chatbot ("Ask AI").

The LLM never touches the database. It may only call the tools in tools.py,
which run with the authenticated merchant's business injected by the server.
"""
