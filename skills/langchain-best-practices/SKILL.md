---
name: langchain-best-practices
description: >
  Use this skill when building, debugging, reviewing, or architecting LangChain or
  LangGraph applications. Covers LCEL chain composition, agent design with LangGraph,
  RAG pipelines, memory strategies, tool validation, observability with LangSmith,
  and production anti-patterns. Trigger on: writing chains or agents, choosing between
  LangChain and LangGraph, debugging infinite loops or memory overflow, setting up RAG,
  wiring observability, or reviewing LangChain code for production readiness.
---

# LangChain Best Practices

## Architecture Decision: LangChain vs LangGraph

Choose before writing a single line:

| Need | Use |
|------|-----|
| Linear chain: prompt → LLM → output | LangChain LCEL |
| RAG pipeline | LangChain LCEL |
| Simple tool use, single-step | LangChain LCEL + `.bind_tools()` |
| Stateful agent, branching, loops | **LangGraph** |
| Human-in-the-loop | **LangGraph** |
| Multi-agent orchestration | **LangGraph** |
| Long-running tasks with persistence | **LangGraph** |

**Gotcha**: `AgentExecutor` is legacy. For any new agent work, use LangGraph's `StateGraph`.

---

## LCEL (LangChain Expression Language)

MUST use LCEL pipe syntax for all new chains. NEVER use `LLMChain`, `ConversationalChain`, or `RetrievalQA` — these are deprecated.

```python
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

llm = ChatAnthropic(model="claude-sonnet-4-6", temperature=0)
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant."),
    ("human", "{input}"),
])
chain = prompt | llm | StrOutputParser()

# Sync
result = chain.invoke({"input": "Hello"})
# Async (prefer in production)
result = await chain.ainvoke({"input": "Hello"})
# Streaming
async for chunk in chain.astream({"input": "Hello"}):
    print(chunk, end="", flush=True)
```

**Structured output** — use `.with_structured_output()` over `PydanticOutputParser`:
```python
from pydantic import BaseModel, Field

class Answer(BaseModel):
    text: str = Field(description="The answer")
    confidence: float = Field(description="0-1 confidence score")

structured_chain = prompt | llm.with_structured_output(Answer)
```

**Parallel branches** — use `RunnableParallel`:
```python
from langchain_core.runnables import RunnableParallel, RunnablePassthrough

parallel = RunnableParallel(
    summary=summarize_chain,
    keywords=keywords_chain,
    original=RunnablePassthrough(),
)
```

Read `references/patterns.md` for: batch processing, fallback chains, retry logic, custom runnables.

---

## RAG Pipelines

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.runnables import RunnablePassthrough

# MUST: use RecursiveCharacterTextSplitter (not CharacterTextSplitter)
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000, chunk_overlap=200,
    separators=["\n\n", "\n", " ", ""]
)
chunks = splitter.split_documents(docs)

# Add metadata before embedding — filters won't work without it
for chunk in chunks:
    chunk.metadata["source"] = "..."

retriever = vectorstore.as_retriever(
    search_type="mmr",  # diversity over pure similarity
    search_kwargs={"k": 6, "fetch_k": 20}
)

def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)

rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt | llm | StrOutputParser()
)
```

**Gotchas**:
- NEVER re-embed unchanged documents on every run — cache with `CacheBackedEmbeddings`
- Always persist vector stores to disk/cloud; never use in-memory only for production
- `search_type="similarity"` returns top-k by score — use `"mmr"` to avoid redundant chunks

Read `references/patterns.md` for: parent-document retriever, multi-query retriever, contextual compression, hybrid search.

---

## Agents and Tools

MUST define a Pydantic `args_schema` for every tool — bare `@tool` with no schema causes unpredictable LLM calls.

```python
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

class SearchInput(BaseModel):
    query: str = Field(description="Search query, 2-10 words, specific noun phrases only")
    max_results: int = Field(default=5, ge=1, le=20)

class SearchTool(BaseTool):
    name: str = "web_search"
    description: str = (
        "Search the web for factual information. "
        "Use when the answer requires real-time data or recent events. "
        "Do NOT use for code questions — use code_search instead."
    )
    args_schema: type[BaseModel] = SearchInput
    handle_tool_error: bool = True  # MUST: prevents agent crashes on tool failure

    def _run(self, query: str, max_results: int = 5) -> str:
        ...
```

**Tool description rules** (prevent infinite loops):
- Be specific about WHEN to use vs when NOT to use
- State input format expectations explicitly
- Name the failure mode ("returns empty string if no results")

**NEVER** expose shell execution, file system writes, or database mutations to untrusted agents.

Read `references/patterns.md` for: LangGraph agent setup, human-in-the-loop patterns, tool chaining.

---

## Memory

NEVER store unbounded chat history — it fills the context window and raises costs.

```python
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_community.chat_message_histories import RedisChatMessageHistory

# MUST: use RunnableWithMessageHistory, not ConversationBufferMemory
chain_with_history = RunnableWithMessageHistory(
    chain,
    lambda session_id: RedisChatMessageHistory(session_id, url=REDIS_URL),
    input_messages_key="input",
    history_messages_key="history",
)

result = await chain_with_history.ainvoke(
    {"input": "follow-up question"},
    config={"configurable": {"session_id": "user-123"}},
)
```

**Memory strategy by use case**:
| Volume | Strategy |
|--------|----------|
| Short sessions (<20 turns) | `InMemoryChatMessageHistory` |
| Long sessions | `ConversationSummaryBufferMemory` (summarize past, keep recent) |
| Production multi-user | Redis or PostgreSQL-backed history |
| Critical facts across sessions | Semantic memory store (vector search over past) |

**Gotcha**: `ConversationBufferMemory`, `ConversationChain` are deprecated — they pass full history unfiltered.

---

## Observability (LangSmith)

Set before running anything in development:
```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=...
export LANGCHAIN_PROJECT=my-project
```

Tag runs for filtering:
```python
result = await chain.ainvoke(
    {"input": "..."},
    config={"run_name": "rag-query", "tags": ["prod", "v2"], "metadata": {"user_id": "u-123"}}
)
```

**Gotcha**: Without `run_name`, all traces show as the chain class name — impossible to filter in LangSmith.

Read `references/production-checklist.md` for: token monitoring, cost controls, fallback models, structured logging.

---

## Anti-Pattern Gate

Check every chain/agent against this list before shipping:

- [ ] No legacy classes: `LLMChain`, `ConversationalChain`, `RetrievalQA`, `AgentExecutor`, `ConversationBufferMemory`
- [ ] All tools have Pydantic `args_schema` and `handle_tool_error=True`
- [ ] No unbounded message history passed to LLM
- [ ] Async path (`ainvoke`, `astream`) used in FastAPI / server context
- [ ] Vector store persisted; embeddings cached (`CacheBackedEmbeddings`)
- [ ] LangSmith tracing enabled with `run_name` and tags
- [ ] Agent stop conditions defined in system prompt (e.g., "Stop after 5 tool calls")
- [ ] Sensitive tools (file write, SQL, shell) guarded with human-in-the-loop or scope limits

Read `references/anti-patterns.md` for full failure taxonomy with root causes and fixes.
