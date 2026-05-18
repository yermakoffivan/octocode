# LangChain Production Checklist

Load this file when: deploying to production, setting up monitoring, or doing a pre-ship review.

---

## Pre-Deploy Checklist

### Observability
- [ ] `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY` set in env
- [ ] `LANGCHAIN_PROJECT` set to the service name (not "default")
- [ ] All chain invocations include `run_name`, `tags`, and `metadata` in config
- [ ] LangSmith datasets created for regression testing key prompts
- [ ] Token usage monitored via LangSmith or custom `on_llm_end` callback

### Reliability
- [ ] Fallback LLM configured (e.g., Opus → Sonnet if Opus unavailable)
- [ ] Retry logic with exponential backoff on rate limit / timeout errors
- [ ] Tool errors handled (`handle_tool_error=True`; no bare exceptions reaching the user)
- [ ] Agent max iterations enforced (LangGraph stop condition or `max_iterations` param)
- [ ] Async paths used for all server-side invocations

### Cost Controls
- [ ] Embedding cache configured (`CacheBackedEmbeddings`)
- [ ] Token-limited or summarized memory (not full history)
- [ ] Max output tokens set on LLM (prevents runaway generation)
- [ ] Semantic caching for repeated identical queries:
  ```python
  from langchain.cache import RedisSemanticCache
  from langchain.globals import set_llm_cache
  set_llm_cache(RedisSemanticCache(redis_url=REDIS_URL, embedding=embeddings))
  ```

### Security
- [ ] No shell commands, OS access, or database writes exposed to untrusted agent input
- [ ] API keys in environment variables (not hardcoded)
- [ ] Tool inputs validated with Pydantic (no raw string passthrough to external APIs)
- [ ] Sensitive tools gated with human-in-the-loop (LangGraph `interrupt_before`)
- [ ] Output scanning for PII if handling user data

### RAG-Specific
- [ ] Vector store persisted to disk or cloud (not in-memory only)
- [ ] Document metadata indexed (source, date, owner) for filtering
- [ ] Chunking strategy validated: chunk_size and overlap tested against representative queries
- [ ] Retriever `k` tuned to balance recall vs context window cost

---

## Monitoring Setup

### Token Usage Callback
```python
from langchain_core.callbacks import BaseCallbackHandler

class TokenUsageLogger(BaseCallbackHandler):
    def on_llm_end(self, response, **kwargs):
        usage = response.llm_output.get("token_usage", {})
        log.info("tokens", extra={
            "prompt": usage.get("prompt_tokens"),
            "completion": usage.get("completion_tokens"),
            "model": response.llm_output.get("model_name"),
        })

chain = prompt | llm.with_config(callbacks=[TokenUsageLogger()])
```

### Structured Logging Pattern
```python
import structlog

log = structlog.get_logger()

class RequestLogger(BaseCallbackHandler):
    def on_chain_start(self, serialized, inputs, **kwargs):
        log.info("chain_start", chain=serialized.get("name"), run_id=str(kwargs.get("run_id")))

    def on_chain_end(self, outputs, **kwargs):
        log.info("chain_end", run_id=str(kwargs.get("run_id")))

    def on_chain_error(self, error, **kwargs):
        log.error("chain_error", error=str(error), run_id=str(kwargs.get("run_id")))
```

---

## Model Fallback Pattern (Production)
```python
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

primary = ChatAnthropic(model="claude-opus-4-7", timeout=30)
fallback = ChatOpenAI(model="gpt-4o", timeout=30)

llm_with_fallback = primary.with_fallbacks(
    [fallback],
    exceptions_to_handle=(anthropic.APITimeoutError, anthropic.RateLimitError),
)
```
