# Calyx security policy

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Email [cheesycrab@fastmail.com](mailto:cheesycrab@fastmail.com) with:

- the affected Calyx version or source revision;
- the runtime, player, package, or cart-loading path involved;
- reproduction steps or a proof of concept; and
- the impact you believe is possible.

Reports are handled on a best-effort basis. Calyx does not promise a response or remediation time. Please avoid accessing other people's data, disrupting a service, or publishing exploit details before there has been a reasonable chance to investigate.

## Supported versions and scope

Before the first stable release, security fixes target the current release candidate. After 1.0, the current stable release is the supported line unless a release note says otherwise.

Useful reports include runtime isolation failures, cart-validation bypasses, unsafe archive handling, path traversal, unintended network transfer, exposed secrets, dependency-integrity problems, and vulnerabilities in Calyx-owned release or deployment tooling. Ordinary cart bugs, game balance, unsupported platforms, and feature requests belong in the normal contribution channel.

Calyx executes untrusted cart code only through the documented Wasm boundary. That boundary reduces risk; it is not a claim that every Wasm engine, presenter, browser, operating system, or package dependency is vulnerability free.
