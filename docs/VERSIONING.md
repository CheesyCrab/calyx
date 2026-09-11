# Calyx Versioning

Calyx uses separate product, application binary interface (ABI), and component
versions. Each number answers a different compatibility question.

## Product version

The product version identifies a player release. It describes the console,
catalog, documentation, and packaged application as one user-facing product.

Calyx is currently a prerelease product. Source and package metadata use the
`1.0.0-rc.1` release-candidate identity where an artifact needs a version, but no
stable Calyx 1.0 release has been published.

A product version does not determine cart compatibility. Release-candidate,
stable release, and implementation status are separate claims.

## ABI version

The ABI version identifies the cart/runtime contract. The current contract is
**Calyx ABI v1.6**.

Cart manifests normally use `abi = "v1"` to target the supported v1 major
line. A fixture can name an exact minor when it needs to distinguish behavior
introduced within that line.

An additive compatible contract normally increments the ABI minor. A change to
existing observable semantics requires an incompatible ABI decision. Product
and ABI versions do not advance together automatically.

## Component versions

Components carry their own package or crate versions:

- `@cheesycrab/sunny`
- `@cheesycrab/calyx-web`
- `calyx-core`
- `calyx-cli`

A component document states which ABI it implements or targets. Component
versions can differ from each other and from the product version.

## Usage

- Use the product version for a player, package, or release identity.
- Use the ABI version for cart/runtime compatibility.
- Use a component version for package-manager and crate dependencies.

Release tags use `v` followed by the product version: `v1.0.0-rc.1`, for
example. The release workflow checks that they match before building packages.

Name both layers when a statement uses both, for example: “The Calyx
1.0.0-rc.1 player implements Calyx ABI v1.6.”
