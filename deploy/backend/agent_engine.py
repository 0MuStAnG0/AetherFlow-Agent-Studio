from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional

import litellm

from models import (
    ExecutionEventPayload,
    LLMProvider,
    WorkflowConfig,
    WorkflowNode,
)
from sandbox import DockerSandbox, check_sensitive_command

# Disable verbose LiteLLM telemetry
litellm.telemetry = False


class MultiProviderLLMClient:
    """Unified async LLM adapter supporting Google Gemini, OpenAI, Anthropic, and Ollama via LiteLLM."""

    async def complete(
        self,
        node: WorkflowNode,
        conversation_history: List[Dict[str, str]],
    ) -> str:
        provider = node.data.provider
        model_id = node.data.model

        if provider == LLMProvider.GEMINI:
            litellm_model = model_id if model_id.startswith("gemini/") else f"gemini/{model_id}"
            api_key = os.environ.get(node.data.envSecretRef or "GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
            api_base = None
        elif provider == LLMProvider.OPENAI:
            litellm_model = model_id
            api_key = os.environ.get(node.data.envSecretRef or "OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
            api_base = None
        elif provider == LLMProvider.ANTHROPIC:
            litellm_model = model_id if model_id.startswith("anthropic/") else f"anthropic/{model_id}"
            api_key = os.environ.get(node.data.envSecretRef or "ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
            api_base = None
        elif provider == LLMProvider.OPENCODE:
            clean_id = model_id.removeprefix("opencode/")
            litellm_model = f"openai/{clean_id}"
            api_key = os.environ.get(node.data.envSecretRef or "OPENCODE_API_KEY") or os.environ.get("OPENCODE_API_KEY") or "free-tier"
            api_base = os.environ.get("OPENCODE_BASE_URL", "https://opencode.ai/zen/v1")
        else:
            litellm_model = model_id if model_id.startswith("ollama/") else f"ollama/{model_id}"
            api_key = None
            api_base = os.environ.get(node.data.envSecretRef or "OLLAMA_BASE_URL", "http://host.docker.internal:11434")

        tool_directives = []
        if node.data.tools.readFile:
            tool_directives.append("READ_FILE:<relative_path>")
        if node.data.tools.writeFile:
            tool_directives.append("WRITE_FILE:<relative_path>\n```code\n<content>\n```")
        if node.data.tools.execBash:
            tool_directives.append("EXEC_BASH:<command>")

        is_manager = node.data.role.value == "manager" or "manager" in node.data.label.lower() or "مدیر" in node.data.label
        manager_guidance = (
            "\nManager Inspection & Domain Delegation Protocol:\n"
            "- Carefully analyze all sandbox files, test/deploy logs, and reported errors.\n"
            '- If any issue exists, assign it to the responsible agent using: DELEGATE: {"targetRole":"backend"|"frontend"|"security_qa"|"executor","issue":"...","reason":"..."}\n'
            "- Emit TERMINATE only after all tests pass and no blocking issues remain.\n"
            if is_manager
            else ""
        )

        system_content = (
            f"{node.data.systemPrompt}\n\n"
            f"Agent Name: {node.data.label} (Role: {node.data.role.value})\n"
            f"Authorized Tools: {', '.join(tool_directives) if tool_directives else 'None'}\n"
            "To invoke a tool, emit an explicit line starting with READ_FILE:, WRITE_FILE:, or EXEC_BASH:. "
            f"{manager_guidance}"
            "If all objectives and verification checks pass, include TERMINATE in your response."
        )

        messages = [{"role": "system", "content": system_content}, *conversation_history]

        response = await litellm.acompletion(
            model=litellm_model,
            messages=messages,
            temperature=node.data.temperature,
            api_key=api_key,
            api_base=api_base,
        )
        return response.choices[0].message.content or ""


class AutoGenGroupChatOrchestrator:
    """
    Executes a node-directed Multi-Agent GroupChat loop with:
    - Topological + edge-driven speaker selection
    - max_rounds loop prevention
    - Human-in-the-Loop approval gate for sensitive bash commands
    - Isolated Docker Sandbox file & bash execution
    """

    def __init__(
        self,
        run_id: str,
        workflow: WorkflowConfig,
        emit_event: Callable[[ExecutionEventPayload], Awaitable[None]],
        wait_for_approval: Callable[[str, str, str, str], Awaitable[bool]],
    ) -> None:
        self.run_id = run_id
        self.workflow = workflow
        self.emit_event = emit_event
        self.wait_for_approval = wait_for_approval
        self.llm = MultiProviderLLMClient()
        self.sandbox = DockerSandbox(run_id)
        self.history: List[Dict[str, str]] = []

    @staticmethod
    def _is_manager(node: WorkflowNode) -> bool:
        return (
            node.data.role.value == "manager"
            or "manager" in node.data.label.lower()
            or "مدیر" in node.data.label
        )

    def _find_manager(self, nodes: List[WorkflowNode]) -> Optional[WorkflowNode]:
        for n in nodes:
            if n.data.role.value == "manager":
                return n
        for n in nodes:
            if self._is_manager(n):
                return n
        return None

    @staticmethod
    def _extract_delegated_role(reply: str) -> Optional[str]:
        match = re.search(r"DELEGATE:\s*(\{[\s\S]*?\})", reply)
        if not match:
            return None
        try:
            payload = json.loads(match.group(1))
            target = str(payload.get("targetRole") or payload.get("targetAgent") or "").strip().lower()
            return target or None
        except Exception:
            return None

    def _ordered_nodes(self) -> List[WorkflowNode]:
        nodes = list(self.workflow.nodes)
        node_map = {n.id: n for n in nodes}
        in_degree = {n.id: 0 for n in nodes}
        adj: Dict[str, List[str]] = {n.id: [] for n in nodes}

        for edge in self.workflow.edges:
            if edge.source in node_map and edge.target in node_map and edge.source != edge.target:
                adj[edge.source].append(edge.target)
                in_degree[edge.target] += 1

        queue = sorted(
            [n for n in nodes if in_degree[n.id] == 0],
            key=lambda n: (0 if self._is_manager(n) else 1, n.position.x),
        )
        visited = set()
        ordered: List[WorkflowNode] = []

        while queue:
            curr = queue.pop(0)
            if curr.id in visited:
                continue
            visited.add(curr.id)
            ordered.append(curr)
            for nxt_id in adj[curr.id]:
                in_degree[nxt_id] -= 1
                if in_degree[nxt_id] <= 0 and nxt_id not in visited:
                    queue.append(node_map[nxt_id])

        for n in nodes:
            if n.id not in visited:
                ordered.append(n)
        return ordered

    def _next_speaker(
        self,
        ordered: List[WorkflowNode],
        current_id: Optional[str],
        round_idx: int,
        requested_role: Optional[str] = None,
    ) -> Optional[WorkflowNode]:
        if not ordered or round_idx >= self.workflow.maxRounds:
            return None
        if current_id is None:
            return ordered[0]
        if requested_role:
            for n in ordered:
                if n.id != current_id and (
                    n.data.role.value == requested_role
                    or requested_role in n.data.label.lower()
                ):
                    return n
        outgoing = [e.target for e in self.workflow.edges if e.source == current_id]
        if outgoing:
            target_id = outgoing[round_idx % len(outgoing)]
            for n in ordered:
                if n.id == target_id:
                    return n
        idx = next((i for i, n in enumerate(ordered) if n.id == current_id), 0)
        return ordered[(idx + 1) % len(ordered)]

    async def _run_agent_tools(
        self, node: WorkflowNode, text: str, round_num: int
    ) -> List[Dict[str, Any]]:
        tool_logs: List[Dict[str, Any]] = []

        # Parse WRITE_FILE:<path> followed by fenced code block
        if node.data.tools.writeFile:
            write_pattern = re.compile(
                r"WRITE_FILE:([^\n]+)\n```[^\n]*\n([\s\S]*?)```", re.MULTILINE
            )
            for match in write_pattern.finditer(text):
                rel_path = match.group(1).strip()
                content = match.group(2)
                result = self.sandbox.write_file(rel_path, content)
                tool_logs.append(
                    {
                        "id": str(uuid.uuid4()),
                        "tool": "write_file",
                        "target": rel_path,
                        "result": result,
                        "exitCode": 0,
                    }
                )

        # Parse READ_FILE:<path>
        if node.data.tools.readFile:
            for match in re.finditer(r"^READ_FILE:([^\n]+)$", text, re.MULTILINE):
                rel_path = match.group(1).strip()
                try:
                    content = self.sandbox.read_file(rel_path)
                    result = content[:2000]
                    exit_code = 0
                except Exception as exc:
                    result = str(exc)
                    exit_code = 1
                tool_logs.append(
                    {
                        "id": str(uuid.uuid4()),
                        "tool": "read_file",
                        "target": rel_path,
                        "result": result,
                        "exitCode": exit_code,
                    }
                )

        # Parse EXEC_BASH:<command>
        if node.data.tools.execBash:
            for match in re.finditer(r"^EXEC_BASH:([^\n]+)$", text, re.MULTILINE):
                command = match.group(1).strip()
                sensitive, reason = check_sensitive_command(command)
                approved = True

                if self.workflow.humanInTheLoop and sensitive:
                    approval_id = str(uuid.uuid4())
                    await self.emit_event(
                        ExecutionEventPayload(
                            id=str(uuid.uuid4()),
                            runId=self.run_id,
                            type="approval_required",
                            round=round_num,
                            agentId=node.id,
                            agentName=node.data.label,
                            role=node.data.role,
                            content=f"Human approval required before running: {command}",
                            pendingCommand={
                                "approvalId": approval_id,
                                "command": command,
                                "reason": reason,
                            },
                        )
                    )
                    approved = await self.wait_for_approval(
                        approval_id, node.data.label, command, reason
                    )
                    await self.emit_event(
                        ExecutionEventPayload(
                            id=str(uuid.uuid4()),
                            runId=self.run_id,
                            type="approval_resolved",
                            round=round_num,
                            agentId=node.id,
                            agentName=node.data.label,
                            content=(
                                f"Approved command execution: {command}"
                                if approved
                                else f"Rejected command execution: {command}"
                            ),
                        )
                    )

                if not approved:
                    tool_logs.append(
                        {
                            "id": str(uuid.uuid4()),
                            "tool": "exec_bash",
                            "target": command,
                            "result": "Execution aborted by Human-in-the-Loop operator.",
                            "exitCode": 130,
                            "requiresApproval": sensitive,
                            "approved": False,
                        }
                    )
                else:
                    res = await asyncio.to_thread(self.sandbox.exec_bash, command)
                    combined = (res.stdout + ("\n" + res.stderr if res.stderr else "")).strip()
                    tool_logs.append(
                        {
                            "id": str(uuid.uuid4()),
                            "tool": "exec_bash",
                            "target": command,
                            "result": combined or "(no output)",
                            "exitCode": res.exit_code,
                            "requiresApproval": sensitive,
                            "approved": True,
                        }
                    )

        return tool_logs

    async def execute(self, task_prompt: str) -> None:
        ordered = self._ordered_nodes()
        if not ordered:
            await self.emit_event(
                ExecutionEventPayload(
                    id=str(uuid.uuid4()),
                    runId=self.run_id,
                    type="run_error",
                    round=0,
                    content="Workflow has no agent nodes configured.",
                )
            )
            return

        self.history.append({"role": "user", "content": f"Project Task:\n{task_prompt}"})

        await self.emit_event(
            ExecutionEventPayload(
                id=str(uuid.uuid4()),
                runId=self.run_id,
                type="run_started",
                round=0,
                content=f"GroupChat started with {len(ordered)} agents (max_rounds={self.workflow.maxRounds}).",
            )
        )

        current_id: Optional[str] = None
        manager_node = self._find_manager(ordered)
        force_manager_review = False
        pending_delegated_role: Optional[str] = None

        for round_idx in range(self.workflow.maxRounds):
            if force_manager_review and manager_node and manager_node.id != current_id:
                speaker = manager_node
                force_manager_review = False
            else:
                speaker = self._next_speaker(
                    ordered, current_id, round_idx, pending_delegated_role
                )
                pending_delegated_role = None

            if speaker is None:
                break
            current_id = speaker.id
            round_num = round_idx + 1

            reply = await self.llm.complete(speaker, self.history)
            tool_logs = await self._run_agent_tools(speaker, reply, round_num)

            delegated = (
                self._extract_delegated_role(reply) if self._is_manager(speaker) else None
            )
            if delegated:
                pending_delegated_role = delegated

            if (
                manager_node
                and not self._is_manager(speaker)
                and (
                    any(log.get("exitCode", 0) != 0 for log in tool_logs)
                    or speaker.data.role.value in ("executor", "security_qa")
                )
            ):
                force_manager_review = True

            self.history.append(
                {"role": "assistant", "content": f"[{speaker.data.label}]:\n{reply}"}
            )
            if tool_logs:
                summary_lines = [
                    f"- {log['tool']}({log['target']}) -> exit={log['exitCode']}\n{log['result']}"
                    for log in tool_logs
                ]
                self.history.append(
                    {
                        "role": "user",
                        "content": "Sandbox Tool Results:\n" + "\n".join(summary_lines),
                    }
                )

            await self.emit_event(
                ExecutionEventPayload(
                    id=str(uuid.uuid4()),
                    runId=self.run_id,
                    type="agent_message",
                    round=round_num,
                    agentId=speaker.id,
                    agentName=speaker.data.label,
                    role=speaker.data.role,
                    provider=speaker.data.provider,
                    model=speaker.data.model,
                    content=reply,
                    toolCalls=tool_logs,
                )
            )

            if "TERMINATE" in reply and self._is_manager(speaker) and not delegated:
                break

        await self.emit_event(
            ExecutionEventPayload(
                id=str(uuid.uuid4()),
                runId=self.run_id,
                type="run_completed",
                round=len([h for h in self.history if h["role"] == "assistant"]),
                content="Multi-Agent GroupChat run completed.",
            )
        )
