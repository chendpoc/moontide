const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

const conversation = document.getElementById("conversation");
const notices = document.getElementById("notices");
const runState = document.getElementById("run-state");
const sessionId = document.getElementById("session-id");
const prompt = document.getElementById("prompt");
const sendButton = document.getElementById("send");
const stopButton = document.getElementById("stop");

/** @type {Map<string, HTMLElement>} */
const draftNodes = new Map();

/** @type {wire.RenderState} minimal local view */
const view = {
  runLabel: "Starting",
  sessionId: "",
  messages: [],
  draftKey: null,
  draftText: "",
  approvals: [],
  notices: [],
};

function draftKey(turn, llmCallId) {
  return `${turn}:${llmCallId}`;
}

function renderRunState(state) {
  if (!state || !state.kind) {
    view.runLabel = "Unknown";
    return;
  }
  switch (state.kind) {
    case "starting":
      view.runLabel = "Starting";
      break;
    case "idle":
      view.runLabel = "Idle";
      break;
    case "thinking":
      view.runLabel = `Thinking (turn ${state.turn})`;
      break;
    case "running_tool":
      view.runLabel = `Running ${state.name}`;
      break;
    case "waiting_approval":
      view.runLabel = "Waiting approval";
      break;
    case "cancelling":
      view.runLabel = "Cancelling";
      break;
    case "failed":
      view.runLabel = "Failed";
      break;
    case "stopping":
      view.runLabel = "Stopping";
      break;
    case "stopped":
      view.runLabel = "Stopped";
      break;
    default:
      view.runLabel = state.kind;
  }
  runState.textContent = view.runLabel;
  const busy = ["thinking", "running_tool", "waiting_approval", "cancelling"].includes(state.kind);
  stopButton.disabled = !busy;
  sendButton.disabled = state.kind === "stopped" || state.kind === "stopping";
}

function blocksToText(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => {
      if (block.kind === "text") return block.text;
      if (block.kind === "thinking") return `[thinking]\n${block.thinking}`;
      if (block.kind === "tool_use") return `[tool ${block.name}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function snapshotToMessages(snapshot) {
  const items = snapshot?.session?.items ?? [];
  const nodes = [];
  for (const item of items) {
    if (item.kind === "user_message") {
      nodes.push({ role: "user", text: item.text });
    }
    if (item.kind === "assistant_message") {
      nodes.push({ role: "assistant", text: blocksToText(item.blocks) });
    }
  }
  view.messages = nodes;
  view.sessionId = snapshot?.session?.summary?.session_id ?? "";
  sessionId.textContent = view.sessionId ? `session ${view.sessionId}` : "";
  renderRunState(snapshot?.state ?? { kind: "idle" });
  renderConversation();
}

function renderConversation() {
  conversation.replaceChildren();
  for (const message of view.messages) {
    conversation.appendChild(messageElement(message.role, message.text, false));
  }
  if (view.draftText) {
    conversation.appendChild(messageElement("assistant", view.draftText, true));
  }
  for (const approval of view.approvals) {
    conversation.appendChild(renderApproval(approval));
  }
  conversation.scrollTop = conversation.scrollHeight;
}

function messageElement(role, text, draft) {
  const node = document.createElement("article");
  node.className = `message ${role}${draft ? " draft" : ""}`;
  node.textContent = text;
  return node;
}

function renderApproval(approval) {
  const card = document.createElement("div");
  card.className = "approval-card message tool";
  card.innerHTML = `<strong>Approval</strong><div>${approval.call.name}</div>`;
  const approve = document.createElement("button");
  approve.textContent = "Approve";
  approve.onclick = () =>
    request({ kind: "approve", approval_id: approval.id }).catch(showError);
  const deny = document.createElement("button");
  deny.textContent = "Deny";
  deny.onclick = () =>
    request({
      kind: "deny",
      approval_id: approval.id,
      reason: "denied from desktop ui",
    }).catch(showError);
  card.append(approve, deny);
  return card;
}

function renderNotices() {
  notices.replaceChildren();
  for (const notice of view.notices) {
    const node = document.createElement("div");
    node.className = `notice ${notice.kind ?? ""}`;
    node.textContent = notice.text;
    notices.append(node);
  }
}

function showError(error) {
  const message = typeof error === "string" ? error : error?.message ?? String(error);
  view.notices = [{ kind: "error", text: message }];
  renderNotices();
}

function applyEnvelope(envelope) {
  const payload = envelope?.payload;
  if (!payload) return;

  if (payload.kind === "event") {
    const event = payload.event;
    switch (event.kind) {
      case "state_changed":
        renderRunState(event.state);
        break;
      case "assistant_response_snapshot": {
        const key = draftKey(event.turn, event.llm_call_id);
        view.draftKey = key;
        view.draftText = blocksToText(event.snapshot.content);
        if (event.snapshot.pending?.kind === "text") {
          view.draftText += event.snapshot.pending.text;
        }
        renderConversation();
        break;
      }
      case "assistant_finalized":
        view.draftText = "";
        view.draftKey = null;
        break;
      case "approval_requested":
        view.approvals = [...view.approvals.filter((a) => a.id !== event.request.id), event.request];
        renderConversation();
        break;
      case "turn_completed":
        view.draftText = "";
        view.approvals = [];
        void refreshSnapshot();
        break;
      case "turn_failed":
        view.notices = [{ kind: "error", text: event.error.message }];
        renderNotices();
        void refreshSnapshot();
        break;
      case "resync_required":
        view.notices = [{ kind: "error", text: `Resync required (${event.reason.kind})` }];
        renderNotices();
        void refreshSnapshot();
        break;
      default:
        break;
    }
  }
}

async function request(command) {
  const envelope = await invoke("desktop_request", { command });
  const payload = envelope?.payload;
  if (payload?.kind !== "response") {
    throw new Error("MoonTide bridge returned a non-response envelope");
  }
  const response = payload.response;
  if (response?.kind === "rejected") {
    throw new Error(response.error?.message ?? "MoonTide command was rejected");
  }
  return response;
}

async function refreshSnapshot() {
  try {
    const response = await request({ kind: "snapshot" });
    snapshotToMessages(response.snapshot);
  } catch (error) {
    showError(error);
  }
}

async function submitPrompt() {
  const text = prompt.value.trim();
  if (!text) return;
  sendButton.disabled = true;
  try {
    await request({ kind: "submit_turn", text });
    prompt.value = "";
  } catch (error) {
    showError(error);
  } finally {
    sendButton.disabled = false;
  }
}

sendButton.classList.add("primary");
sendButton.addEventListener("click", () => void submitPrompt());
stopButton.addEventListener("click", () =>
  void request({ kind: "cancel_turn" }).catch(showError),
);

prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void submitPrompt();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    void request({ kind: "cancel_turn" }).catch(showError);
  }
});

async function boot() {
  await listen("desktop-envelope", (event) => {
    applyEnvelope(event.payload);
  });
  await listen("desktop-connection", (event) => {
    if (event.payload?.kind !== "degraded_shutdown") {
      showError(event.payload?.message ?? "MoonTide connection closed");
    }
  });
  await request({ kind: "handshake" });
  const response = await request({
    kind: "start_session",
    selection: { kind: "new" },
  });
  snapshotToMessages(response.snapshot);
}

void boot().catch(showError);
