use std::path::Path;

use ocula_tools::dev_tool_learning_enabled;

pub fn build_system_prompt(workdir: &Path) -> String {
    let mut prompt = format!(
        "You are Ocula, a focused coding agent.\n\n\
         Workspace: {}\n\n\
         Use tools to inspect and modify files. Prefer read_file/edit_file over bash when possible.\n\
         Prefer grep over bash for code search.\n\
         Prefer git_status/git_diff/git_log for atomic read-only git operations.\n\
         For large tool outputs, use read_artifact with the artifact id from truncated results.\n\
         Use git_diff with stat=true or path=... instead of bash git diff.\n\
         Plan before acting on multi-step tasks. Be concise in final replies.",
        workdir.display()
    );

    if dev_tool_learning_enabled() {
        prompt.push_str(
            "\n\nDev mode: when tool output is truncated or a tool was used suboptimally, \
             evaluate a better tool/args and call record_tool_hint with your suggestion.",
        );
    }

    prompt
}
