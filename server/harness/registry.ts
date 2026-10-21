// Provider instance registry — port of upstream's ProviderInstanceRegistryLive
// behavior, minus Effect: config map → live instances; unknown driver or
// config-decode failure becomes an UNAVAILABLE SHADOW SNAPSHOT instead of a
// startup failure (that behavior is what makes settings forward/backward
// compatible — do not remove it); dispose tears an instance down without
// touching its siblings.
import { findCliCandidates } from "../env-path.ts";
import { installNpmEngine, npmAvailable, serverInstallFor } from "../engine-install.ts";
import type {
  AnyProviderDriver,
  InstanceConfigMap,
  InstanceId,
  ProviderAuthenticationStart,
  ProviderAuthenticationStatus,
  ProviderInstance,
  ProviderSnapshot,
} from "../contracts.ts";

export interface ShadowInstance {
  instanceId: InstanceId;
  driverKind: string;
  displayName: string | undefined;
  /** Raw `config.cli` from disk — an override exists only if this is set. */
  cli: string | undefined;
  shadow: true;
  reason: string;
}

export type RegistryEntry =
  | { instanceId: InstanceId; live: ProviderInstance; shadow?: undefined }
  | { instanceId: InstanceId; live?: undefined; shadow: ShadowInstance };

const SNAPSHOT_FRESH_MS = 30_000;
const SNAPSHOT_STALE_MS = 120_000;
const SNAPSHOT_FAILURE_MS = 5_000;
type SnapshotProbe = { value?: ProviderSnapshot; at: number; pending?: Promise<ProviderSnapshot> };

/** The driver's install descriptor plus what this machine can do about it. */
function withServerInstall(install: AnyProviderDriver["install"], npmPresent: boolean): AnyProviderDriver["install"] {
  const server = install ? serverInstallFor(install, npmPresent) : null;
  return server ? { ...install, server } : install;
}

/** The `cli` field off a driver's default config, when it has one — the
 * placeholder an override input shows when nothing is set. */
function cliDefaultOf(driver: AnyProviderDriver | undefined): string | undefined {
  if (!driver) return undefined;
  try {
    const cfg = driver.defaultConfig() as { cli?: unknown };
    return typeof cfg?.cli === "string" ? cfg.cli : undefined;
  } catch {
    return undefined;
  }
}

/** Raw `config.cli` straight from disk — shadow snapshots can't decode, so
 * this is the only faithful way to echo back what was configured. */
function cliOfRaw(raw: unknown): string | undefined {
  const cli = (raw as { cli?: unknown } | undefined)?.cli;
  return typeof cli === "string" && cli ? cli : undefined;
}

export class ProviderRegistry {
  private byId = new Map<InstanceId, RegistryEntry>();
  /** decoded per-instance `cli` overrides, for describe() — drivers spawn
   * from their own config; this map only reports what was configured */
  private cliByInstance = new Map<InstanceId, string>();
  private driversByKind: Map<string, AnyProviderDriver>;
  /** Where Settings-driven npm installs go; the data directory by default. */
  private readonly enginesBaseDir: string | undefined;
  /** Whether npm is on this machine; injectable because the PATH scan also
   * looks in standard install locations, which tests cannot empty. */
  private readonly npmPresent: () => boolean;
  private readonly now: () => number;
  private readonly snapshotProbes = new WeakMap<ProviderInstance, SnapshotProbe>();

  constructor(drivers: readonly AnyProviderDriver[], options: { enginesBaseDir?: string; npmAvailable?: () => boolean; now?: () => number } = {}) {
    this.enginesBaseDir = options.enginesBaseDir;
    this.npmPresent = options.npmAvailable ?? npmAvailable;
    this.now = options.now ?? Date.now;
    this.driversByKind = new Map(drivers.map((d) => [d.driverKind, d]));
  }

  async load(configs: InstanceConfigMap, decorate?: (instance: ProviderInstance) => ProviderInstance) {
    for (const [instanceId, entry] of Object.entries(configs)) {
      // Account edits replace only their own process/session state.
      await this.dispose(instanceId);
      const driver = this.driversByKind.get(entry.driver);
      if (!driver) {
        this.byId.set(instanceId, {
          instanceId,
          shadow: {
            instanceId,
            driverKind: entry.driver,
            displayName: entry.displayName,
            cli: cliOfRaw(entry.config),
            shadow: true,
            reason: `unknown driver "${entry.driver}" — kept as configured, unavailable here`,
          },
        });
        continue;
      }
      try {
        const config = entry.config === undefined ? driver.defaultConfig() : driver.decodeConfig(entry.config);
        // Override detection is on the RAW config, never the decoded one:
        // decodeConfig fills in the driver default ("claude", "codex", …),
        // so reading `cli` there would flag every instance as overridden.
        const rawCli = cliOfRaw(entry.config);
        if (rawCli) this.cliByInstance.set(instanceId, rawCli);
        const live = await driver.create({
          instanceId,
          displayName: entry.displayName ?? driver.metadata.displayName,
          environment: entry.environment ?? {},
          enabled: entry.enabled ?? true,
          config,
        });
        const instance = this.invalidateSnapshotsOnChanges(decorate ? decorate(live) : live);
        this.byId.set(instanceId, { instanceId, live: instance });
      } catch (e) {
        this.byId.set(instanceId, {
          instanceId,
          shadow: {
            instanceId,
            driverKind: entry.driver,
            displayName: entry.displayName ?? driver.metadata.displayName,
            cli: cliOfRaw(entry.config),
            shadow: true,
            reason: e instanceof Error ? e.message : String(e),
          },
        });
      }
    }
  }

  get(instanceId: InstanceId): ProviderInstance | null {
    return this.byId.get(instanceId)?.live ?? null;
  }

  /** Settings calls instance methods directly too (ProviderAuthSessions). Keep
   * their next description fresh even when the action rejects after changing
   * local auth. An old in-flight result belongs only to its detached cache. */
  private invalidateSnapshotsOnChanges(instance: ProviderInstance): ProviderInstance {
    const wrap = <A extends unknown[], R>(action: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
      this.snapshotProbes.delete(instance);
      try { return await action(...args); }
      finally { this.snapshotProbes.delete(instance); }
    };
    // Decorate this exact object: cloning changes `this` for private fields and
    // separates mutable instance state from the auth methods that update it.
    Object.assign(instance, {
      ...(instance.startAuthentication ? { startAuthentication: wrap(instance.startAuthentication.bind(instance)) } : {}),
      ...(instance.getAuthentication ? { getAuthentication: wrap(instance.getAuthentication.bind(instance)) } : {}),
      ...(instance.completeAuthentication ? { completeAuthentication: wrap(instance.completeAuthentication.bind(instance)) } : {}),
      ...(instance.cancelAuthentication ? { cancelAuthentication: wrap(instance.cancelAuthentication.bind(instance)) } : {}),
      ...(instance.signOut ? { signOut: wrap(instance.signOut.bind(instance)) } : {}),
      ...(instance.installRuntime ? { installRuntime: wrap(instance.installRuntime.bind(instance)) } : {}),
      ...(instance.refreshModels ? { refreshModels: wrap(instance.refreshModels.bind(instance)) } : {}),
    });
    return instance;
  }

  /** Descriptions are discovery/UI hints, never authorization. CLI version and
   * login probes can each start a process; multiple windows must share that
   * work. Initial discovery is complete, then bounded stale data keeps ordinary
   * refreshes responsive while one probe refreshes the hint in the background. */
  private describeSnapshot(instance: ProviderInstance): Promise<ProviderSnapshot> {
    let probe = this.snapshotProbes.get(instance);
    if (!probe) {
      probe = { at: 0 };
      this.snapshotProbes.set(instance, probe);
    }
    const held = probe;
    const age = this.now() - held.at;
    const freshMs = held.value?.state === "available" ? SNAPSHOT_FRESH_MS : SNAPSHOT_FAILURE_MS;
    if (held.value && age >= 0 && age < freshMs) return Promise.resolve(held.value);
    if (!held.pending) {
      held.pending = Promise.resolve().then(() => instance.snapshot())
        .catch((error: unknown): ProviderSnapshot => ({ state: "unavailable", reason: error instanceof Error ? error.message : String(error) }))
        .then(value => {
          held.value = value;
          held.at = this.now();
          held.pending = undefined;
          return value;
        });
    }
    // Failed probes also refresh in the background: their short retry window
    // may expire before a slower sibling's initial discovery even finishes.
    if (held.value && age >= 0 && age < SNAPSHOT_STALE_MS) return Promise.resolve(held.value);
    return held.pending;
  }

  /** The configured executable for instance-scoped maintenance actions.
   * This deliberately comes from the registry/config, never an HTTP body. */
  cliTarget(instanceId: InstanceId): { driverKind: string; cli: string | null } | null {
    const entry = this.byId.get(instanceId);
    if (!entry) return null;
    const driverKind = entry.shadow?.driverKind ?? entry.live!.driverKind;
    const driver = this.driversByKind.get(driverKind);
    return {
      driverKind,
      cli: this.cliByInstance.get(instanceId) ?? entry.shadow?.cli ?? cliDefaultOf(driver) ?? null,
    };
  }

  entries(): RegistryEntry[] {
    return [...this.byId.values()];
  }

  instances(): ProviderInstance[] {
    return [...this.byId.values()].flatMap((e) => (e.live ? [e.live] : []));
  }

  async refreshModels(instanceId: InstanceId): Promise<boolean> {
    const instance = this.get(instanceId);
    if (!instance) return false;
    this.snapshotProbes.delete(instance);
    try { await instance.refreshModels?.(); }
    finally { this.snapshotProbes.delete(instance); }
    return true;
  }

  /** A driver's own installer (a managed download) first; otherwise the
   * app's npm prefix, when the driver's install one-liner is an npm package
   * and npm is on PATH. False means Settings has nothing to offer here. */
  async installRuntime(instanceId: InstanceId): Promise<boolean> {
    const entry = this.byId.get(instanceId);
    if (!entry) return false;
    if (entry.live?.installRuntime) {
      await entry.live.installRuntime();
      return true;
    }
    const driver = this.driversByKind.get(entry.shadow?.driverKind ?? entry.live!.driverKind);
    const server = serverInstallFor(driver?.install, this.npmPresent());
    if (!server) return false;
    await installNpmEngine(server.package, { baseDir: this.enginesBaseDir, cli: cliDefaultOf(driver) });
    if (entry.live) this.snapshotProbes.delete(entry.live);
    return true;
  }

  async startAuthentication(instanceId: InstanceId): Promise<ProviderAuthenticationStart | null> {
    const instance = this.get(instanceId);
    return instance?.startAuthentication ? instance.startAuthentication() : null;
  }

  async getAuthentication(instanceId: InstanceId, flowId: string): Promise<ProviderAuthenticationStatus | null> {
    const instance = this.get(instanceId);
    return instance?.getAuthentication ? instance.getAuthentication(flowId) : null;
  }

  async completeAuthentication(instanceId: InstanceId, flowId: string, callbackUrl: string): Promise<boolean> {
    const instance = this.get(instanceId);
    if (!instance?.completeAuthentication) return false;
    await instance.completeAuthentication(flowId, callbackUrl);
    return true;
  }

  async cancelAuthentication(instanceId: InstanceId): Promise<boolean> {
    const instance = this.get(instanceId);
    if (!instance?.cancelAuthentication) return false;
    await instance.cancelAuthentication();
    return true;
  }

  /** instance snapshots for the model picker: id, driver, models, health */
  async describe() {
    // Multiple instances may share a driver. Scan each default binary once
    // per response instead of repeating filesystem work for every row.
    const candidatesByName = new Map<string, string[]>();
    const candidatesFor = (driver: AnyProviderDriver | undefined): string[] => {
      const name = cliDefaultOf(driver);
      if (!name) return [];
      const cached = candidatesByName.get(name);
      if (cached) return cached;
      const found = findCliCandidates(name);
      candidatesByName.set(name, found);
      return found;
    };
    const npmPresent = this.npmPresent();
    return Promise.all(
      this.entries().map(async (entry) => {
        const driver = this.driversByKind.get(entry.shadow?.driverKind ?? entry.live!.driverKind);
        if (entry.shadow) {
          return {
            instanceId: entry.instanceId,
            driverKind: entry.shadow.driverKind,
            displayName: entry.shadow.displayName ?? entry.shadow.driverKind,
            snapshot: { state: "unavailable", reason: entry.shadow.reason } satisfies ProviderSnapshot,
            models: { default: "", options: [] },
            capabilities: { computerMcp: false, agentsMcp: false, localComputerMcp: false },
            // an unknown driver has no driver record, hence no install path
            access: driver?.metadata.access ?? "subscription",
            install: withServerInstall(driver?.install, npmPresent),
            cli: entry.shadow.cli,
            cliDefault: cliDefaultOf(driver),
            // a shadow is exactly the "your CLI is broken, pick another"
            // case where the detected-path dropdown matters most
            cliCandidates: candidatesFor(driver),
          };
        }
        const inst = entry.live;
        let snapshot: ProviderSnapshot;
        try {
          snapshot = await this.describeSnapshot(inst);
        } catch (e) {
          snapshot = { state: "unavailable", reason: e instanceof Error ? e.message : String(e) };
        }
        return {
          instanceId: inst.instanceId,
          driverKind: inst.driverKind,
          displayName: inst.displayName ?? inst.driverKind,
          snapshot,
          models: inst.models,
          capabilities: {
            computerMcp: inst.adapter.capabilities.computerMcp === true,
            agentsMcp: inst.adapter.capabilities.agentsMcp === true,
            composioMcp: inst.adapter.capabilities.composioMcp === true,
            phoneMcp: inst.adapter.capabilities.phoneMcp === true,
            browserMcp: inst.adapter.capabilities.browserMcp === true,
            images: inst.adapter.capabilities.images === true,
            effortLevels: inst.adapter.capabilities.effortLevels,
            modelVariants: inst.adapter.capabilities.modelVariants === true,
            queueing: inst.adapter.capabilities.queueing === true,
            localComputerMcp: inst.adapter.capabilities.localComputerMcp === true,
            approvalReview: inst.reviewPermission !== undefined,
          },
          access: driver?.metadata.access ?? "subscription",
          install: withServerInstall(driver?.install, npmPresent),
          authentication: inst.startAuthentication
            ? {
                method: inst.authenticationMethod ?? (inst.getAuthentication && inst.completeAuthentication
                  ? "paste-code" as const // a link to open, then a code pasted back (Claude)
                  : inst.getAuthentication
                    ? "device-code" as const // a code to enter at the provider's page (Codex)
                    : "browser" as const), // a link and a callback URL (managed engines)
                // the browser may remove the stored sign-in to switch accounts
                signOut: inst.signOut !== undefined,
              }
            : undefined,
          cli: this.cliByInstance.get(inst.instanceId),
          cliDefault: cliDefaultOf(driver),
          // every copy of the driver's default binary on the augmented PATH —
          // the dropdown's "detected" entries. Snapshotted per describe() so a
          // newly installed CLI shows up on the next refresh.
          cliCandidates: candidatesFor(driver),
        };
      }),
    );
  }

  async disposeAll() {
    for (const instance of this.instances()) this.snapshotProbes.delete(instance);
    await Promise.allSettled(this.instances().map((i) => i.dispose()));
    this.byId.clear();
    this.cliByInstance.clear();
  }

  async dispose(instanceId: InstanceId) {
    const entry = this.byId.get(instanceId);
    if (entry?.live) this.snapshotProbes.delete(entry.live);
    this.byId.delete(instanceId);
    this.cliByInstance.delete(instanceId);
    await entry?.live?.dispose();
  }
}
