# Chief: whole Platform Contacts source and UX audit

2026-10-07. Owner scope: retain the recognizable, complete Platform/Huly Contacts feature and its source in Chief. This supersedes the earlier narrow office-feature extraction recommendation for Contacts. No contact records, account credentials, live database, or running Platform service were modified or migrated.

## Recommendation and the one architectural boundary

**Retain the Contacts application, its Svelte presentation/model packages, and a separate Chief-owned Platform service boundary.** Integrate that retained application under Chief navigation while keeping the existing agent runtime, Team map and Routines. Start with a new disposable Platform workspace and independent storage. This preserves actual source behavior—including Employee/Guest identity operations, dynamic tables, descriptions, attachments and profile cards—without inventing a replacement CRM.

There is an unavoidable architecture choice between retaining those services and porting their behavior into Chief's backend. The former is the recommended implementation direction for the owner's expanded scope. A faithful source port is possible but materially larger: it must replace Platform's document hierarchy, transactions, live queries, model registry, account operations, triggers and collaborative content APIs while retaining the observable UX. Merely copying the form components is insufficient. This audit prepares that decision; it does not change runtime architecture.

| Boundary | What is retained | What must be built | Principal tradeoff |
| --- | --- | --- | --- |
| **Retained Platform subsystem** | Original Contacts components, generic Workbench/View machinery, contact models/migrations, transactor triggers, account/storage/collaborator services | Chief navigation and branding wrapper; isolated deployment/workspace; explicit identity/session bridge; scoped future agent-to-contact interface | Highest source and behavior fidelity; operates an additional backend subsystem. |
| **Faithful source port** | Original source/provenance and UX acceptance contract; preferably keep Svelte components initially | Adapters for every model/client/account/blob/collaborative API used, equivalent transactions/triggers/permissions, packaging Svelte alongside React | Smaller eventual service footprint is possible; much greater compatibility work and regression surface. |

An isolated Svelte application mount/iframe can preserve CSS, global metadata and client-singleton boundaries during initial integration. It must point to the new Chief-owned subsystem, not the owner's running reference instance. Browser origin, frame policy, routes and session bridging need verification before promising a seamless embed. A standalone link to the old instance would not complete this integration.

## Pinned evidence and correspondence limits

- Preferred release-matched source: annotated tag `s0.7.426` peels from tag object `f7d60427b1f5fec844b77a3c1141c6a76fd25eaf` to [Platform-Collective/platform at `03b7aad7dc562f4f9769c51a4df08191a0393997`](https://github.com/Platform-Collective/platform/tree/03b7aad7dc562f4f9769c51a4df08191a0393997).
- Inspection-only files: `.chief-local/contacts-audit/`. `git check-ignore` confirms this directory is ignored. The original `manifest.json`/`tree.json` capture **194 files** at development commit `bf00cde6765de1b66311d8c92e7e129261412877` with raw URLs, Git blob IDs and SHA-256 hashes. `release/` holds the same **194 files** from the peeled release commit; `release-manifest.json` records URLs/hashes and comparison results, and `release-ref.json` preserves annotated-tag provenance. **109 Contacts Svelte files** exist in each snapshot. None was installed into Chief's application bundle.
- Coordinator's read-only UI inspection: Employee, Guest, Person and Company navigation; Person/Company tables and creation forms. Person has First name, Last name, Location and social links; Company has name, rich-text description and social links. Empty forms disable Create. The table includes name, location, files, modification date, role and contact information. Evidence: `docs/verification/evidence/platform-contacts-person-form.jpg`.
- Running reference image reported by coordinator: `platformcollective/front:s0.7.426`, digest `sha256:03c16b1ab7ab590f988d781cea345bb2ba06b7f792b819cdb0dd0b39bf14bebe`; image labels do not provide source revision. **Exact image-to-source correspondence is unproven.** The matching UX is corroboration, not a reproducible-build attestation. Preserve image digest and obtain tag/commit/build provenance before claiming exact fidelity to that build.
- Hindsight recall was attempted; `agent-family` timed out and results were partial/unrelated. This audit relies on current owner scope, the pinned source and the coordinator's live inspection.

## Release comparison

Of 194 fetched files, **189 are byte-identical** between release and reviewed development snapshots. All six Contacts/model/server manifests, the contact model/navigation, creation forms, Workbench SpecialView, TableBrowser and server triggers match. Five differ: presentation package adds a Node type dev dependency; `ChannelsEditor.svelte`, `ChannelsPresenter.svelte`, `EditPerson.svelte` and Contacts `utils.ts` add/consolidate person-contact edit gating in development, including same-account matching and maintainer checks. This is a specific permission-regression review item, not proof that the released server permits unauthorized writes. Test both UI and direct transactions before choosing a backport. Do not silently combine development UI/model files with release server binaries.

## Actual entrypoints and behavior

The current application is registered in [models/contact/src/index.ts][model] at lines 447–529. Its navigator creates four `workbench.component.SpecialView` entries: `employees`, `guests`, `persons`, `companies`. The commented `ContactsTabs` entry and standalone `Contacts.svelte` are **not** the current navigator entrypoint.

| Surface | Exact source and required behavior |
| --- | --- |
| Navigation, list/filter/search | [Workbench `SpecialView.svelte`][special] selects registered viewlets and merges model/base/search/filter queries. [TableBrowser.svelte][table] and the View model provide columns, actions, sorting, preferences and presenters. The contact model defines Person, Employee and Company table configurations at lines 576–670. |
| Person creation | [CreatePerson.svelte][person] checks first/last names and duplicates, creates a Person document, attaches Channel documents and uploads chosen avatar. The profile card is created by a server trigger. |
| Company creation | [CreateOrganization.svelte][company] uses hierarchy defaults, collaborative markup, attachments and a batched transaction for company plus channels. Keeping only a text description field would lose source behavior. |
| Employee and Guest | [CreateEmployee.svelte][employee] / [CreateGuest.svelte][guest] call account `ensurePerson`, attach SocialIdentity, add the Employee mixin with different roles, and resolve `login.function.SendInvite`. These are account/workspace operations, not just labels on contact rows. Test mail must be captured locally; no real invitation is authorized here. |
| Edit/detail experience | `EditPerson.svelte`, `PersonContent.svelte`, `EditOrganization.svelte`, `EditOrganizationPanel.svelte`, channel editors, member editors, avatar cropping/upload, profile-card presenters and merge actions are registered in [contact-resources/src/index.ts][resources]. Company panels query live documents and resolve dynamic attribute editors and notification state. |
| Server behavior | [models/server-contact/src/index.ts][servermodel] registers [contact server triggers][triggers]: Person creation adds a UserProfile and reference; employee activation creates personal spaces and membership effects; channel changes synchronize related fields; deletion cleans related objects/storage; typed-space member changes propagate. These must survive a port. |

Contact domain classes include Contact, Person, Organization, Member, Channel, SocialIdentity, Employee mixin, PersonSpace and UserProfile. The source separates communication channels from account social identity. That separation must remain intact; a stored email/phone contact field must not implicitly grant a Chief login or agent permission.

## Measured package dependencies

Direct production dependency counts at the pinned source; these are not transitive totals. All six manifests below declare `EPL-2.0`.

| Package directory | Total direct dependencies | `@hcengineering/*` dependencies |
| --- | ---: | ---: |
| `plugins/contact` | 7 | 7 |
| `plugins/contact-resources` | 28 | 26 |
| `models/contact` | 26 | 26 |
| `server-plugins/contact` | 6 | 6 |
| `server-plugins/contact-resources` | 12 | 12 |
| `models/server-contact` | 9 | 9 |

The Contacts UI's two external production dependencies are Svelte and `crypto-js`. Its platform imports include core/platform, presentation, UI/theme, view/view-resources, account-client/login, attachment resources, notification, panel/workbench, rich-text editor, image cropper, templates and activity. The contact model also imports Card and Chunter models. Hiding unrelated navigation does not remove these runtime/model dependencies.

## Minimum runnable boundary to prove

1. **Frontend context:** preserve Svelte build/runtime, theme/styles/icons/locales, resource loader and registered models; mount the actual navigator/SpecialView with the same class IDs and viewlets. Keep popup/focus, filters, table preference and dynamic editor contexts.
2. **Document runtime:** retain `getClient(): TxOperations & Client`, model hierarchy, `findOne/findAll`, live query subscriptions, `createDoc/update/createMixin/addCollection`, batched `apply().commit()` and server trigger processing. [Presentation utilities][presentation] establish this shared client and live-query pipeline. A generic CRUD API is not a compatible substitute.
3. **Identity:** use new Platform workspace/account identities mapped explicitly to Chief principals. Retain Employee versus Guest roles and workspace permissions. Chief office bearer tokens and private-agent sessions must not become unrestricted Platform credentials. No tokens in URL query strings or unrestricted cross-frame messages.
4. **Storage/editing:** retain scoped blob upload/delete, avatar cropping, attachment collection operations and collaborative descriptions. [Presentation collaborator client][collab] requires workspace identity, token and collaborator URL for `createMarkup`. Persist documents and blobs in new volumes, never the reference volumes.
5. **Service candidate:** account, workspace/bootstrap, transactor, front, database, object storage/datalake and collaborator are the core source-informed boundary. The pinned [minimal compose override][min] also retains queue-related infrastructure from its base configuration and disables some auxiliary services. It is **not** a proven Contacts-only deployment, and it disables full-text services: search behavior must be tested before pruning them. Start from a known-working isolated stack, then reduce services only after the entire acceptance suite remains green.

No minimal deployment was launched and no mutation test was run during this inspection. Avoid advertising a container count, resource budget or package-only import until the retained boundary has been built and tested.

## Acceptance checks before claiming whole Contacts reuse

- Verify source/build manifest, asset/resource loading, four navigation categories, visible columns, person/company dialogs, social-provider choices and disabled empty-form state against the reference.
- Use synthetic Person/Company records for create, edit, duplicate prevention, search/filter/sort, persistence after restart, avatars, files, rich-text descriptions, channels, company membership and delete cleanup. Check multiple browser clients receive updates.
- Use isolated accounts and a local mail sink for Employee/Guest creation, role checks, invitation acceptance and deactivation. Prove a contact record alone grants no login. Confirm Person creation also creates its profile card and Employee activation creates its personal space.
- Prove workspace/role isolation for records, files, descriptions and subscriptions. Reject cross-workspace IDs, forged identities, stale/revoked sessions and direct unauthorized writes. Chief private bots/chats must remain inaccessible to Contacts identities without explicit mapping.
- Exercise merge/conflict behavior, keyboard focus/dialog cancellation, narrow layouts, loading/error recovery and preference persistence. Match actual retained behavior rather than substituting a generic contact grid.
- Test Chief navigation/back/deep links with the retained module, retain Routines/Team map, and verify subsystem outage does not break private-agent workflows.

## Source and license handling

Retain the [upstream EPL-2.0 license][license], individual Anticrm Platform Contributors and Hardcore Engineering copyright headers, and notices for every copied dependency. Do not rename internal IDs or remove upstream attribution as branding. The source snapshot contains differing copyright years; preserve each file's original header rather than replacing them with one new Chief header.

When these inspection files become an implementation, create a vendored-source manifest or isolated fork with upstream revision, changed-file list and a reproducible build. Identify the applicable EPL source-availability and distribution obligations for the resulting concrete module; do not relabel copied EPL code as Apache. A service boundary is an engineering isolation mechanism, not a blanket licensing exemption. No production distribution is performed by this audit.

[model]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/models/contact/src/index.ts
[special]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/plugins/workbench-resources/src/components/SpecialView.svelte
[table]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/plugins/view-resources/src/components/TableBrowser.svelte
[person]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/plugins/contact-resources/src/components/CreatePerson.svelte
[company]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/plugins/contact-resources/src/components/CreateOrganization.svelte
[employee]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/plugins/contact-resources/src/components/CreateEmployee.svelte
[guest]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/plugins/contact-resources/src/components/CreateGuest.svelte
[resources]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/plugins/contact-resources/src/index.ts
[servermodel]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/models/server-contact/src/index.ts
[triggers]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/server-plugins/contact-resources/src/index.ts
[presentation]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/packages/presentation/src/utils.ts
[collab]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/packages/presentation/src/collaborator.ts
[min]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/dev/docker-compose.min.yaml
[license]: https://github.com/Platform-Collective/platform/blob/03b7aad7dc562f4f9769c51a4df08191a0393997/LICENSE
