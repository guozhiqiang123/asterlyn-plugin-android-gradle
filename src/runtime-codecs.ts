interface Base64Uint8ArrayConstructor extends Uint8ArrayConstructor {
  fromBase64?: (input: string) => Uint8Array;
}

interface Base64Uint8Array extends Uint8Array {
  toBase64?: () => string;
}

interface LineTextDecoder extends TextDecoder {
  decodeLines?: (input: AllowSharedBufferSource, options?: { readonly trim?: boolean; readonly stripAnsi?: boolean }) => string[];
  decodeGradleTasks?: (input: AllowSharedBufferSource) => unknown;
}

export function decodeNativeGradleTasks(value: Uint8Array): unknown | null {
  const decoder = new TextDecoder("utf-8", { fatal: false }) as LineTextDecoder;
  return typeof decoder.decodeGradleTasks === "function" ? decoder.decodeGradleTasks(value) : null;
}

export function decodeUtf8Lines(value: Uint8Array): string[] {
  const decoder = new TextDecoder("utf-8", { fatal: false }) as LineTextDecoder;
  if (typeof decoder.decodeLines === "function") return decoder.decodeLines(value, { trim: true, stripAnsi: true });
  const text = decoder.decode(value);
  const lines = text.includes("\r") ? text.replaceAll("\r\n", "\n").split("\n") : text.split("\n");
  return lines.map((line) => stripAnsi(line).trim());
}

function stripAnsi(value: string): string {
  return value.includes("\u001b") || value.includes("\u009b")
    ? value.replace(/[\u001B\u009B]\[[0-?]*[ -/]*[@-~]/gu, "")
    : value;
}

export function decodeBase64Bytes(value: string): Uint8Array {
  const constructor = Uint8Array as Base64Uint8ArrayConstructor;
  if (typeof constructor.fromBase64 === "function") return constructor.fromBase64(value);
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeBase64Bytes(value: Uint8Array): string {
  const fast = (value as Base64Uint8Array).toBase64;
  if (typeof fast === "function") return fast.call(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...value.subarray(offset, offset + 32_768)));
  }
  return btoa(chunks.join(""));
}
