from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Dict, List, Tuple

import docker
from docker.errors import ContainerError, DockerException, ImageNotFound

from models import SandboxCommandResult

SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "aetherflow-sandbox:latest")
SANDBOX_ROOT = Path(os.environ.get("SANDBOX_WORKSPACE_ROOT", "/tmp/aetherflow_workspaces"))

SENSITIVE_PATTERNS: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(r"\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*f|--recursive|--force)"), "Recursive or forced deletion"),
    (re.compile(r"\bsudo\b"), "Privilege escalation attempt"),
    (re.compile(r"\b(curl|wget)\b.*\|\s*(sh|bash|zsh)"), "Piping remote script into shell"),
    (re.compile(r"\b(chmod|chown)\b"), "Filesystem permission mutation"),
    (re.compile(r"\b(docker|systemctl|kill|pkill|shutdown|reboot)\b"), "Host/daemon control command"),
    (re.compile(r"\b(pip|pip3|npm|apt|apt-get|apk)\s+install\b"), "External package installation"),
]


def check_sensitive_command(command: str) -> Tuple[bool, str]:
    for pattern, reason in SENSITIVE_PATTERNS:
        if pattern.search(command):
            return True, reason
    return False, ""


class DockerSandbox:
    """Isolated ephemeral Linux container sandbox backed by Docker SDK for Python."""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.workspace_dir = (SANDBOX_ROOT / run_id).resolve()
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self._client = None
        try:
            self._client = docker.from_env()
        except DockerException:
            self._client = None

    def _safe_path(self, relative_path: str) -> Path:
        cleaned = relative_path.lstrip("/").replace("..", "")
        target = (self.workspace_dir / cleaned).resolve()
        if not str(target).startswith(str(self.workspace_dir)):
            raise ValueError(f"Path traversal blocked: {relative_path}")
        return target

    def write_file(self, relative_path: str, content: str) -> str:
        target = self._safe_path(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"Wrote {len(content)} bytes to {relative_path}"

    def read_file(self, relative_path: str) -> str:
        target = self._safe_path(relative_path)
        if not target.exists():
            raise FileNotFoundError(f"File not found in sandbox: {relative_path}")
        return target.read_text(encoding="utf-8")

    def list_files(self) -> List[Dict[str, object]]:
        files: List[Dict[str, object]] = []
        for path in sorted(self.workspace_dir.rglob("*")):
            if path.is_file():
                rel = str(path.relative_to(self.workspace_dir))
                files.append(
                    {
                        "path": rel,
                        "size": path.stat().st_size,
                        "content": path.read_text(encoding="utf-8", errors="replace"),
                    }
                )
        return files

    def exec_bash(self, command: str, timeout_sec: int = 20) -> SandboxCommandResult:
        if self._client is None:
            return SandboxCommandResult(
                command=command,
                exit_code=127,
                stdout="",
                stderr="Docker daemon unavailable on host socket (/var/run/docker.sock).",
            )

        container = None
        try:
            container = self._client.containers.run(
                image=SANDBOX_IMAGE,
                command=["/bin/sh", "-c", command],
                working_dir="/workspace",
                volumes={
                    str(self.workspace_dir): {"bind": "/workspace", "mode": "rw"}
                },
                network_mode="none",
                mem_limit="512m",
                nano_cpus=500_000_000,
                pids_limit=64,
                read_only=False,
                security_opt=["no-new-privileges:true"],
                user="1000:1000",
                detach=True,
            )
            exit_info = container.wait(timeout=timeout_sec)
            logs_stdout = container.logs(stdout=True, stderr=False).decode("utf-8", errors="replace")
            logs_stderr = container.logs(stdout=False, stderr=True).decode("utf-8", errors="replace")
            return SandboxCommandResult(
                command=command,
                exit_code=int(exit_info.get("StatusCode", 1)),
                stdout=logs_stdout[:8000],
                stderr=logs_stderr[:8000],
            )
        except ImageNotFound:
            return SandboxCommandResult(
                command=command,
                exit_code=125,
                stdout="",
                stderr=f"Sandbox image '{SANDBOX_IMAGE}' not built yet. Build sandbox/Dockerfile.sandbox first.",
            )
        except ContainerError as exc:
            return SandboxCommandResult(
                command=command,
                exit_code=exc.exit_status,
                stdout="",
                stderr=str(exc),
            )
        except Exception as exc:
            return SandboxCommandResult(
                command=command,
                exit_code=124,
                stdout="",
                stderr=f"Sandbox execution error: {exc}",
                timed_out="timed out" in str(exc).lower(),
            )
        finally:
            if container is not None:
                try:
                    container.remove(force=True)
                except Exception:
                    pass
