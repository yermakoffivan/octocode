# LangChain Anti-Patterns

Load this file when: debugging production issues, reviewing code for quality, or diagnosing unexpected agent behavior.

---

## Critical Anti-Patterns

### 1. Using Legacy Chains
**Symptom**: Importing `LLMChain`, `ConversationalChain`, `RetrievalQA`, `ConversationalRetrievalChain`
**Root cause**: These predate LCEL and are no longer maintained
**Fix**: Rewrite with LCEL pipe syntax (`prompt | llm | parser`)
**Impact**: Deprecated classes miss streaming, async, tracing improvements

### 2. Unbounded Memory
**Symptom**: Passing full `chat_history` list to LLM; context errors; growing costs per session
**Root cause**: `ConversationBufferMemory` stores everything; no token limit
**Fix**:
```python
# Bad
memory = ConversationBufferMemory(return_messages=True)

# Good — summarize old messages, keep recent N turns
from langchain.memory import ConversationSummaryBufferMemory
memory = ConversationSummaryBufferMemory(
    llm=llm, max_token_limit=2000, return_messages=True
)
```

### 3. Vague Tool Descriptions → Infinite Loops
**Symptom**: Agent calls the same tool repeatedly; never reaches a conclusion
**Root cause**: Tool description doesn't tell the model when to stop or what the tool cannot do
**Fix**: Add explicit scope, failure mode, and "do not use when" guidance:
```python
# Bad
description = "Useful for getting information"

# Good
description = (
    "Search news articles published in the last 7 days. "
    "Returns top 5 results with title, date, and summary. "
    "Returns empty list if no recent articles found. "
    "Do NOT use for historical facts or code questions."
)
```

### 4. Sync Calls in Async Context
**Symptom**: FastAPI / Starlette event loop blocked; timeouts; worker starvation
**Root cause**: Using `chain.invoke()` inside `async def` endpoint
**Fix**: Always use `await chain.ainvoke()` in async functions

### 5. Re-embedding on Every Run
**Symptom**: Slow startup; high embedding API costs; identical embeddings computed repeatedly
**Root cause**: Creating vectorstore from documents without a cache
**Fix**: Use `CacheBackedEmbeddings` (see `references/patterns.md`)

### 6. No Tool Error Handling
**Symptom**: Agent crashes when a tool fails; no retry; bad UX
**Root cause**: `BaseTool` default raises exceptions that terminate the agent
**Fix**: Set `handle_tool_error=True` and define `_arun` for async contexts

### 7. Missing Pydantic Schema on Tools
**Symptom**: LLM calls tools with wrong argument types or missing required fields
**Root cause**: `@tool` without `args_schema` infers schema from docstring only
**Fix**: Always define `args_schema: type[BaseModel]` on every tool class

### 8. Not Using Structured Output
**Symptom**: JSON parsing failures; model returns extra text around JSON; brittle `re.search()` workarounds
**Root cause**: Using `JsonOutputParser` or string parsing instead of model-native structured output
**Fix**:
```python
# Bad
chain = prompt | llm | JsonOutputParser()

# Good — uses model's function-calling for reliable output
chain = prompt | llm.with_structured_output(MyModel)
```

### 9. In-Memory Vector Store in Production
**Symptom**: All embeddings lost on restart; re-ingestion required on every deploy
**Root cause**: `FAISS.from_documents()` without `save_local()`; or Chroma without `persist_directory`
**Fix**: Always set persistence path and load on startup:
```python
# Save
vectorstore.save_local("./faiss_index")
# Load
vectorstore = FAISS.load_local("./faiss_index", embeddings, allow_dangerous_deserialization=True)
```

### 10. No Stop Conditions in Agent Prompt
**Symptom**: Agent loops 50+ times; runaway API costs
**Root cause**: Nothing in the prompt or graph tells the agent when to give up
**Fix**: Add to system prompt:
```
If you cannot find the answer after 3 tool calls, respond with what you know so far.
Do not call the same tool twice with the same arguments.
```
And add max-iteration guard in LangGraph (see `references/patterns.md` § Custom StateGraph Agent).

---

## Warnings (Elevated but Not Critical)

### AgentExecutor for Complex Workflows
AgentExecutor handles simple single-level tool calls adequately, but breaks down with:
- Parallel tool branches
- Conditional routing
- Long-running tasks needing persistence
Migrate to LangGraph when complexity grows.

### Using `similarity` Search for Diverse Retrieval
`search_type="similarity"` can return 6 nearly identical chunks. Use `"mmr"` (Maximal Marginal Relevance) when diversity matters.

### Missing `run_name` in Config
Without it, LangSmith shows every trace as the chain's class name. Always set `config={"run_name": "..."}`.
