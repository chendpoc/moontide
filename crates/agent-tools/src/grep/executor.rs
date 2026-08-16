use std::{
    fs::{self, File},
    future::Future,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    pin::Pin,
};

use agent_core::tools::{ToolCall, ToolContent, ToolExecutor, ToolResult};
use anyhow::{Context, Result};
use ignore::WalkBuilder;
use regex::Regex;
use serde::Deserialize;

const DEFAULT_MAX_RESULTS: usize = 100;
const MAX_OUTPUT_BYTES: usize = 32 * 1024;
const RESULT_LIMIT_MARKER: &str = "[truncated: result limit reached]";
const OUTPUT_LIMIT_MARKER: &str = "[truncated: output limit reached]";
const MAX_MARKER_BYTES: usize = if RESULT_LIMIT_MARKER.len() > OUTPUT_LIMIT_MARKER.len() {
    RESULT_LIMIT_MARKER.len()
} else {
    OUTPUT_LIMIT_MARKER.len()
};
const TRUNCATION_RESERVE_BYTES: usize = 1 + MAX_MARKER_BYTES;
const MAX_PAYLOAD_BYTES: usize = MAX_OUTPUT_BYTES - TRUNCATION_RESERVE_BYTES;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GrepInput {
    pattern: String,
    #[serde(default = "default_path")]
    path: String,
    #[serde(default = "default_max_results")]
    max_results: usize,
}

fn default_path() -> String {
    ".".to_owned()
}

const fn default_max_results() -> usize {
    DEFAULT_MAX_RESULTS
}

pub(super) struct GrepExecutor;

impl ToolExecutor for GrepExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            let input = serde_json::from_value::<GrepInput>(call.input().clone())
                .context("grep input no longer matches its schema")?;
            let call = call.clone();
            let working_dir = working_dir.to_path_buf();

            tokio::task::spawn_blocking(move || search(&call, input, working_dir))
                .await
                .context("grep blocking task failed")?
        })
    }
}

fn search(call: &ToolCall, input: GrepInput, working_dir: PathBuf) -> Result<ToolResult> {
    let working_dir = fs::canonicalize(&working_dir).with_context(|| {
        format!(
            "failed to canonicalize grep working directory {}",
            working_dir.display()
        )
    })?;

    let requested_path = Path::new(&input.path);
    let requested_path = if requested_path.is_absolute() {
        requested_path.to_path_buf()
    } else {
        working_dir.join(requested_path)
    };
    let target = match fs::canonicalize(&requested_path) {
        Ok(target) => target,
        Err(error) => {
            return Ok(expected_failure(
                call,
                format!("grep target {} is unavailable: {error}", input.path),
            ));
        }
    };

    if !target.starts_with(&working_dir) {
        return Ok(expected_failure(
            call,
            format!(
                "grep target {} is outside the working directory",
                input.path
            ),
        ));
    }

    let regex = match Regex::new(&input.pattern) {
        Ok(regex) => regex,
        Err(error) => {
            return Ok(expected_failure(
                call,
                format!("invalid grep regular expression: {error}"),
            ));
        }
    };

    let metadata = match fs::metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) => {
            return Ok(expected_failure(
                call,
                format!("failed to inspect grep target {}: {error}", input.path),
            ));
        }
    };

    let mut matches = MatchCollector::new(input.max_results);
    let search_result = if metadata.is_file() {
        search_file(&target, &working_dir, &regex, &mut matches).map(|_| ())
    } else if metadata.is_dir() {
        search_directory(&target, &working_dir, &regex, &mut matches)
    } else {
        return Ok(expected_failure(
            call,
            format!(
                "grep target {} is neither a file nor a directory",
                input.path
            ),
        ));
    };

    Ok(finish_search(call, search_result, matches))
}

fn finish_search(
    call: &ToolCall,
    search_result: Result<()>,
    matches: MatchCollector,
) -> ToolResult {
    match search_result {
        Ok(()) => matches.finish(call),
        Err(error) => expected_failure(call, format!("grep search failed: {error:#}")),
    }
}

fn search_directory(
    target: &Path,
    working_dir: &Path,
    regex: &Regex,
    matches: &mut MatchCollector,
) -> Result<()> {
    let walker = WalkBuilder::new(target)
        .standard_filters(true)
        .require_git(false)
        .follow_links(false)
        .current_dir(working_dir)
        .sort_by_file_path(|left, right| left.cmp(right))
        .build();

    for entry in walker {
        let entry = entry.with_context(|| format!("failed to walk {}", target.display()))?;
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }
        if !search_file(entry.path(), working_dir, regex, matches)? {
            break;
        }
    }

    Ok(())
}

fn search_file(
    path: &Path,
    working_dir: &Path,
    regex: &Regex,
    matches: &mut MatchCollector,
) -> Result<bool> {
    let mut file = File::open(path)
        .with_context(|| format!("failed to open grep input {}", path.display()))?;
    if contains_nul(&mut file)
        .with_context(|| format!("failed to inspect grep input {}", path.display()))?
    {
        return Ok(true);
    }
    file.seek(SeekFrom::Start(0))
        .with_context(|| format!("failed to rewind grep input {}", path.display()))?;

    let display_path = relative_display_path(path, working_dir)?;
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let mut line_number = 0usize;

    loop {
        line.clear();
        let bytes_read = reader
            .read_until(b'\n', &mut line)
            .with_context(|| format!("failed to read grep input {}", path.display()))?;
        if bytes_read == 0 {
            return Ok(true);
        }

        line_number += 1;
        trim_line_ending(&mut line);
        let text = String::from_utf8_lossy(&line);
        if regex.is_match(&text) {
            let result = format!("{display_path}:{line_number}:{text}\n");
            if !matches.push(&result) {
                return Ok(false);
            }
        }
    }
}

fn contains_nul(file: &mut File) -> std::io::Result<bool> {
    let mut buffer = [0u8; 8 * 1024];
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            return Ok(false);
        }
        if buffer[..bytes_read].contains(&0) {
            return Ok(true);
        }
    }
}

fn trim_line_ending(line: &mut Vec<u8>) {
    if line.last() == Some(&b'\n') {
        line.pop();
    }
    if line.last() == Some(&b'\r') {
        line.pop();
    }
}

fn relative_display_path(path: &Path, working_dir: &Path) -> Result<String> {
    let relative = path.strip_prefix(working_dir).with_context(|| {
        format!(
            "grep result path {} escaped working directory {}",
            path.display(),
            working_dir.display()
        )
    })?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn expected_failure(call: &ToolCall, message: String) -> ToolResult {
    ToolResult::failed(call, ToolContent::Text(message), false)
}

#[derive(Clone, Copy)]
enum Truncation {
    ResultLimit,
    OutputLimit,
}

struct MatchCollector {
    output: String,
    match_count: usize,
    max_results: usize,
    truncation: Option<Truncation>,
}

impl MatchCollector {
    fn new(max_results: usize) -> Self {
        Self {
            output: String::new(),
            match_count: 0,
            max_results,
            truncation: None,
        }
    }

    fn push(&mut self, result: &str) -> bool {
        if self.match_count >= self.max_results {
            self.truncation = Some(Truncation::ResultLimit);
            return false;
        }

        let available = MAX_PAYLOAD_BYTES.saturating_sub(self.output.len());
        if result.len() > available {
            self.output.push_str(utf8_prefix(result, available));
            self.truncation = Some(Truncation::OutputLimit);
            return false;
        }

        self.output.push_str(result);
        self.match_count += 1;
        if self.match_count >= self.max_results {
            self.truncation = Some(Truncation::ResultLimit);
            false
        } else {
            true
        }
    }

    fn finish(mut self, call: &ToolCall) -> ToolResult {
        if let Some(truncation) = self.truncation {
            if !self.output.is_empty() && !self.output.ends_with('\n') {
                self.output.push('\n');
            }
            self.output.push_str(match truncation {
                Truncation::ResultLimit => RESULT_LIMIT_MARKER,
                Truncation::OutputLimit => OUTPUT_LIMIT_MARKER,
            });
        }

        if self.output.is_empty() {
            ToolResult::succeeded(call, ToolContent::Text("No matches found.".to_owned()))
        } else {
            ToolResult::succeeded(call, ToolContent::Text(self.output))
        }
    }
}

fn utf8_prefix(value: &str, max_bytes: usize) -> &str {
    let mut end = value.len().min(max_bytes);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use agent_core::tools::{ToolCall, ToolContent, ToolExecutor, ToolResult, ToolResultStatus};
    use anyhow::{anyhow, bail, ensure, Result};
    use serde_json::{json, Value};
    use tempfile::TempDir;

    use super::{finish_search, search_file, GrepExecutor, MatchCollector, MAX_OUTPUT_BYTES};

    #[cfg(unix)]
    fn create_file_symlink(original: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(original, link)
    }

    #[cfg(windows)]
    fn create_file_symlink(original: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(original, link)
    }

    async fn execute(input: Value, working_dir: &std::path::Path) -> Result<ToolResult> {
        let call = ToolCall::new("call-1", super::super::NAME, input)?;
        GrepExecutor.execute(&call, working_dir).await
    }

    fn succeeded_text(result: ToolResult) -> Result<String> {
        match (result.status(), result.content()) {
            (ToolResultStatus::Succeeded, ToolContent::Text(text)) => Ok(text.clone()),
            other => bail!("expected successful text result, got {other:?}"),
        }
    }

    fn failed_text(result: ToolResult) -> Result<String> {
        match (result.status(), result.content()) {
            (ToolResultStatus::Failed { retryable: false }, ToolContent::Text(text)) => {
                Ok(text.clone())
            }
            other => bail!("expected non-retryable text failure, got {other:?}"),
        }
    }

    // 测试场景：默认 path 递归搜索包含 .gitignore 的工作目录；预期结果按相对路径稳定排序且忽略被排除文件；不变量/副作用：不读取临时目录外文件，也不修改进程 cwd。
    #[tokio::test]
    async fn searches_default_path_in_stable_order_and_respects_gitignore() -> Result<()> {
        let workspace = TempDir::new()?;
        fs::create_dir(workspace.path().join("nested"))?;
        fs::write(workspace.path().join(".gitignore"), "ignored.txt\n")?;
        fs::write(workspace.path().join("a.txt"), "first\nneedle alpha\n")?;
        fs::write(
            workspace.path().join("nested").join("b.txt"),
            "needle beta\n",
        )?;
        fs::write(
            workspace.path().join("nested").join("ignored.txt"),
            "needle nested ignored\n",
        )?;
        fs::write(workspace.path().join("ignored.txt"), "needle ignored\n")?;

        let output = execute(json!({ "pattern": "needle" }), workspace.path()).await?;

        ensure!(succeeded_text(output)? == "a.txt:2:needle alpha\nnested/b.txt:1:needle beta\n");

        let nested_output = execute(
            json!({ "pattern": "needle", "path": "nested" }),
            workspace.path(),
        )
        .await?;
        ensure!(succeeded_text(nested_output)? == "nested/b.txt:1:needle beta\n");
        Ok(())
    }

    // 测试场景：显式指定单文件后分别执行命中与未命中搜索；预期返回正确行号和固定的无匹配文本；不变量/副作用：只读取该文件且无匹配不被误报为失败。
    #[tokio::test]
    async fn searches_one_file_and_reports_no_matches_as_success() -> Result<()> {
        let workspace = TempDir::new()?;
        fs::write(workspace.path().join("single.txt"), "one\ntarget\n")?;

        let matched = execute(
            json!({ "pattern": "target", "path": "single.txt" }),
            workspace.path(),
        )
        .await?;
        ensure!(succeeded_text(matched)? == "single.txt:2:target\n");

        let unmatched = execute(
            json!({ "pattern": "absent", "path": "single.txt" }),
            workspace.path(),
        )
        .await?;
        ensure!(succeeded_text(unmatched)? == "No matches found.");
        Ok(())
    }

    // 测试场景：依次传入非法正则、缺失 target 和工作目录外 target；预期均为不可重试的工具失败；不变量/副作用：能力边界外文件不会被读取，预期输入错误不会升级为运行时错误。
    #[tokio::test]
    async fn maps_invalid_regex_and_paths_to_expected_failures() -> Result<()> {
        let workspace = TempDir::new()?;
        let outside = TempDir::new()?;
        let outside_file = outside.path().join("outside.txt");
        fs::write(&outside_file, "needle\n")?;

        let invalid_regex = execute(json!({ "pattern": "[" }), workspace.path()).await?;
        ensure!(failed_text(invalid_regex)?.contains("invalid grep regular expression"));

        let missing = execute(
            json!({ "pattern": "needle", "path": "missing.txt" }),
            workspace.path(),
        )
        .await?;
        ensure!(failed_text(missing)?.contains("is unavailable"));

        let outside_target = execute(
            json!({
                "pattern": "needle",
                "path": outside_file.to_string_lossy()
            }),
            workspace.path(),
        )
        .await?;
        ensure!(failed_text(outside_target)?.contains("outside the working directory"));
        Ok(())
    }

    // 测试场景：工作目录内的符号链接指向目录外文件；预期显式 target 被 canonical containment 拒绝，目录遍历也不跟随该链接；不变量/副作用：链接外文件内容不会进入结果。
    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn rejects_and_does_not_follow_symlinks_outside_the_workspace() -> Result<()> {
        let workspace = TempDir::new()?;
        let outside = TempDir::new()?;
        let outside_file = outside.path().join("outside.txt");
        let link = workspace.path().join("escape.txt");
        fs::write(&outside_file, "needle outside\n")?;
        create_file_symlink(&outside_file, &link)?;

        let explicit = execute(
            json!({ "pattern": "needle", "path": "escape.txt" }),
            workspace.path(),
        )
        .await?;
        ensure!(failed_text(explicit)?.contains("outside the working directory"));

        let walked = execute(json!({ "pattern": "needle" }), workspace.path()).await?;
        ensure!(succeeded_text(walked)? == "No matches found.");
        Ok(())
    }

    // 测试场景：schema 已通过但 executor typed input 出现未知字段或错误类型；预期反序列化返回基础设施 Err；不变量/副作用：漂移在任何文件 IO 和 spawn_blocking 之前暴露。
    #[tokio::test]
    async fn rejects_typed_input_that_drifted_from_the_schema() -> Result<()> {
        let workspace = TempDir::new()?;

        let unknown_field = execute(
            json!({ "pattern": "needle", "unexpected": true }),
            workspace.path(),
        )
        .await;
        let unknown_error = match unknown_field {
            Ok(output) => bail!("unknown field unexpectedly produced {output:?}"),
            Err(error) => error,
        };
        ensure!(unknown_error
            .to_string()
            .contains("grep input no longer matches its schema"));

        let wrong_type = execute(
            json!({ "pattern": "needle", "max_results": "100" }),
            workspace.path(),
        )
        .await;
        ensure!(wrong_type.is_err());
        Ok(())
    }

    // 测试场景：目录同时包含带 NUL 的二进制文件和非法 UTF-8 文本；预期完整跳过二进制文件并对文本做有损展示；不变量/副作用：任一字节序列都不 panic，也不输出二进制文件的前半段匹配。
    #[tokio::test]
    async fn skips_binary_files_and_displays_non_utf8_lossily() -> Result<()> {
        let workspace = TempDir::new()?;
        fs::write(
            workspace.path().join("binary.dat"),
            b"needle before nul\n\0needle after nul\n",
        )?;
        fs::write(workspace.path().join("lossy.txt"), b"\xff needle visible\n")?;

        let output = execute(json!({ "pattern": "needle" }), workspace.path()).await?;
        let text = succeeded_text(output)?;

        ensure!(!text.contains("binary.dat"));
        ensure!(text == "lossy.txt:1:\u{fffd} needle visible\n");
        Ok(())
    }

    // 测试场景：匹配数超过调用方声明的 max_results；预期只返回上限内记录并附 result-limit 标记；不变量/副作用：不会继续把其余匹配注入 tool result。
    #[tokio::test]
    async fn truncates_after_the_result_limit() -> Result<()> {
        let workspace = TempDir::new()?;
        fs::write(
            workspace.path().join("many.txt"),
            "needle one\nneedle two\n",
        )?;

        let output = execute(
            json!({ "pattern": "needle", "max_results": 1 }),
            workspace.path(),
        )
        .await?;
        let text = succeeded_text(output)?;

        ensure!(text == "many.txt:1:needle one\n[truncated: result limit reached]");
        Ok(())
    }

    // 测试场景：collector 接收的当前记录恰好达到 max_results；预期该次 push 立即要求调用方停止并生成标记；不变量/副作用：不依赖第 N+1 条匹配才终止扫描。
    #[test]
    fn reaching_the_result_limit_stops_immediately() -> Result<()> {
        let mut matches = MatchCollector::new(1);

        ensure!(!matches.push("file.txt:1:needle\n"));
        let call = ToolCall::new("call-limit", super::super::NAME, json!({}))?;
        ensure!(
            succeeded_text(matches.finish(&call))?
                == "file.txt:1:needle\n[truncated: result limit reached]"
        );
        Ok(())
    }

    // 测试场景：底层文件读取失败并被搜索收口层接收；预期真实 IO error 向上传播后规范化为不可重试工具失败；不变量/副作用：不得吞错、panic 或返回部分成功结果。
    #[test]
    fn maps_file_read_errors_to_nonretryable_tool_failures() -> Result<()> {
        let workspace = TempDir::new()?;
        let mut matches = MatchCollector::new(10);
        let regex = regex::Regex::new("needle")?;

        let read_error = search_file(workspace.path(), workspace.path(), &regex, &mut matches);
        ensure!(read_error.is_err());

        let call = ToolCall::new("call-read-error", super::super::NAME, json!({}))?;
        let output = finish_search(&call, Err(anyhow!("simulated read failure")), matches);
        ensure!(failed_text(output)?.contains("grep search failed: simulated read failure"));
        Ok(())
    }

    // 测试场景：单条匹配行本身超过 32 KiB 输出预算；预期在 UTF-8 边界截断并附 output-limit 标记；不变量/副作用：最终 ToolContent 连同标记始终不超过硬上限。
    #[tokio::test]
    async fn truncates_long_output_within_the_byte_budget() -> Result<()> {
        let workspace = TempDir::new()?;
        let long_line = format!("needle {}界\n", "a".repeat(MAX_OUTPUT_BYTES + 128));
        fs::write(workspace.path().join("large.txt"), long_line)?;

        let output = execute(json!({ "pattern": "needle" }), workspace.path()).await?;
        let text = succeeded_text(output)?;

        ensure!(text.ends_with("[truncated: output limit reached]"));
        ensure!(text.len() <= MAX_OUTPUT_BYTES);
        ensure!(std::str::from_utf8(text.as_bytes()).is_ok());
        Ok(())
    }
}
