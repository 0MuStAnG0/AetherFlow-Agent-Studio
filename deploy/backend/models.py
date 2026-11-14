from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class LLMProvider(str, Enum):
    GEMINI = "gemini"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"
    OPENCODE = "opencode"


class AgentRole(str, Enum):
    MANAGER = "manager"
    BACKEND = "backend"
    FRONTEND = "frontend"
    SECURITY_QA = "security_qa"
    EXECUTOR = "executor"
    CUSTOM = "custom"


class AgentToolsConfig(BaseModel):
    readFile: bool = True
    writeFile: bool = False
    execBash: bool = False


class AgentNodeData(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    role: AgentRole = AgentRole.CUSTOM
    provider: LLMProvider = LLMProvider.GEMINI
    model: str = Field(default="gemini-2.5-flash")
    envSecretRef: str = Field(default="GEMINI_API_KEY")
    temperature: float = Field(default=0.2, ge=0.0, le=1.0)
    systemPrompt: str = Field(..., min_length=1)
    tools: AgentToolsConfig = Field(default_factory=AgentToolsConfig)


class Position(BaseModel):
    x: float
    y: float


class WorkflowNode(BaseModel):
    id: str
    type: str = "agentNode"
    position: Position
    data: AgentNodeData


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None
    animated: Optional[bool] = False


class WorkflowConfig(BaseModel):
    id: str
    name: str = Field(..., min_length=1, max_length=140)
    description: str = ""
    maxRounds: int = Field(default=6, ge=1, le=25)
    humanInTheLoop: bool = True
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]
    updatedAt: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class RunWorkflowRequest(BaseModel):
    workflowId: str
    taskPrompt: str = Field(..., min_length=1)
    workflow: Optional[WorkflowConfig] = None


class ApprovalDecisionRequest(BaseModel):
    approvalId: str
    approved: bool
    note: Optional[str] = None


class SandboxCommandResult(BaseModel):
    command: str
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False


class ExecutionEventPayload(BaseModel):
    id: str
    runId: str
    type: str
    round: int
    agentId: Optional[str] = None
    agentName: Optional[str] = None
    role: Optional[AgentRole] = None
    provider: Optional[LLMProvider] = None
    model: Optional[str] = None
    content: str
    toolCalls: List[Dict[str, object]] = Field(default_factory=list)
    pendingCommand: Optional[Dict[str, str]] = None
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
