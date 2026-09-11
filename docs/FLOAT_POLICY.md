# Verified Cart Floating-Point Policy

## Rule

Integers remain the default for verified cart state. A cart may use guest-side
`f64` for an inherently continuous problem when fixed-point code would be
disproportionate and the cart satisfies every requirement below.

An accepted `f64` path must:

1. compile all math into the cart, with no host math import or ABI expansion;
2. operate on documented finite input domains;
3. avoid behavior that depends on NaN, Infinity, NaN payloads, or exceptional
   IEEE edge cases;
4. use `f64` consistently instead of casually mixing `f32` and `f64`;
5. quantize to integers before drawing, formatting, tracing semantic results,
   branching on verified outcomes, or crossing another verified boundary;
6. include native- and web-reproduced conformance vectors for the operations
   that justify floating point.

State machines, counters, inputs, most physics, and all host ABI values remain
integer by default.

## Technical basis

AssemblyScript compiles basic `f64`, `sqrt`, and its musl-derived
transcendental implementations into the guest WebAssembly module. The cart
therefore carries one numeric program to both runtimes instead of dispatching
to separate native and JavaScript math libraries.

This property applies only to finite, controlled domains. Host math imports,
NaN-dependent behavior, and tolerance-based runtime grading would create new
cross-runtime ambiguity and are not allowed.

The neutral `sunny-math` conformance fixture exercises the accepted scalar,
vector, and rectangle operation set. Its fault companions verify rejection of
non-finite values, invalid ranges, and out-of-range integer quantization.

## Toolchain maintenance

AssemblyScript is a cart build input, so maintained source builds exact-pin the
compiler and use lockfiles. To update that pin:

1. update the exact version and lockfiles together;
2. rebuild every maintained cart and conformance cart;
3. run native and web conformance plus browser and catalog checks;
4. inspect every golden change, with special attention to float fixtures;
5. accept new goldens only when the semantic change is understood.

The compiler version is not part of the ABI. An already-built `.wasm` cart
remains the portable runtime artifact.

## Not allowed

- host-provided math imports;
- unchecked floating point as the default for every cart;
- NaN or Infinity sentinels in verified behavior;
- tolerance-based framebuffer or event comparison;
- automatic mass re-blessing after a compiler update.
