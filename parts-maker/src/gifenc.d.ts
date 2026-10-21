declare module "gifenc" {
  export function GIFEncoder(opts?: { auto?: boolean }): {
    writeFrame: (
      index: Uint8Array | Uint8ClampedArray,
      width: number,
      height: number,
      opts?: {
        palette?: number[][] | Uint8Array[] | number[][];
        delay?: number;
        dispose?: number;
      },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
    buffer: ArrayBuffer;
  };
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: string; oneBitAlpha?: boolean; clearAlpha?: boolean },
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}
