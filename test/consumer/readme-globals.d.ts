// Placeholders for the README code samples, which are fragments of one page of usage.
// Only names the samples use without declaring are declared here; everything AkariSP-typed
// comes from the packed package. A script file (no top-level import), so these are globals.
declare const runtime: import('akarisp').Runtime;
declare const createRuntime: typeof import('akarisp').createRuntime; // Templates continues Usage's import
declare const output: HTMLElement;
declare const userClickedStop: boolean;
declare const text: string;
declare function render(chunk: string): void;

// The application's own WebLLM dependency is not installed in the consumer (offline). The real
// MLCEngine is checked against createWebLLMRuntime by the T011 release gate; this stub only lets
// the README sample compile.
declare module '@mlc-ai/web-llm' {
  export function CreateMLCEngine(model: string): Promise<Parameters<typeof import('akarisp/webllm').createWebLLMRuntime>[0]>;
}
