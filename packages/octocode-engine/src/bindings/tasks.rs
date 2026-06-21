use crate::ripgrep_search;
use crate::types::{MinifyResult, RipgrepParseResult, RipgrepSearchOptions};
use napi::{Env, Error, Result, Status, Task};

pub struct MinifyContentTask {
    pub content: String,
    pub file_path: String,
}

impl Task for MinifyContentTask {
    type Output = MinifyResult;
    type JsValue = MinifyResult;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(crate::minifier::minify_content_result_inner(
            &self.content,
            &self.file_path,
        ))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct SearchRipgrepTask {
    pub options: Option<RipgrepSearchOptions>,
}

impl Task for SearchRipgrepTask {
    type Output = RipgrepParseResult;
    type JsValue = RipgrepParseResult;

    fn compute(&mut self) -> Result<Self::Output> {
        // `compute` runs on the libuv thread pool, so the filesystem walk never
        // blocks the Node event loop. `options` is moved out on first call.
        let options = self
            .options
            .take()
            .ok_or_else(|| Error::new(Status::GenericFailure, "search options already consumed"))?;
        ripgrep_search::search(options)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}
