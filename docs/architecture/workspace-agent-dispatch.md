# Workspace agent dispatch

Status: requested; architecture findings only. No workspace-wide agent executor or member binding has been implemented.

## Owner request

Source: Chief continuation chat, October 7, 2026 (America/Los_Angeles):

> My next feature I want my agents to be able to perform tasks through the entire workspace. I want to be able to dispatch them to do the work for my workspace. Other users should be able to do the same. When having video conferences, we should be able to dispatch agents to take meeting notes and have follow-up conversations with us about the topics.

## Existing implementation

- The personal Chief service runs agent tasks and conversations. Its existing request authentication and bot visibility determine which agents a caller can access. Task creation and message execution already exist in `server/index.ts`.
- The retained shared workspace has its own account and workspace membership. The host frame in `src/components/SharedWorkspacePage.tsx` deliberately transfers no credentials. `server/routes/shared-workspace.ts` currently serves only the local owner integration.
- The retained Love service validates current workspace membership and caller-scoped meeting access in `services/love/src/captureRoutes.ts`. Meeting capture already requires participant consent and returns a transcript/review bundle.
- `src/components/MeetingReviewImport.tsx` imports selected, reviewed meeting material into a private conversation draft. It does not dispatch an agent or establish a member-to-agent connection.

## Proposed implementation sequence

1. **Member connection:** explicitly pair a shared member's account and workspace with that member's personal Chief service. Store server-verified identities and revocable, narrowly scoped capabilities; never pair the owner's agents to another member implicitly. Account switching, logout, membership removal and revocation must invalidate access.
2. **Workspace task dispatch:** a consistent Dispatch action across the workbench opens the member's available agents, task instructions and selected workspace context. Resolve record permissions as the initiating member at execution time. Existing agent tools need an authenticated workspace adapter for discovery, reading, creating and editing the retained modules, plus files and rich text. Do not use an administrator token as a substitute for member permissions.
3. **Execution and conversation:** create a distinct durable task with an idempotent dispatch identifier, initiating member, workspace, selected agent, allowed scope and record references. Show queued/running/waiting/completed/failed/cancelled status with an Open conversation action. Restart recovery must not duplicate writes or interpret unfinished work as completed. Continue through the existing task conversation and approval behavior.
4. **Meeting assignment:** participants can explicitly assign one of their agents to a meeting. Reuse the consented capture service and its attendance checks. Record assignment separately from media capture; selecting an agent must not bypass participant consent or start a device. Feed authorized transcript segments or completed transcripts to the assigned task, and retain a meeting-linked conversation for summaries, questions and requested follow-up work.
5. **Access lifecycle:** recheck both workspace membership and agent access on reads, writes, transcript delivery and follow-up. Retain source references in outputs. Distinguish shared meeting notes from the member's private conversation. Execution must stop on revoked access and report the reason.

## Required acceptance

- Two synthetic members with distinct personal agents dispatch real work across Contacts, Cards/Documents, Tracker, Chat, Calendar/Planner and files.
- Neither member can select the other's private agents, read their tasks, reuse their connection, or access restricted workspace records.
- A real synthetic meeting exercises consent, assignment, transcript arrival, agent notes and an actual follow-up conversation; late joining, leaving, cancellation and revocation are checked.
- Duplicate submissions and server restarts produce one task/action, with visible recovery or failure rather than a fabricated completion.
- Browser tests use isolated accounts and fake media. Owner records, chats and devices are excluded from mutation tests.

This remains implementation work. The existing media-label repair is independent and does not enable any of these capabilities.
