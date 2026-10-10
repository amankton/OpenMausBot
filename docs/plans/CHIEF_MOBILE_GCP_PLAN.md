# Chief mobile and Google Cloud plan

October 10, 2026. Status: researched proposal and recorded owner requirements.
No cloud resources, charges, DNS changes, mobile builds or account migrations were
created. M1 remains in progress. This plan does not claim deployment readiness.

## Owner requirements and proposed product shape

The owner requested (1) our own branded version of the MausBot companion app,
(2) a mobile connector for the shared workspace, and (3) working through Google
Cloud hosting alongside the planned Crewframe deployment.

**MOB-01 — Chief-branded companion.** Adapt the existing iOS and Android clients.
The repository already contains native clients for desktop pairing, conversations
and approvals (`ios/README.md`, `android/README.md`). Their documented prior tests
are upstream evidence; Chief-branded builds have not been tested here. Work includes
Chief name/icon, bundle/application IDs, deep links, share extensions, signing,
push identity and release destinations. Preserve notices and protocol compatibility.
Install beside the upstream app during verification; do not replace it or migrate
its device credentials implicitly. Audit managed pairing/relay dependencies: a
new icon does not create Chief-owned relay, push, account or distribution services.
iOS signing and native validation need a macOS/Xcode build environment; Android
needs its SDK/JDK and Chief release signing. Store publication is a later action.

**MOB-02 — Mobile workspace access.** Proposed UX: one Chief-branded app with
Personal Chief and Workspace destinations, plus an explicit workspace switcher.
This is a recommendation, not an owner decision requiring two separate app listings.
Reuse the workspace's member identity and M1 pairing; personal device pairing alone
must never grant workspace membership. Initial mobile scope: sign-in, workspace
selection, tasks/planner, notifications and authorized approvals. Start with a
responsive workspace route, then add native navigation, deep links and carefully
scoped device integrations where useful. A generic WebView alone is not acceptance.
Test browser/native OAuth handoff, secure credential storage, reload/background/
resume, cellular-to-Wi-Fi changes, revoked devices and account switching. Shared
workspace views must not reveal personal conversations or connectors. Offline
approval sends must not execute silently later against changed scope or versions.
The INT-01 service-surface checkboxes remain per-member/per-account access controls.

## What the current implementation requires

Inspected `integrations/platform/compose.json`, `meetings.compose.json`, the native
storage adapter registration, the mobile READMEs and current Docker process stats.
There are 17 running Chief Platform containers. They include CockroachDB,
Redpanda, S3-compatible storage (the minio service uses the pinned silo image),
Elasticsearch, Accounts, transactor, collaborator, frontend/proxy, background
workspace/search/document services, and LiveKit/Love meetings.

A read-only light-load sample used about **5.96 GiB** across these containers.
It excludes the desktop agent process, frontend build jobs and OS overhead; it is
not peak usage or evidence of supported concurrent users. Current CPU readings
likewise do not establish capacity. Load-test meetings, file indexing, recording,
large workspaces and simultaneous agent jobs before setting production limits.

The lifecycle service is new, un-deployed CON-01 code with isolated tests. It needs
production configuration, durable key management, deployment wiring, browser/runtime
integration and later durable workers. The cloud plan must not present it as an
already-operational shared dispatch service.

Crewframe's complete architecture, Google project, region, budget and migration plan
have not been verified. Some Crewframe containers are present locally; this is not
a complete inventory or a basis for promising combined sizing. The owner's stated
intention to host Crewframe on Google Cloud is the planning input.

## ADR: initial Google Cloud deployment

**Status: proposed. Recommendation: a dedicated Compute Engine pilot for Chief.**

| Option | Benefit | Cost/trade-off | Decision |
| --- | --- | --- | --- |
| Compute Engine + Docker Compose | Closest to the working multi-service stack; explicit disks, processes and networking | We operate updates, backups and recovery; a single VM is a failure point | Initial private pilot |
| GKE | More structured scheduling and multi-node growth | Kubernetes operations and stateful-service migration add work before M1 is proven | Revisit after measured scaling/availability requirements |
| Cloud Run services for selected APIs | Managed HTTP deployment and scaling | Requires separating stateful dependencies and testing streaming reconnection/state coordination | Possible later for suitable services, not a direct migration of the whole Compose stack |

Cloud Run supports WebSockets but connections remain subject to request timeouts
(currently up to 60 minutes), and clients must reconnect. This is a design
consideration, not a claim that Cloud Run cannot run streaming applications.
[Google Cloud WebSocket guidance](https://docs.cloud.google.com/run/docs/triggering/websockets)

Use a maintained Linux VM with Docker Compose managed by systemd and bootstrapped
with a startup script or cloud-init. Do not build new deployment automation around
`gce-container-declaration`: Google documents its container-startup-agent workflow
retirement and replacement paths.
[Compute Engine migration guidance](https://docs.cloud.google.com/compute/docs/containers/prepare-for-container-agent-shutdown)

Trade-off accepted for a private pilot: a single-host outage stops the workspace.
Backups enable recovery but do not make it highly available. Before commercial
availability promises, choose and test a multi-zone stateful architecture or
compatible managed services. Revisit when measured resource headroom, meeting
concurrency, recovery objectives or operational burden exceed the pilot envelope.

## Chief and Crewframe together

Use the same Google Cloud organization/billing account where available, with
separate Chief and Crewframe production projects and separate staging environments.
Share reusable infrastructure code, operational dashboards, build conventions and
billing visibility. Keep service accounts, secrets, databases, storage and backups
scoped to their own product/environment. Initially use separate VMs and private
networks. Cross-product APIs can be explicitly authorized later; sharing a provider
does not imply a shared user session, database or connector credential.

This provides operational consistency without a Crewframe deployment or memory
spike taking Chief down. Co-locating both on one VM is a cheaper development option,
but is not the recommended production boundary.

## Pilot service placement

| Layer | Proposed placement | Migration requirement |
| --- | --- | --- |
| Public workspace and APIs | HTTPS proxy on Chief VM initially; managed HTTPS load balancer when justified | Stable chosen domain, certificates, host/origin allowlists, WebSocket forwarding and secure cookies |
| Existing Platform apps | Pinned container images on Chief VM | Artifact Registry mirror/build publication, explicit registry authentication and reproducible source provenance |
| CockroachDB + lifecycle schema | Existing engine on dedicated persistent data disk for pilot | Correct TLS/internal authentication, app-aware backup/restore, restricted lifecycle DB role; do not substitute Cloud SQL without compatibility testing |
| Redpanda | Existing pinned service with persistent disk | Replace development-mode configuration with reviewed resource/security settings; preserve queue semantics |
| Elasticsearch | Pinned service with persistent disk | Bake required plugin into the image, review authentication and memory limits; no runtime internet plugin installation |
| Files and recordings | Existing S3-compatible service on persistent disk initially | Blob integrity/ACL and recording verification; off-host backups. GCS production adapter is a separate compatibility task |
| Backups | Product/environment-specific Cloud Storage bucket | Encrypt, restrict access, define retention, restore to a new isolated environment and prove record/blob consistency |
| Lifecycle API and worker | Separate containers after M1 acceptance | Persistent encryption key in Secret Manager, restricted roles, migrations, restart and lease/retry checks |
| Meetings | LiveKit on a dedicated media VM if load/reliability warrants; private pilot can begin on Chief VM | Public media candidates, UDP/TCP firewall rules, TURN reachability, external-device testing and bandwidth measurement |
| Personal Chief execution | Paired member desktop initially; later explicitly provisioned cloud runtimes | Outbound authenticated connection, member isolation, offline/wait behavior; cloud workspace does not keep a sleeping laptop's agents running |
| Builds | Separate CI/build worker | Never compile the frontend on the production workspace VM; publish immutable images and rollback receipts |

The inspected storage registration supports minio/S3/datalake; native GCS integration
was not found in that registration. Do not assume S3 compatibility or a bucket URL
is enough: validate multipart uploads, signing, range playback, metadata, deletion
and parent ACL enforcement before changing the live storage backend.

LiveKit needs actual media connectivity beyond the HTTPS UI. Its documented ports
include UDP/TCP media and optional TURN; select one explicit deployment profile and
open only that profile's ports. The current loopback addresses and local-only port
publishing cannot be copied unchanged to Google Cloud.
[LiveKit network requirements](https://docs.livekit.io/transport/self-hosting/ports-firewall/)

## Security and configuration changes before hosting

- Replace localhost frontend, Accounts, transactor and LiveKit advertised addresses
  with chosen HTTPS/WSS destinations. Validate login, OAuth redirects and both
  embedded and direct session behavior on the real domains; repeat mobile Safari
  and Android tests rather than assuming the localhost cookie fix is sufficient.
- Keep database, queue, search and object-store administrative ports private.
  Harden development defaults in the Compose stack before exposing any endpoint.
- Use separate Google service identities and Secret Manager access per service
  where practical. Load secrets at runtime, not from Git, image layers or Terraform
  state. Keep the lifecycle encryption key recoverable with controlled rotation;
  generating a new key each deployment would break stored credentials.
  [Secret Manager guidance](https://docs.cloud.google.com/secret-manager/docs/best-practices)
- Publish only reviewed images; retain existing third-party notices/provenance and
  the Stage 0 distribution gaps. Cloud hosting does not itself close those gaps.
- Do not copy the owner's memory server, personal agent home, OAuth tokens or desktop
  workspace into a shared customer image. Each member's runtime remains isolated.

## Sizing and cost model

For the first load-test candidate, start with **8 vCPU / 32 GiB** for the Chief
workspace, excluding CI builds, Crewframe and hosted agent sandboxes. A smaller
4-vCPU/16-GiB instance may work for light use but must be measured; the snapshot
alone does not justify that as production capacity. Provisional disk inputs:
50 GiB boot plus 200 GiB state, adjusted after measuring actual data and growth.
Use persistent data disks with deletion protection/recovery policy separate from
VM replacement. Capacity and IOPS both need verification.

Google's published general-purpose pricing page currently lists an e2-standard-8
example at **$0.26804568/hour**, approximately **$196 for 730 hours of compute**.
This is an illustrative published rate, not a chosen-region quote or an all-in
Chief estimate. Confirm the selected region and current price in the calculator.
[Google VM pricing](https://cloud.google.com/products/compute/pricing/general-purpose)

Budget separately for boot/data disks, snapshots, backup objects, static addresses,
optional load balancer/NAT, image storage, logs and especially meeting/network
egress. AI/model usage, Composio, transcription, hosted personal runtimes, Crewframe,
app-store programs and engineering/support are additional. Use **$300–600/month**
only as an initial planning allowance for a small single-VM Chief pilot, not a
quote or cap; heavy media, HA or multiple agent runtimes can exceed it substantially.
The allowance is an engineering estimate, not a provider price claim.
[Pricing calculator](https://cloud.google.com/products/calculator)

Cost worksheet: VM rate × running hours + provisioned disk GiB × regional rate +
backup storage + network GB by route/destination + media/TURN + logging/registry +
any optional load-balancing/NAT. Price an extra media VM separately. Do not combine
Crewframe into that total until its full service inventory is available.
Set per-project budgets and actionable alerts; billing budgets do not automatically
cap spending. [Google budget behavior](https://docs.cloud.google.com/billing/docs/how-to/budgets)

## Execution sequence and acceptance

1. Complete the M1 browser/runtime connection, real member removal and real dispatch
   acceptance locally in isolated fixtures. Keep mobile/cloud design work alongside
   it; do not silently treat either as already delivered.
2. Resolve deployment inputs: Google project/billing permissions, region/data
   location, domains, pilot users/meeting concurrency, spend ceiling, retention and
   recovery targets; obtain Crewframe's actual intended architecture. Proposed
   private-pilot recovery targets to validate: RPO 24 hours, RTO 4 hours. They are
   placeholders, not a commitment or proof of recovery.
3. Produce reviewable infrastructure code and a cloud-specific Compose/config
   overlay, image manifest, itemized regional cost sheet, secret inventory and
   restore runbook. Leave local configuration and volumes untouched.
4. Create a separate staging environment when deployment is authorized. Seed only
   synthetic data. Verify HTTPS/login/mobile session persistence, member isolation,
   pairing/revocation, file upload/download/playback, chat reconnect, external-network
   meetings, recording, retries and VM/worker restart. Run concurrency/load tests.
5. Prove an app-consistent backup and restore into a fresh environment. Treat disk
   snapshots as an additional layer, not sufficient proof of database/blob recovery.
6. Plan a controlled data cutover with backed-up local originals, a write freeze or
   tested migration process, checksums/counts and a documented rollback point. Do
   not let cloud and local copies independently accept writes during cutover.
7. Ship Chief-branded mobile test builds against staging; test personal pairing and
   workspace membership separately. Native signing, push and store release follow
   tested end-to-end flows.

## Recorded backlog

- MOB-01: own-branded native companion, existing client/protocol adaptation.
- MOB-02: mobile workspace connector and per-member workspace experience.
- GCP-01: Chief Google Cloud hosting design and regional cost worksheet.
- GCP-02: isolated staging infrastructure, hardening, backup/restore and load proof.
- GCP-03: controlled migration and operational release after acceptance.

Planning and local inspection are complete for this note. Provisioning, final
regional pricing, migration and mobile implementation remain future work.
