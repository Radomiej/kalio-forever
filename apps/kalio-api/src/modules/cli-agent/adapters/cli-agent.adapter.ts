/**
 * Common interface every CLI coding-agent adapter must implement.
 * A new agent (Gemini CLI, Claude Code, …) = one file implementing this interface.
 */
export interface ICLIAgentAdapter {
  /** Unique stable identifier — used as config key and in tool args. */
  readonly id: string;

  /** Human-readable name shown in the UI. */
  readonly displayName: string;

  /** URL to installation docs — shown in settings when agent is not found. */
  readonly installUrl: string;

  /** Whether this CLI has a first-class model flag. */
  readonly supportsModelSelection: boolean;

  /**
   * Returns the executable to spawn.
   * On Windows, .cmd shims must be wrapped in cmd /c — use this method
   * to return the correct executable per platform.
   */
  executable(platform: NodeJS.Platform): string;

  /**
   * Returns extra prefix args needed when wrapping via cmd on Windows.
   * Returns [] on non-Windows.
   */
  wrapperArgs(platform: NodeJS.Platform): string[];

  /**
   * Builds the args list for a headless prompt run.
   * @param prompt  The task description — injected verbatim; never shell-expanded.
   * @param workdir Absolute path the agent should operate in.
   * @param extra   Additional args from user config (appended last).
   * @param model   Optional model override for adapters that support it.
   */
  buildArgs(prompt: string, workdir: string, extra?: string[], model?: string): string[];

  /** Args for the version probe (e.g. ['--version']). */
  probeArgs(): string[];
}
