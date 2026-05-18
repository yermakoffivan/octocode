# LangChain Patterns Reference

Load this file when: implementing batch processing, fallback chains, advanced RAG, LangGraph agents, or human-in-the-loop.

---

## LCEL Advanced Patterns

### Batch Processing
```python
# Process list of inputs in parallel
results = await chain.abatch([
    {"input": "question 1"},
    {"input": "question 2"},
], config={"max_concurrency": 5})
```

### Fallback Chains
```python
# Primary LLM with cheaper fallback
fast_llm = ChatAnthropic(model="claude-haiku-4-5")
smart_llm = ChatAnthropic(model="claude-opus-4-7")

chain_with_fallback = (prompt | smart_llm | parser).with_fallbacks(
    [prompt | fast_llm | parser]
)
```

### Retry Logic
```python
from langchain_core.runnables import RunnableRetry

reliable_chain = chain.with_retry(
    retry_if_exception_type=(RateLimitError, TimeoutError),
    stop_after_attempt=3,
    wait_exponential_jitter=True,
)
```

### Custom Runnables
```python
from langchain_core.runnables import RunnableLambda

def validate_and_clean(text: str) -> str:
    return text.strip().lower()

clean_step = RunnableLambda(validate_and_clean)
chain = prompt | llm | StrOutputParser() | clean_step
```

### Embedding Cache
```python
from langchain.storage import LocalFileStore
from langchain.embeddings import CacheBackedEmbeddings

store = LocalFileStore("./embedding_cache")
cached_embedder = CacheBackedEmbeddings.from_bytes_store(
    underlying_embeddings=OpenAIEmbeddings(),
    document_embedding_cache=store,
    namespace="openai-text-embedding-3-small",
)
```

---

## Advanced RAG Patterns

### Parent-Document Retriever
Returns full parent chunks instead of small child chunks — better answer quality.
```python
from langchain.retrievers import ParentDocumentRetriever
from langchain.storage import InMemoryStore

child_splitter = RecursiveCharacterTextSplitter(chunk_size=400)
parent_splitter = RecursiveCharacterTextSplitter(chunk_size=2000)

store = InMemoryStore()
retriever = ParentDocumentRetriever(
    vectorstore=vectorstore,
    docstore=store,
    child_splitter=child_splitter,
    parent_splitter=parent_splitter,
)
retriever.add_documents(docs)
```

### Multi-Query Retriever
Generates multiple search queries from one question; increases recall.
```python
from langchain.retrievers.multi_query import MultiQueryRetriever

retriever = MultiQueryRetriever.from_llm(
    retriever=vectorstore.as_retriever(),
    llm=llm,
    include_original=True,
)
```

### Contextual Compression
Strips irrelevant content from retrieved chunks before sending to LLM.
```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import LLMChainExtractor

compressor = LLMChainExtractor.from_llm(llm)
compression_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=vectorstore.as_retriever(search_kwargs={"k": 10}),
)
```

### Hybrid Search (Keyword + Vector)
```python
from langchain_community.retrievers import BM25Retriever
from langchain.retrievers import EnsembleRetriever

bm25_retriever = BM25Retriever.from_documents(docs, k=5)
vector_retriever = vectorstore.as_retriever(search_kwargs={"k": 5})

hybrid_retriever = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.4, 0.6],
)
```

---

## LangGraph Agent Patterns

### Basic ReAct Agent
```python
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()
agent = create_react_agent(
    model=llm,
    tools=[search_tool, calculator_tool],
    checkpointer=memory,
)

result = await agent.ainvoke(
    {"messages": [("human", "What is 2+2?")]},
    config={"configurable": {"thread_id": "session-1"}},
)
```

### Custom StateGraph Agent
```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    tool_calls: int

def should_continue(state: AgentState) -> str:
    # Stop after 5 tool calls to prevent infinite loops
    if state["tool_calls"] >= 5:
        return END
    if state["messages"][-1].tool_calls:
        return "tools"
    return END

workflow = StateGraph(AgentState)
workflow.add_node("agent", call_model)
workflow.add_node("tools", call_tools)
workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", should_continue)
workflow.add_edge("tools", "agent")
app = workflow.compile(checkpointer=MemorySaver())
```

### Human-in-the-Loop
```python
from langgraph.checkpoint.memory import MemorySaver

# Compile with interrupt before sensitive tools
app = workflow.compile(
    checkpointer=MemorySaver(),
    interrupt_before=["tools"],  # pause before tool execution
)

# Run until interrupt
result = await app.ainvoke(input, config)

# Human reviews; then resume
result = await app.ainvoke(None, config)  # None = resume from checkpoint
```

### Persistence with PostgreSQL
```python
from langgraph.checkpoint.postgres import PostgresSaver

with PostgresSaver.from_conn_string(DATABASE_URL) as checkpointer:
    checkpointer.setup()
    app = workflow.compile(checkpointer=checkpointer)
```
