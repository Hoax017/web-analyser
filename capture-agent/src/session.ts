import {
  chromium,
  type BrowserContext,
  type Request,
  type Response,
} from "playwright-core";

import { emit, type AgentConfig, type BodyEncoding, type CapturedExchange } from "./protocol.js";

/** Resource types ignored unless `captureStaticAssets` is enabled. */
const STATIC_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "image",
  "media",
  "font",
  "stylesheet",
  "texttrack",
  "manifest",
]);

const IGNORED_SCHEMES = ["data:", "blob:", "chrome-extension:", "chrome:", "devtools:"];

const TEXTUAL_MIME = /^(text\/|application\/(json|.*\+json|xml|.*\+xml|javascript|x-www-form-urlencoded|graphql))/i;

/** Delay after which a response whose body is never read by the page is recorded anyway. */
const UNFINISHED_FALLBACK_MS = 3_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface EncodedBody {
  body: string | null;
  encoding: BodyEncoding;
  size: number | null;
}

async function readResponseBody(
  response: Response,
  mimeType: string | null,
  maxBytes: number,
): Promise<EncodedBody> {
  let buffer: Buffer;
  try {
    buffer = await response.body();
  } catch {
    // Redirects, evicted resources, etc. have no retrievable body.
    return { body: null, encoding: "none", size: null };
  }
  const size = buffer.length;
  if (mimeType !== null && TEXTUAL_MIME.test(mimeType)) {
    return { body: buffer.subarray(0, maxBytes).toString("utf8"), encoding: "utf8", size };
  }
  if (size > maxBytes) {
    return { body: null, encoding: "none", size };
  }
  return { body: buffer.toString("base64"), encoding: "base64", size };
}

export class CaptureSession {
  private paused = false;
  private context: BrowserContext | null = null;
  private readonly attached = new WeakSet<BrowserContext>();
  private readonly recorded = new WeakSet<Request>();
  private readonly pending = new Map<Request, NodeJS.Timeout>();
  private closing = false;

  constructor(private readonly config: AgentConfig) {}

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  async start(): Promise<void> {
    const { target } = this.config;

    if (target.kind === "launch") {
      // Real Chrome + persistent profile + no automation banner: looks like a
      // regular user session for most anti-bot systems.
      const context = await chromium.launchPersistentContext(this.config.userDataDir, {
        channel: "chrome",
        headless: false,
        viewport: null,
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
      });
      this.context = context;
      this.attach(context);
      context.on("close", () => void this.shutdown());

      emit({ type: "ready", browserVersion: context.browser()?.version() ?? "Google Chrome" });
      await this.openStartUrl(context, target.startUrl, false);
      return;
    }

    const browser = await chromium.connectOverCDP(target.endpoint);
    const contexts = browser.contexts();
    for (const context of contexts) this.attach(context);
    browser.on("disconnected", () => void this.shutdown());
    emit({ type: "ready", browserVersion: `Chrome connecté ${browser.version()}` });

    const context = contexts[0];
    if (context) await this.openStartUrl(context, target.startUrl, true);
  }

  /** Navigates to the start URL; on a user's browser, a new tab is used so nothing is lost. */
  private async openStartUrl(context: BrowserContext, url: string | null, newTab: boolean): Promise<void> {
    if (!url) return;
    try {
      const page = newTab ? await context.newPage() : (context.pages()[0] ?? (await context.newPage()));
      await page.goto(url);
    } catch (error: unknown) {
      emit({ type: "error", message: `Navigation impossible : ${errorMessage(error)}` });
    }
  }

  private attach(context: BrowserContext): void {
    if (this.attached.has(context)) return;
    this.attached.add(context);
    context.on("response", (response) => this.armFallback(response.request()));
    context.on("requestfinished", (request) => this.complete(request, null));
    context.on("requestfailed", (request) =>
      this.complete(request, request.failure()?.errorText ?? "Échec inconnu"),
    );
  }

  /**
   * Chrome never reports a request as finished while the page has not read its
   * response body (fire-and-forget `fetch`). Such requests are recorded without
   * body once the response has been received for a while.
   */
  private armFallback(request: Request): void {
    if (this.pending.has(request) || this.recorded.has(request) || !this.shouldCapture(request)) return;
    const timer = setTimeout(() => {
      this.pending.delete(request);
      void this.record(request, null, false);
    }, UNFINISHED_FALLBACK_MS);
    this.pending.set(request, timer);
  }

  private complete(request: Request, failureText: string | null): void {
    const timer = this.pending.get(request);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pending.delete(request);
    }
    void this.record(request, failureText, true);
  }

  private shouldCapture(request: Request): boolean {
    if (this.paused) return false;
    const url = request.url();
    if (IGNORED_SCHEMES.some((scheme) => url.startsWith(scheme))) return false;
    return this.config.captureStaticAssets || !STATIC_RESOURCE_TYPES.has(request.resourceType());
  }

  private async record(request: Request, failureText: string | null, readBody: boolean): Promise<void> {
    if (this.recorded.has(request) || !this.shouldCapture(request)) return;
    this.recorded.add(request);
    try {
      const response = failureText === null ? await request.response() : null;
      const timing = request.timing();
      const startedAt = timing.startTime > 0 ? Math.round(timing.startTime) : Date.now();
      const durationMs = timing.responseEnd >= 0 ? timing.responseEnd : null;

      const mimeType = response ? ((await response.headerValue("content-type")) ?? null) : null;
      const body =
        response && readBody
          ? await readResponseBody(response, mimeType, this.config.maxBodyBytes)
          : { body: null, encoding: "none" as const, size: null };

      const exchange: CapturedExchange = {
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        startedAt,
        durationMs,
        requestHeaders: await request.headersArray(),
        requestBody: request.postData(),
        status: response?.status() ?? null,
        statusText: response?.statusText() ?? null,
        mimeType,
        responseHeaders: response ? await response.headersArray() : [],
        responseBody: body.body,
        responseBodyEncoding: body.encoding,
        responseSize: body.size,
        failureText,
      };
      if (!this.paused) emit({ type: "exchange", data: exchange });
    } catch (error: unknown) {
      emit({ type: "log", level: "warn", message: `Capture ignorée (${request.url()}) : ${errorMessage(error)}` });
    }
  }

  async shutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    try {
      // Only close what we launched; a CDP-attached browser belongs to the user.
      if (this.context && this.config.target.kind === "launch") await this.context.close();
    } catch {
      // Already closed by the user.
    }
    emit({ type: "closed" });
    process.exit(0);
  }
}
