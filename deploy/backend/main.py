from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from agent_engine import AutoGenGroupChatOrchestrator
from database import (
    create_run_record,
    get_workflow,
    init_db,
    list_runs,
    list_workflows,
    update_run_record,
    upsert_workflow,
)
from models import (
    ApprovalDecisionRequest,
    ExecutionEventPayload,
    RunWorkflowRequest,
    WorkflowConfig,
)
from sandbox import DockerSandbox


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="AetherFlow Multi-Agent Engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket subscribers per run_id
run_subscribers: Dict[str, Set[WebSocket]] = {}
# Pending Human-in-the-Loop futures keyed by approval_id
pending_approvals: Dict[str, asyncio.Future[bool]] = {}
# In-memory event buffer so late WebSocket joins receive replay
run_event_buffers: Dict[str, List[Dict[str, Any]]] = {}


async def broadcast_event(run_id: str, event: ExecutionEventPayload) -> None:
    payload = event.model_dump()
    run_event_buffers.setdefault(run_id, []).append(payload)

    subscribers = list(run_subscribers.get(run_id, set()))
    for ws in subscribers:
        try:
            await ws.send_json(payload)
        except Exception:
            run_subscribers.get(run_id, set()).discard(ws)


@app.get("/api/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/workflows", response_model=List[WorkflowConfig])
async def api_list_workflows() -> List[WorkflowConfig]:
    return list_workflows()


@app.post("/api/workflows", response_model=WorkflowConfig)
async def api_save_workflow(workflow: WorkflowConfig) -> WorkflowConfig:
    return upsert_workflow(workflow)


@app.get("/api/runs")
async def api_list_runs() -> List[Dict[str, Any]]:
    return list_runs()


@app.get("/api/runs/{run_id}/files")
async def api_list_sandbox_files(run_id: str) -> List[Dict[str, Any]]:
    sandbox = DockerSandbox(run_id)
    return sandbox.list_files()


@app.post("/api/runs")
async def api_start_run(req: RunWorkflowRequest) -> Dict[str, str]:
    workflow = req.workflow or get_workflow(req.workflowId)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    run_id = str(uuid.uuid4())
    create_run_record(run_id, workflow, req.taskPrompt)
    run_event_buffers[run_id] = []

    async def emit(event: ExecutionEventPayload) -> None:
        await broadcast_event(run_id, event)
        status = "running"
        completed = False
        if event.type == "approval_required":
            status = "awaiting_approval"
        elif event.type == "run_completed":
            status = "completed"
            completed = True
        elif event.type == "run_error":
            status = "failed"
            completed = True
        update_run_record(
            run_id=run_id,
            status=status,
            rounds_executed=event.round,
            events=run_event_buffers.get(run_id, []),
            completed=completed,
        )

    async def wait_for_approval(
        approval_id: str, agent_name: str, command: str, reason: str
    ) -> bool:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[bool] = loop.create_future()
        pending_approvals[approval_id] = future
        try:
            return await asyncio.wait_for(future, timeout=600.0)
        except asyncio.TimeoutError:
            return False
        finally:
            pending_approvals.pop(approval_id, None)

    async def runner() -> None:
        orchestrator = AutoGenGroupChatOrchestrator(
            run_id=run_id,
            workflow=workflow,
            emit_event=emit,
            wait_for_approval=wait_for_approval,
        )
        try:
            await orchestrator.execute(req.taskPrompt)
        except Exception as exc:
            await emit(
                ExecutionEventPayload(
                    id=str(uuid.uuid4()),
                    runId=run_id,
                    type="run_error",
                    round=0,
                    content=f"Execution failed: {exc}",
                )
            )

    asyncio.create_task(runner())
    return {"runId": run_id}


@app.post("/api/runs/{run_id}/approve")
async def api_resolve_approval(
    run_id: str, decision: ApprovalDecisionRequest
) -> Dict[str, Any]:
    future = pending_approvals.get(decision.approvalId)
    if future is None or future.done():
        raise HTTPException(
            status_code=404, detail="No pending approval request for this ID"
        )
    future.set_result(decision.approved)
    return {"runId": run_id, "approvalId": decision.approvalId, "approved": decision.approved}


@app.websocket("/ws/run/{run_id}")
async def ws_run_stream(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    run_subscribers.setdefault(run_id, set()).add(websocket)
    try:
        # Replay buffered events immediately on connection
        for event in run_event_buffers.get(run_id, []):
            await websocket.send_json(event)

        while True:
            # Listen for client approval responses or keepalive pings
            msg = await websocket.receive_json()
            if msg.get("type") == "approval_decision":
                approval_id = msg.get("approvalId")
                approved = bool(msg.get("approved", False))
                future = pending_approvals.get(approval_id)
                if future and not future.done():
                    future.set_result(approved)
    except WebSocketDisconnect:
        run_subscribers.get(run_id, set()).discard(websocket)
